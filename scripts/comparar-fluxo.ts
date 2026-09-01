/**
 * O fluxo de caixa do app contra a aba `Expenses` da planilha de fluxo, linha a linha (D116).
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
 * Só lê.
 *
 *   npm run comparar:fluxo
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { TO_CODE } from "./plano-de-contas.ts";
import { quebrarFaturas, type Fatura, type Pagamento } from "@/lib/card-bills";
import { GROUP_OF_CODE } from "@/lib/data/cash-flow-report";
import { readXlsx } from "@/lib/import/xlsx";
import { formatBRL, fromNumeric, type Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

loadEnvLocal();

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const PLANILHA = "docs/reference/Fluxo de Caixa - 2026.xlsx";
/** `Jan` é a coluna 5 da aba `Expenses`; daí em diante, um mês por coluna. */
const PRIMEIRA_COLUNA = 5;
const MESES = ["01", "02", "03", "04", "05", "06", "07"] as const;

/**
 * Onde a aba `Expenses` chama uma conta por outro nome que a `DRE Geral`. O resto sai do
 * `TO_CODE`, que é o mesmo mapa para os dois arquivos.
 */
const APELIDOS: Record<string, string[]> = {
  "Time - Interno": ["6.10"],
  "Time - Freelancers": ["6.10"],
  "Distribuição de Lucro": ["6.11", "99.04"],
  "Legal & Professional Fees": ["8.02"],
  "Plano de saude": ["6.06"],
  "Insurance - Estags": ["6.07"],
  Other: ["10.05"],
  "Máquinas e Computadores": ["5.01"],
  Imposto: ["4.01"],
  // A conta que a D117 criou: freelancer que é empresa, separado do time nos dois arquivos.
  "Freelancer (outras empresas)": ["6.12"],
};

const normalizar = (b: string) =>
  b
    .replace(/^-\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

const centavos = (b: string | null): Cents => {
  const t = (b ?? "").trim();
  return t === "" ? 0n : BigInt(Math.round(Number(t) * 100));
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");
const sql = postgres(url, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  // ---- O lado do app -------------------------------------------------------
  const banco = await sql<Record<string, string | null>[]>`
    select ce.id, ce.account_id as "accountId", ce.occurred_on::text as "occurredOn",
           ce.amount::text as amount, ce.direction, ct.code, ct.kind::text as kind
      from cash_entries ce
      join accounts a on a.id = ce.account_id
      left join categories ct on ct.id = ce.category_id
     where ce.entity_id = ${entity.id} and a.type in ('bank','cash','investment')`;
  const cartao = await sql<Record<string, string | null>[]>`
    select ce.import_id as "importId", ce.amount::text as amount, ce.direction, ct.code
      from cash_entries ce
      join accounts a on a.id = ce.account_id
      left join categories ct on ct.id = ce.category_id
     where ce.entity_id = ${entity.id} and a.type = 'credit_card' and ce.import_id is not null`;

  const porImport = new Map<string, Fatura["compras"][number][]>();
  for (const c of cartao) {
    const k = c.importId as string;
    porImport.set(k, [
      ...(porImport.get(k) ?? []),
      {
        categoryId: c.code ?? null,
        amount: fromNumeric(c.amount as string),
        direction: c.direction as "in" | "out",
      },
    ]);
  }
  const faturas: Fatura[] = [...porImport].map(([importId, compras]) => ({ importId, compras }));

  const pagamentos: Pagamento[] = banco
    .filter((e) => e.code === "99.02" && e.direction === "out")
    .map((e) => ({
      id: e.id as string,
      accountId: e.accountId as string,
      occurredOn: e.occurredOn as IsoDate,
      amount: fromNumeric(e.amount as string),
    }));
  const quebra = quebrarFaturas(pagamentos, faturas);

  const app = new Map<string, Cents>();
  const acumular = (code: string | null, mes: string, v: Cents) => {
    const k = `${code ?? "—"}|${mes}`;
    app.set(k, (app.get(k) ?? 0n) + v);
  };
  for (const e of banco) {
    if (quebra.substituidos.has(e.id as string)) continue;
    // 99.01 e 99.03 não são gasto; a 99.02 que sobrou já é saída de verdade (D108).
    if (e.kind === "transfer" && e.code !== "99.02") continue;
    const data = e.occurredOn as string;
    if (data < "2026-01-01" || data > "2026-07-31") continue;
    const v = fromNumeric(e.amount as string);
    acumular(e.code ?? null, data.slice(5, 7), e.direction === "out" ? v : -v);
  }
  for (const p of quebra.partes) {
    if (p.occurredOn < "2026-01-01" || p.occurredOn > "2026-07-31") continue;
    acumular(p.categoryId, p.occurredOn.slice(5, 7), p.direction === "out" ? p.amount : -p.amount);
  }
  const valorApp = (codes: string[], mes: string): Cents =>
    codes.reduce((a, c) => a + (app.get(`${c}|${mes}`) ?? 0n), 0n);

  // ---- O lado da planilha --------------------------------------------------
  const aba = readXlsx(readFileSync(PLANILHA)).find((s) => s.name === "Expenses");
  if (!aba) throw new Error("aba `Expenses` não encontrada");

  console.log(`\n${BOLD}O fluxo do app contra a sua aba \`Expenses\`${RESET}`);
  console.log(`${DIM}compra de cartão entra no mês em que a fatura foi paga (D116)${RESET}\n`);
  console.log(
    `${DIM}${"linha".padEnd(30)}${"sua planilha".padStart(15)}${"o app".padStart(15)}` +
      `${"meses iguais".padStart(14)}${RESET}`,
  );

  let grupo = "";
  const juntos = new Map<string, { rotulo: string; codes: string[]; plan: Cents[] }>();
  const semConta: string[] = [];
  /** Grupo → os sete meses, na ordem em que a aba os lista. */
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
    const codes =
      APELIDOS[bruto] ??
      APELIDOS[rotulo] ??
      (TO_CODE[rotulo] ? [TO_CODE[rotulo] as string] : null);
    const plan = MESES.map((_, i) => centavos(row[PRIMEIRA_COLUNA + i] ?? null));

    if (!codes) {
      if (plan.some((v) => v !== 0n)) semConta.push(`${grupo} · ${rotulo}`);
      continue;
    }

    const chave = codes.join("+");
    const ja = juntos.get(chave);
    if (ja) ja.plan = ja.plan.map((v, i) => v + (plan[i] as Cents));
    else juntos.set(chave, { rotulo: `${grupo} · ${rotulo}`, codes, plan });
  }

  let distancia = 0n;
  let fechadas = 0;
  for (const { rotulo, codes, plan } of juntos.values()) {
    const nossos = MESES.map((mes) => valorApp(codes, mes));
    const tp = plan.reduce((a, b) => a + b, 0n);
    const ta = nossos.reduce((a, b) => a + b, 0n);
    if (tp === 0n && ta === 0n) continue;

    const bate = plan.filter((v, i) => v === nossos[i]).length;
    if (bate === 7) fechadas += 1;
    const d = tp - ta;
    distancia += d < 0n ? -d : d;

    const cor = bate === 7 ? GREEN : bate >= 4 ? "" : YELLOW;
    console.log(
      `${rotulo.padEnd(30).slice(0, 30)}${formatBRL(tp).padStart(15)}${formatBRL(ta).padStart(15)}` +
        `${cor}${`${bate}/7`.padStart(14)}${RESET}`,
    );
  }

  console.log(
    `\n${BOLD}${fechadas} linha(s) fecham os 7 meses${RESET} · distância somada ${BOLD}${formatBRL(distancia)}${RESET}`,
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
    const nossos = MESES.map((mes) => valorApp(codes, mes));
    const tp = plan.reduce((a, b) => a + b, 0n);
    const ta = nossos.reduce((a, b) => a + b, 0n);
    if (tp === 0n && ta === 0n) continue;

    const bate = plan.filter((v, i) => v === nossos[i]).length;
    if (bate === 7) fechadosGrupo += 1;
    const d = tp - ta;
    distanciaGrupo += d < 0n ? -d : d;

    const cor = bate === 7 ? GREEN : bate >= 4 ? "" : YELLOW;
    console.log(
      `${grupo.padEnd(32).slice(0, 32)}${formatBRL(tp).padStart(15)}${formatBRL(ta).padStart(15)}` +
        `${cor}${`${bate}/7`.padStart(14)}${RESET}`,
    );
  }

  console.log(
    `\n${BOLD}${fechadosGrupo} grupo(s) fecham os 7 meses${RESET} · distância somada ` +
      `${BOLD}${formatBRL(distanciaGrupo)}${RESET}`,
  );

  // Código com saída no período e grupo nenhum. Entrada acumula negativo, então receita
  // cai fora sozinha — o que sobra aqui é gasto que a tela mostraria como "Sem grupo".
  const semGrupo: string[] = [];
  for (const code of new Set([...app.keys()].map((k) => k.split("|")[0] as string))) {
    if (GROUP_OF_CODE[code]) continue;
    const total = MESES.reduce((a, mes) => a + (app.get(`${code}|${mes}`) ?? 0n), 0n);
    if (total > 0n) semGrupo.push(`${code} ${formatBRL(total)}`);
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
  console.log("");
} finally {
  await sql.end();
}
