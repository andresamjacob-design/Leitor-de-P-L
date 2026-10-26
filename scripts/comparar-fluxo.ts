/**
 * O fluxo de caixa do app contra a planilha de fluxo do Andre, linha a linha (D116).
 *
 * O irmão do `comparar`, do outro lado. Aquele mede competência contra competência; este
 * mede **caixa contra caixa**, e a diferença entre os dois é a razão de existirem os dois:
 * a mesma compra de cartão entra na DRE no mês em que foi comprada e no fluxo no mês em que
 * a fatura foi paga. É por isso que a DRE do app fecha *alinhada* com a dele e o fluxo dele
 * anda *um mês à frente* (D114).
 *
 * O app só passou a ter as sub-linhas de cartão no fluxo depois da quebra da fatura (D116):
 * antes, `Gsuite` no fluxo era zero, porque a compra vive numa conta de cartão e o cartão
 * fica fora do relatório (D-C). O que aparecia era o pagamento inteiro numa linha só.
 *
 * ## As três convenções, e por que este script não as escreve
 *
 * A D138 mediu as saídas do app contra as dele e achou **R$ 1.020.204,48** de distância. Não
 * era erro de categorização: eram três convenções do fluxo que a consulta daquele dia não
 * aplicava.
 *
 *   1. **Transferência se cancela** — `99.01` e `99.03` têm as duas pernas no relatório.
 *   2. **`99.02` NÃO é transferência no fluxo**, apesar de `kind=transfer` no banco: o
 *      cartão está fora do relatório, então o dinheiro sai e não volta (D108).
 *   3. **A linha dos sócios é líquida** — saída menos devolução (D113) —, e pagamento
 *      devolvido some das duas colunas (D107).
 *
 * As três já existem, escritas uma vez, dentro do `buildCashFlow` que a tela usa
 * (`sectionOf`, `abate`, `refundedEntryIds`). Escrevê-las de novo aqui seria criar uma
 * segunda cópia que diverge em silêncio, e a medição passaria a confirmar a si mesma em vez
 * de conferir a tela. Então o lado do app deste script **é o relatório da tela**, montado
 * pelo mesmo builder com as mesmas entradas — o mesmo motivo pelo qual o `GROUP_OF_CODE` já
 * era importado e nunca copiado.
 *
 * ## E um mês só conta quando ele está fechado dos dois lados
 *
 * A planilha tem doze colunas e o ano não acabou: de agosto em diante ela ainda traz
 * **projeção** — `Receita Projetos` de agosto é uma média, as linhas de cartão estão em
 * zero porque a fatura ainda não tinha sido paga quando ele preencheu, e `Valor Itaú`, que
 * é a conferência dele contra o banco, para em junho. Medir o razão real contra uma coluna
 * projetada não mede nada: infla a distância com a diferença entre o que ele previu e o
 * que aconteceu.
 *
 * O critério é lido do próprio arquivo, não escrito aqui: **uma coluna com valor de mais de
 * duas casas decimais tem fórmula de projeção dentro** — média não dá centavo redondo, e
 * janeiro a julho não têm um único caso em 46 linhas. Quando ele fechar agosto com números
 * de verdade, o mês entra sozinho, sem ninguém editar este script.
 *
 * Só lê.
 *
 *   npm run comparar:fluxo
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { contasDaLinha, normalizarRotulo as normalizar } from "@/lib/linhas-da-planilha";
import { buildCashFlow, periodRange, type FlowEntry, type FlowCategory } from "@/lib/cash-flow";
import { quebrarFaturas, type Fatura, type Pagamento } from "@/lib/card-bills";
import { BALANCE_ONLY_CODES, GROUP_OF_CODE, SOCIOS_LABEL } from "@/lib/data/cash-flow-report";
import { readXlsx } from "@/lib/import/xlsx";
import { formatBRL, fromNumeric, type Cents } from "@/lib/money";
import type { CategoryKind } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";

loadEnvLocal();

const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

// A versão que as abas mostram (D141). Até 07/10 isto lia a de 24/08, e julho aparecia com
// R$ 6.836,54 de entrada a mais na planilha — diferença do arquivo velho, não do app (D149).
const PLANILHA = "docs/reference/Fluxo de Caixa - 2026 (07-10).xlsx";
/** `Jan` é a coluna 5 da aba `Expenses`; daí em diante, um mês por coluna. */
const PRIMEIRA_COLUNA = 5;
/** `Jan` é a coluna 4 da aba `Summary`. */
const PRIMEIRA_COLUNA_SUMMARY = 4;
/**
 * Até onde o razão tem mês fechado. Agosto entrou em 22/09 e a conta corrente passou a bater
 * ao centavo; setembro em diante, na planilha, é projeção — comparar com projeção não mede
 * nada. O fim do intervalo é o último dia com dado real, não o último com coluna.
 */
const DE: IsoDate = "2026-01-01";
const ATE: IsoDate = "2026-08-31";
const MESES = ["01", "02", "03", "04", "05", "06", "07", "08"] as const;

/** `99.02` — pagamento de fatura de cartão. Convenção 2, e quem a aplica é o builder. */
const CARD_BILL_CODE = "99.02";
/** Pró-labore e distribuição: uma linha só no caixa (D112). */
const SOCIOS_CODES = ["6.11", "99.04"];

const centavos = (b: string | null): Cents => {
  const t = (b ?? "").trim();
  return t === "" ? 0n : BigInt(Math.round(Number(t) * 100));
};

const abs = (v: Cents): Cents => (v < 0n ? -v : v);

/**
 * A coluna `i` desta aba tem projeção dentro?
 *
 * Fórmula de média deixa rastro: `59634.83871`, `212373.3587`. Dinheiro de verdade tem dois
 * decimais. É o sinal que separa mês fechado de mês ainda por fechar, e vem do arquivo —
 * nada aqui decide que julho é o último.
 */
const temProjecao = (rows: readonly (readonly (string | null)[])[], coluna: number): boolean =>
  rows.some((r) => {
    const v = (r[coluna] ?? "").trim();
    if (v === "" || Number.isNaN(Number(v))) return false;
    return ((v.split(".")[1] ?? "").replace(/0+$/, "")).length > 2;
  });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  // ---- O lado do app, montado pelo builder da tela -------------------------
  const contas = await sql<Record<string, string>[]>`
    select id, name, opening_balance::text as "openingBalance", opening_date::text as "openingDate"
      from accounts
     where entity_id = ${entity.id} and type in ('bank','cash','investment')`;
  const contasCartao = await sql<{ id: string }[]>`
    select id from accounts where entity_id = ${entity.id} and type = 'credit_card'`;
  const contasCat = await sql<Record<string, string>[]>`
    select id, code, name, kind::text as kind, sort_order::text as "sortOrder"
      from categories where entity_id = ${entity.id}`;

  const categories: FlowCategory[] = contasCat.map((c) => ({
    id: c.id as string,
    code: c.code as string,
    name: c.name as string,
    kind: c.kind as CategoryKind,
    sortOrder: Number(c.sortOrder),
  }));

  // Tudo até o fim do intervalo: o que veio antes é o saldo de abertura.
  const lancamentos = await sql<Record<string, string | null>[]>`
    select ce.id, ce.account_id as "accountId", ce.occurred_on::text as "occurredOn",
           ce.amount::text as amount, ce.direction, ce.category_id as "categoryId",
           ce.counterparty_tax_id as "counterpartyTaxId"
      from cash_entries ce
      join accounts a on a.id = ce.account_id
     where ce.entity_id = ${entity.id} and a.type in ('bank','cash','investment')
       and ce.occurred_on <= ${ATE}`;
  const cartao = await sql<Record<string, string | null>[]>`
    select ce.import_id as "importId", ce.amount::text as amount, ce.direction,
           ce.category_id as "categoryId"
      from cash_entries ce
      join accounts a on a.id = ce.account_id
     where ce.entity_id = ${entity.id} and a.type = 'credit_card'
       and ce.import_id is not null and ce.occurred_on <= ${ATE}`;
  if (contasCartao.length === 0) throw new Error("nenhuma conta de cartão");

  // ---- A quebra da fatura (D116), como o carregador da tela faz -------------
  const porImport = new Map<string, Fatura["compras"][number][]>();
  for (const c of cartao) {
    const k = c.importId as string;
    porImport.set(k, [
      ...(porImport.get(k) ?? []),
      {
        categoryId: c.categoryId ?? null,
        amount: fromNumeric(c.amount as string),
        direction: c.direction as "in" | "out",
      },
    ]);
  }
  const faturas: Fatura[] = [...porImport].map(([importId, compras]) => ({ importId, compras }));

  const billCategoryIds = new Set(
    categories.filter((c) => c.code === CARD_BILL_CODE).map((c) => c.id),
  );
  const pagamentos: Pagamento[] = lancamentos
    .filter((e) => e.categoryId != null && billCategoryIds.has(e.categoryId))
    .filter((e) => e.direction === "out")
    .map((e) => ({
      id: e.id as string,
      accountId: e.accountId as string,
      occurredOn: e.occurredOn as IsoDate,
      amount: fromNumeric(e.amount as string),
    }));
  const quebra = quebrarFaturas(pagamentos, faturas);

  const entries: FlowEntry[] = [
    ...lancamentos
      .filter((e) => !quebra.substituidos.has(e.id as string))
      .map((e) => ({
        id: e.id as string,
        accountId: e.accountId as string,
        occurredOn: e.occurredOn as IsoDate,
        amount: fromNumeric(e.amount as string),
        direction: e.direction as "in" | "out",
        categoryId: e.categoryId ?? null,
        counterpartyTaxId: e.counterpartyTaxId ?? null,
      })),
    ...quebra.partes.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      occurredOn: p.occurredOn,
      amount: p.amount,
      direction: p.direction,
      categoryId: p.categoryId,
      counterpartyTaxId: null,
      ...(p.abatesSection === true ? { abatesSection: true } : {}),
    })),
  ];

  const sociosIds = new Set(
    categories.filter((c) => SOCIOS_CODES.includes(c.code)).map((c) => c.id),
  );
  const report = buildCashFlow({
    periods: periodRange(DE, ATE),
    accounts: contas.map((a) => ({
      id: a.id as string,
      name: a.name as string,
      openingBalance: fromNumeric(a.openingBalance as string),
      openingDate: a.openingDate as IsoDate,
    })),
    entries,
    categories,
    // Convenção 2 (D108): a contrapartida da `99.02` ficou fora do relatório.
    oneLeggedTransferCategoryIds: new Set(
      categories.filter((c) => c.code === CARD_BILL_CODE).map((c) => c.id),
    ),
    balanceOnlyCategoryIds: new Set(
      categories.filter((c) => BALANCE_ONLY_CODES.includes(c.code)).map((c) => c.id),
    ),
    // D112: pró-labore e distribuição viram uma linha só no caixa.
    mergedRows:
      sociosIds.size === SOCIOS_CODES.length
        ? [{ label: SOCIOS_LABEL, categoryIds: sociosIds }]
        : [],
  });

  const saidas = report.sections.find((s) => s.key === "out");
  const entradas = report.sections.find((s) => s.key === "in");
  if (!saidas || !entradas) throw new Error("relatório sem seção de entradas ou saídas");

  /**
   * Código de conta → os oito meses, do lado do app. A linha de sócios não tem `code` — ela
   * já é o resultado de uma soma —, e vale pelos dois códigos que a compõem.
   */
  const app = new Map<string, Cents[]>();
  for (const row of saidas.rows) {
    const codes = row.label === SOCIOS_LABEL ? SOCIOS_CODES : row.code ? [row.code] : [];
    // Os dois códigos dos sócios apontam para a **mesma** linha, e é a mesma referência de
    // array que os dois guardam: `valorApp` de-duplica por identidade, então `6.11` e
    // `99.04` juntos valem uma linha, não duas. Copiar o array aqui dobraria a conta.
    const valores = row.values;
    for (const code of codes) if (!app.has(code)) app.set(code, valores);
  }
  const linhaDe = new Map<string, Cents[]>();
  for (const row of saidas.rows) {
    const chave = row.label === SOCIOS_LABEL ? SOCIOS_LABEL : (row.code ?? `?${row.label}`);
    linhaDe.set(chave, [...row.values]);
  }
  /** Soma das **linhas distintas** que estes códigos alcançam, mês a mês. */
  const valorApp = (codes: string[], i: number): Cents => {
    const vistas = new Set<Cents[]>();
    for (const code of codes) {
      const v = app.get(code);
      if (v) vistas.add(v);
    }
    return [...vistas].reduce((a, v) => a + (v[i] ?? 0n), 0n);
  };

  // ---- O lado da planilha --------------------------------------------------
  const abas = readXlsx(readFileSync(PLANILHA));
  const aba = abas.find((s) => s.name === "Expenses");
  if (!aba) throw new Error("aba `Expenses` não encontrada");
  const abaIncome = abas.find((s) => s.name === "Income");

  /**
   * Quais dos meses do intervalo estão fechados **na planilha dele**. Um mês com projeção
   * em qualquer um dos dois lados não entra em distância nenhuma — aparece, marcado, para
   * ninguém achar que sumiu.
   */
  const fechado = MESES.map(
    (_, i) =>
      !temProjecao(aba.rows, PRIMEIRA_COLUNA + i) &&
      !(abaIncome ? temProjecao(abaIncome.rows, PRIMEIRA_COLUNA + i) : false),
  );
  const nFechados = fechado.filter(Boolean).length;
  const emAberto = MESES.filter((_, i) => !fechado[i]);

  // ---- Primeiro o total: é ele que a D138 mediu ----------------------------
  //
  // A aba `Summary` declara o total de entradas e de saídas de cada mês. É o número mais
  // alto da planilha e o mais barato de conferir: se ele fecha, as diferenças de linha são
  // classificação trocada entre contas, não dinheiro faltando.
  const summary = abas.find((s) => s.name === "Summary");
  const linhaSummary = (rotulo: string): Cents[] | null => {
    const row = summary?.rows.find((r) => (r[3] ?? "").trim() === rotulo);
    if (!row) return null;
    return MESES.map((_, i) => centavos(row[PRIMEIRA_COLUNA_SUMMARY + i] ?? null));
  };
  const planSaidas = linhaSummary("Expenses");
  const planEntradas = linhaSummary("Income");

  console.log(`\n${BOLD}O total de cada mês, contra a sua aba \`Summary\`${RESET}`);
  console.log(
    `${DIM}as três convenções do fluxo aplicadas pelo mesmo builder da tela ` +
      `(transferência se cancela · 99.02 é saída · sócios líquido)${RESET}\n`,
  );
  console.log(
    `${DIM}${"mês".padEnd(6)}${"suas saídas".padStart(15)}${"as do app".padStart(15)}` +
      `${"dif".padStart(14)}${"suas entradas".padStart(17)}${"as do app".padStart(15)}` +
      `${"dif".padStart(14)}${RESET}`,
  );

  let distSaidas = 0n;
  let distEntradas = 0n;
  let mesesSaidaZero = 0;
  if (planSaidas && planEntradas) {
    MESES.forEach((mes, i) => {
      const ps = planSaidas[i] as Cents;
      const pe = planEntradas[i] as Cents;
      const as = saidas.totals[i] as Cents;
      const ae = entradas.totals[i] as Cents;
      const ds = ps - as;
      const de = pe - ae;
      if (fechado[i] === true) {
        if (ds === 0n) mesesSaidaZero += 1;
        distSaidas += abs(ds);
        distEntradas += abs(de);
      }
      // Mês em aberto não entra na conta: a coluna dele ainda é previsão, e a "diferença"
      // seria entre o que ele previu e o que aconteceu, não entre o app e a planilha.
      const marca = (d: Cents) =>
        fechado[i] === true ? formatBRL(d) : `${DIM}previsão${RESET}`;
      const cs = fechado[i] !== true ? "" : ds === 0n ? GREEN : abs(ds) > 10_000_00n ? YELLOW : "";
      const ce = fechado[i] !== true ? "" : de === 0n ? GREEN : abs(de) > 10_000_00n ? YELLOW : "";
      console.log(
        `${`${mes}/26`.padEnd(6)}${formatBRL(ps).padStart(15)}${formatBRL(as).padStart(15)}` +
          `${cs}${marca(ds).padStart(fechado[i] === true ? 14 : 22)}${RESET}` +
          `${formatBRL(pe).padStart(17)}${formatBRL(ae).padStart(15)}` +
          `${ce}${marca(de).padStart(fechado[i] === true ? 14 : 22)}${RESET}`,
      );
    });
    console.log(
      `\n${BOLD}Saídas: distância somada ${formatBRL(distSaidas)}${RESET}` +
        ` · ${mesesSaidaZero} de ${nFechados} meses fechados ao centavo` +
        ` · ${BOLD}entradas: ${formatBRL(distEntradas)}${RESET}`,
    );
    if (emAberto.length > 0) {
      console.log(
        `${DIM}${emAberto.join(", ")}/26 fora da conta: a coluna da planilha ainda tem ` +
          `projeção dentro (as linhas de cartão em zero, receita por média). O app mostra o ` +
          `razão real desses meses — o que falta é você fechar a planilha, não o app.${RESET}`,
      );
    }
  } else {
    console.log(`${YELLOW}aba \`Summary\` sem as linhas \`Expenses\`/\`Income\`${RESET}`);
  }

  console.log(`\n${BOLD}A mesma coisa linha a linha, contra a aba \`Expenses\`${RESET}`);
  console.log(`${DIM}compra de cartão entra no mês em que a fatura foi paga (D116)${RESET}\n`);
  console.log(
    `${DIM}${"linha".padEnd(30)}${"sua planilha".padStart(15)}${"o app".padStart(15)}` +
      `${"meses iguais".padStart(14)}${RESET}`,
  );

  let grupo = "";
  const juntos = new Map<string, { rotulo: string; codes: string[]; plan: Cents[] }>();
  const semConta: string[] = [];
  /** Grupo → os meses, na ordem em que a aba os lista. */
  const grupoPlan = new Map<string, Cents[]>();

  for (const row of aba.rows) {
    const g = (row[1] ?? "").trim();
    if (g) grupo = g;
    const bruto = (row[4] ?? "").trim();
    // `Monthly totals:` é o subtotal que a **própria planilha** declara para o grupo, na
    // mesma linha do nome dele. Vale mais que somar as sub-linhas outra vez: é o número
    // dela, e se um dia ele deixar de bater com as sub-linhas o problema é da planilha.
    if (bruto === "Monthly totals:") {
      grupoPlan.set(
        grupo,
        MESES.map((_, i) => centavos(row[PRIMEIRA_COLUNA + i] ?? null)),
      );
      continue;
    }
    // A linha 1 tem `Expenses` no lugar do rótulo e serial de data no lugar do valor.
    if (bruto === "" || bruto === "Expenses") continue;

    const rotulo = normalizar(bruto);
    // O apelido é procurado **antes** de normalizar também: `Freelancer (outras empresas)`
    // perde o parêntese na normalização e vira `Freelancer`, que não é conta nenhuma.
    const codes = contasDaLinha(bruto);
    const plan = MESES.map((_, i) => centavos(row[PRIMEIRA_COLUNA + i] ?? null));

    if (!codes) {
      if (plan.some((v) => v !== 0n)) semConta.push(`${grupo} · ${rotulo}`);
      continue;
    }

    // Linhas que dividem uma conta são uma linha só na comparação: `Time - Interno` (6.10 e
    // Ciclo) e `Time - Freelancers` (6.10) disputam a mesma conta do app, e comparar cada uma
    // com o valor inteiro dela contaria o dinheiro duas vezes.
    const ja = [...juntos.values()].find((j) => j.codes.some((c) => codes.includes(c)));
    if (ja) {
      ja.plan = ja.plan.map((v, i) => v + (plan[i] as Cents));
      ja.codes = [...new Set([...ja.codes, ...codes])];
    } else {
      juntos.set(codes.join("+"), { rotulo: `${grupo} · ${rotulo}`, codes, plan });
    }
  }

  let distancia = 0n;
  let fechadas = 0;
  // Só os meses fechados entram: uma sub-linha de cartão vale zero na coluna projetada, e
  // contá-la faria a linha parecer errada por um mês que ele ainda não preencheu.
  const soFechados = (v: readonly Cents[]): Cents[] => v.filter((_, i) => fechado[i] === true);
  for (const { rotulo, codes, plan } of juntos.values()) {
    const nossos = MESES.map((_, i) => valorApp(codes, i));
    const tp = soFechados(plan).reduce((a, b) => a + b, 0n);
    const ta = soFechados(nossos).reduce((a, b) => a + b, 0n);
    if (tp === 0n && ta === 0n) continue;

    const bate = plan.filter((v, i) => fechado[i] === true && v === nossos[i]).length;
    if (bate === nFechados) fechadas += 1;
    distancia += abs(tp - ta);

    const cor = bate === nFechados ? GREEN : bate >= 4 ? "" : YELLOW;
    console.log(
      `${rotulo.padEnd(30).slice(0, 30)}${formatBRL(tp).padStart(15)}${formatBRL(ta).padStart(15)}` +
        `${cor}${`${bate}/${nFechados}`.padStart(14)}${RESET}`,
    );
  }

  console.log(
    `\n${BOLD}${fechadas} linha(s) fecham os ${nFechados} meses${RESET} · distância somada ${BOLD}${formatBRL(distancia)}${RESET}`,
  );
  // ---- O mesmo, um andar acima: grupo contra grupo --------------------------
  //
  // A tabela de cima compara sub-linha com sub-linha, e há duas coisas que ela é incapaz
  // de medir. A planilha não tem linha para a Agência Ciclo, então os R$ 4.000/mês dela
  // não entram em lado nenhum; e o app não tem, olhando só a sub-linha, como saber que a
  // planilha conta a Ciclo dentro de `Pessoas`. No nível do grupo os dois viram
  // comparáveis — e é neste nível que a aba de Saídas passou a mostrar (D125).
  //
  // O lado do app usa o **mesmo `GROUP_OF_CODE` que a tela usa**, importado, nunca uma
  // cópia: uma cópia divergiria em silêncio e a medição passaria a confirmar a si mesma
  // em vez de conferir a tela.
  const codesDoGrupo = (grupo: string) =>
    Object.entries(GROUP_OF_CODE)
      .filter(([, g]) => g === grupo)
      .map(([code]) => code);

  console.log(`\n${BOLD}O mesmo, um andar acima: grupo contra grupo${RESET}`);
  console.log(
    `${DIM}${"grupo".padEnd(32)}${"sua planilha".padStart(15)}${"o app".padStart(15)}` +
      `${"meses iguais".padStart(14)}${RESET}`,
  );

  let distanciaGrupo = 0n;
  let fechadosGrupo = 0;
  for (const [grupo, plan] of grupoPlan) {
    const codes = codesDoGrupo(grupo);
    const nossos = MESES.map((_, i) => valorApp(codes, i));
    const tp = soFechados(plan).reduce((a, b) => a + b, 0n);
    const ta = soFechados(nossos).reduce((a, b) => a + b, 0n);
    if (tp === 0n && ta === 0n) continue;

    const bate = plan.filter((v, i) => fechado[i] === true && v === nossos[i]).length;
    if (bate === nFechados) fechadosGrupo += 1;
    distanciaGrupo += abs(tp - ta);

    const cor = bate === nFechados ? GREEN : bate >= 4 ? "" : YELLOW;
    console.log(
      `${grupo.padEnd(32).slice(0, 32)}${formatBRL(tp).padStart(15)}${formatBRL(ta).padStart(15)}` +
        `${cor}${`${bate}/${nFechados}`.padStart(14)}${RESET}`,
    );
  }

  console.log(
    `\n${BOLD}${fechadosGrupo} grupo(s) fecham os ${nFechados} meses${RESET} · distância somada ` +
      `${BOLD}${formatBRL(distanciaGrupo)}${RESET}`,
  );

  // Linha de saída com código e grupo nenhum — o que a tela mostraria como "Sem grupo".
  const semGrupo: string[] = [];
  for (const [chave, valores] of linhaDe) {
    if (chave === SOCIOS_LABEL || GROUP_OF_CODE[chave]) continue;
    const total = soFechados(valores).reduce((a, b) => a + b, 0n);
    if (total !== 0n) semGrupo.push(`${chave} ${formatBRL(total)}`);
  }
  if (semGrupo.length > 0) {
    console.log(`${DIM}sem grupo, do lado do app: ${semGrupo.join(", ")}${RESET}`);
  }

  if (semConta.length > 0) {
    console.log(`${YELLOW}sem conta correspondente no app:${RESET} ${semConta.join(", ")}`);
  }
  if (quebra.semFatura.length > 0) {
    const total = quebra.semFatura.reduce((a, p) => a + p.amount, 0n);
    console.log(
      `${DIM}${quebra.semFatura.length} pagamento(s) de fatura sem fatura importada, somando ` +
        `${formatBRL(total)} — ficam como linha única${RESET}`,
    );
  }
  // O builder avisa o que o leitor precisa saber para confiar nos números (SPEC §14).
  for (const aviso of report.warnings) console.log(`${DIM}${aviso}${RESET}`);
  console.log("");
} finally {
  await sql.end();
}
