/**
 * Prova que a DRE e o fluxo de caixa fecham entre si, mês a mês, com toda diferença
 * nomeada — e falha se sobrar um centavo sem explicação.
 *
 * Os dois razões não batem, e não é para baterem (D2). O que precisa ser verdade é que
 * **nenhuma diferença entre eles seja anônima**. Resíduo diferente de zero é defeito real:
 * um espelho que não nasceu, um custo contado duas vezes, um lançamento cuja competência
 * aponta para um mês e cujo dinheiro está em outro sem que ninguém tenha pedido isso.
 *
 * A identidade está em `src/lib/reconcile.ts`, pura e testada; aqui só se enchem os baldes
 * a partir do banco. A decomposição é exaustiva de propósito: se um lançamento pudesse
 * cair em dois baldes, ou em nenhum, o resíduo deixaria de significar alguma coisa.
 *
 * Sai com código 1 se algum mês não fechar, para poder entrar no `check` um dia.
 *
 *   npm run verify:reconcile
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, ZERO } from "@/lib/money";
import { buildBridge, significantLines } from "@/lib/reconcile";
import type { MonthBuckets } from "@/lib/reconcile";
import { formatPeriod } from "@/lib/dates";

loadEnvLocal();

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const VERBOSE = process.argv.includes("--detalhe");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

/** As contas que carregam dinheiro de verdade. O cartão é passivo, e fica fora (D-C). */
const CASH_TYPES = ["bank", "cash", "investment"];
/**
 * As contas de folha, cuja competência vem da aba `Colaboradores` desde a D120. O pagamento
 * delas não espelha, e por isso precisa de um balde próprio: sem ele cairia no de "ainda sem
 * categoria" e R$ 1,2 milhão de folha viraria pendência.
 */
const PAYROLL_CODES = ["6.10", "6.11"];

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

type Bucketed = Record<string, bigint>;

/** Soma por mês, devolvendo um mapa `YYYY-MM-01 → Cents`. */
function index(rows: readonly { period: unknown; v: string | null }[]): Bucketed {
  const out: Bucketed = {};
  for (const row of rows) out[iso(row.period)] = fromNumeric(row.v ?? "0");
  return out;
}

const at = (bucket: Bucketed, period: string): bigint => bucket[period] ?? ZERO;

try {
  // ---- Lado do caixa ------------------------------------------------------
  // Todo lançamento de conta de caixa, fora de `transfer`, classificado pelo que o
  // espelho dele fez: nasceu no mesmo mês, nasceu em outro, ou não nasceu.
  const cash = await sql<
    {
      period: Date;
      operacional: string | null;
      entradas_sem_espelho: string | null;
      saidas_sem_espelho: string | null;
      saidas_folha: string | null;
      saidas_socios: string | null;
      entradas_socios: string | null;
      saidas_espelho_outro_mes: string | null;
      entradas_espelho_outro_mes: string | null;
      ajuste_manual: string | null;
    }[]
  >`
    with base as (
      select e.id, e.direction, e.amount,
             date_trunc('month', e.occurred_on)::date as mes,
             r.id      as espelho,
             r.period  as espelho_periodo,
             r.amount  as espelho_valor,
             coalesce(c.kind::text, '') as conta_kind,
             coalesce(c.code, '') as conta_code,
             case when e.direction = 'out' then e.amount else -e.amount end as esperado
      from cash_entries e
      join accounts a on a.id = e.account_id
      left join categories c on c.id = e.category_id
      left join recognition_entries r
        on r.cash_entry_id = e.id and r.source = 'cash_mirror'
      where a.type = any(${CASH_TYPES})
        and coalesce(c.kind::text, '') <> 'transfer'
    )
    select mes as period,
      sum(case when direction = 'in' then amount else -amount end) as operacional,
      sum(amount) filter (where direction = 'in'  and espelho is null and conta_kind <> 'owner_draw') as entradas_sem_espelho,
      sum(amount) filter (where direction = 'out' and espelho is null and conta_kind <> 'owner_draw'
                            and conta_code <> all(${PAYROLL_CODES})) as saidas_sem_espelho,
      sum(amount) filter (where direction = 'out' and espelho is null
                            and conta_code = any(${PAYROLL_CODES})) as saidas_folha,
      sum(amount) filter (where direction = 'out' and espelho is null and conta_kind =  'owner_draw') as saidas_socios,
      sum(amount) filter (where direction = 'in'  and espelho is null and conta_kind =  'owner_draw') as entradas_socios,
      sum(amount) filter (where direction = 'out' and espelho is not null and espelho_periodo <> mes) as saidas_espelho_outro_mes,
      sum(amount) filter (where direction = 'in'  and espelho is not null and espelho_periodo <> mes) as entradas_espelho_outro_mes,
      sum(espelho_valor - esperado) filter (where espelho is not null and espelho_periodo = mes) as ajuste_manual
    from base group by 1`;

  // ---- Lado da competência ------------------------------------------------
  const rec = await sql<
    {
      period: Date;
      receita: string | null;
      custo: string | null;
      custo_sem_caixa: string | null;
      custo_cartao: string | null;
      custo_caixa_outro_mes: string | null;
    }[]
  >`
    select r.period,
      sum(r.amount) filter (where r.kind = 'revenue') as receita,
      sum(r.amount) filter (where r.kind = 'cost')    as custo,
      sum(r.amount) filter (where r.kind = 'cost' and r.cash_entry_id is null) as custo_sem_caixa,
      sum(r.amount) filter (where r.kind = 'cost' and a.type = 'credit_card')  as custo_cartao,
      sum(r.amount) filter (
        where r.kind = 'cost' and a.type = any(${CASH_TYPES})
          and date_trunc('month', e.occurred_on)::date <> r.period
      ) as custo_caixa_outro_mes
    from recognition_entries r
    left join cash_entries e on e.id = r.cash_entry_id
    left join accounts a on a.id = e.account_id
    group by 1`;

  const operacional = index(cash.map((r) => ({ period: r.period, v: r.operacional })));
  const entradasSem = index(cash.map((r) => ({ period: r.period, v: r.entradas_sem_espelho })));
  const saidasSem = index(cash.map((r) => ({ period: r.period, v: r.saidas_sem_espelho })));
  const saidasSocios = index(cash.map((r) => ({ period: r.period, v: r.saidas_socios })));
  const saidasFolha = index(cash.map((r) => ({ period: r.period, v: r.saidas_folha })));
  const entradasSocios = index(cash.map((r) => ({ period: r.period, v: r.entradas_socios })));
  const saidasOutro = index(cash.map((r) => ({ period: r.period, v: r.saidas_espelho_outro_mes })));
  const entradasOutro = index(cash.map((r) => ({ period: r.period, v: r.entradas_espelho_outro_mes })));
  const ajuste = index(cash.map((r) => ({ period: r.period, v: r.ajuste_manual })));

  const receita = index(rec.map((r) => ({ period: r.period, v: r.receita })));
  const custo = index(rec.map((r) => ({ period: r.period, v: r.custo })));
  const custoSemCaixa = index(rec.map((r) => ({ period: r.period, v: r.custo_sem_caixa })));
  const custoCartao = index(rec.map((r) => ({ period: r.period, v: r.custo_cartao })));
  const custoOutroMes = index(rec.map((r) => ({ period: r.period, v: r.custo_caixa_outro_mes })));

  const periods = [
    ...new Set([...cash.map((r) => iso(r.period)), ...rec.map((r) => iso(r.period))]),
  ].sort();

  console.log(
    `\n${BOLD}Ponte entre o fluxo de caixa e a DRE${RESET} ${DIM}— ${periods.length} meses${RESET}`,
  );
  console.log(
    `${DIM}Os dois razões não batem de propósito (D2). O que se verifica é que toda\n` +
      `diferença tem nome: o resíduo de cada mês precisa ser exatamente zero.${RESET}\n`,
  );

  let falhas = 0;
  let residualTotal = ZERO;
  const acumulado = new Map<string, { amount: bigint; why: string }>();

  for (const period of periods) {
    const buckets: MonthBuckets = {
      period,
      caixaOperacional: at(operacional, period),
      receitaReconhecida: at(receita, period),
      custoReconhecido: at(custo, period),
      entradasSemEspelho: at(entradasSem, period),
      saidasSemEspelho: at(saidasSem, period),
      saidasDeSocios: at(saidasSocios, period),
      saidasDeFolha: at(saidasFolha, period),
      entradasDeSocios: at(entradasSocios, period),
      saidasComEspelhoEmOutroMes: at(saidasOutro, period),
      entradasComEspelhoEmOutroMes: at(entradasOutro, period),
      custoComCaixaEmOutroMes: at(custoOutroMes, period),
      custoDeCartao: at(custoCartao, period),
      custoSemCaixa: at(custoSemCaixa, period),
      ajusteManualNoEspelho: at(ajuste, period),
    };

    const bridge = buildBridge(buckets);
    residualTotal += bridge.residual;
    const ok = bridge.residual === ZERO;
    if (!ok) falhas += 1;

    const marca = ok ? `${GREEN}OK  ${RESET}` : `${RED}FALHA${RESET}`;
    console.log(
      `${marca} ${formatPeriod(period).padEnd(16)} ` +
        `caixa ${formatBRL(bridge.caixa).padStart(16)}   →   resultado ${formatBRL(bridge.resultado).padStart(16)}` +
        `${ok ? "" : `   ${RED}resíduo ${formatBRL(bridge.residual)}${RESET}`}`,
    );

    for (const line of bridge.lines) {
      const previous = acumulado.get(line.label);
      acumulado.set(line.label, {
        amount: (previous?.amount ?? ZERO) + line.amount,
        why: line.why,
      });
    }

    if (VERBOSE || !ok) {
      for (const line of significantLines(bridge)) {
        const sinal = line.amount > 0n ? "+" : "−";
        const valor = formatBRL(line.amount < 0n ? -line.amount : line.amount);
        console.log(`        ${sinal} ${valor.padStart(15)}  ${line.label}`);
        if (VERBOSE) console.log(`          ${DIM}${line.why}${RESET}`);
      }
    }
  }

  // O que separa os dois razões no acumulado. A maior linha costuma ser a lista de
  // tarefas: enquanto uma saída não tem categoria, ela pesa no caixa e não na DRE.
  console.log(`\n${BOLD}As diferenças, somadas nos ${periods.length} meses${RESET}`);
  const ordenado = [...acumulado.entries()]
    .filter(([, value]) => value.amount !== ZERO)
    .sort((a, b) => (b[1].amount < 0n ? -b[1].amount : b[1].amount) > (a[1].amount < 0n ? -a[1].amount : a[1].amount) ? 1 : -1);
  for (const [label, value] of ordenado) {
    const sinal = value.amount > 0n ? "+" : "−";
    const valor = formatBRL(value.amount < 0n ? -value.amount : value.amount);
    console.log(`  ${sinal} ${valor.padStart(16)}  ${label}`);
  }

  console.log("");
  if (falhas === 0) {
    console.log(
      `${GREEN}${BOLD}todos os ${periods.length} meses fecham${RESET} — nenhuma diferença sem nome entre os dois razões.\n`,
    );
  } else {
    console.log(
      `${RED}${BOLD}${falhas} de ${periods.length} meses não fecham${RESET} — resíduo somado ${formatBRL(residualTotal)}.`,
    );
    console.log(
      `${YELLOW}Resíduo é sempre defeito: espelho que não nasceu, custo contado duas vezes,\n` +
        `ou competência apontando para um mês cujo caixa está em outro sem ninguém ter pedido.${RESET}\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
