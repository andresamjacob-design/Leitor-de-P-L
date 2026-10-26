/**
 * O fluxo pronto no terminal: o que a aba Fluxo mostra nos meses que o app calcula (D146).
 *
 * A tela precisa de login (RLS); isto lê pelo Postgres direto e monta com as mesmas peças —
 * `quebrarFaturas`, `buildCashFlow` e `preencherComORazao` —, para conferir um mês sem abrir o
 * navegador. As três convenções da D138 vêm junto porque são as do `buildCashFlow`.
 *
 *   npm run fluxo:pronto              # os meses depois do último que a planilha tem
 *   npm run fluxo:pronto -- --mes 9   # só setembro
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { buildCashFlow, periodRange, type FlowCategory, type FlowEntry } from "@/lib/cash-flow";
import { quebrarFaturas, type Fatura, type Pagamento } from "@/lib/card-bills";
import { BALANCE_ONLY_CODES, SOCIOS_LABEL } from "@/lib/data/cash-flow-report";
import { preencherComORazao } from "@/lib/fluxo-da-planilha";
import { formatBRL, fromNumeric } from "@/lib/money";
import type { LinhaPlanilha, TipoLinha } from "@/lib/planilha";
import type { CategoryKind } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";

loadEnvLocal();

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const CYAN = "\u001b[36m";
const RESET = "\u001b[0m";

const ANO = "2026";
const SOCIOS_CODES = ["6.11", "99.04"];
const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const iMes = process.argv.indexOf("--mes");
const soMes = iMes === -1 ? null : Number(process.argv[iMes + 1]) - 1;

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const [entity] = await sql<{ id: string }[]>`select id from entities where slug = 'dd-group'`;
  if (!entity) throw new Error("entidade dd-group não encontrada");

  const contas = await sql<{ id: string; name: string; ob: string; od: string; type: string }[]>`
    select id, name, opening_balance::text as ob, opening_date::text as od, type::text
      from accounts where entity_id = ${entity.id}`;
  const caixa = contas.filter((c) => c.type !== "credit_card");
  const cats = await sql<{ id: string; code: string; name: string; kind: string; so: number }[]>`
    select id, code, name, kind::text, sort_order as so from categories where entity_id = ${entity.id}`;
  const categories: FlowCategory[] = cats.map((c) => ({
    id: c.id, code: c.code, name: c.name, kind: c.kind as CategoryKind, sortOrder: Number(c.so),
  }));
  const fim = `${ANO}-12-31`;
  type Linha = { id: string; accountId: string; occurredOn: string; amount: string; direction: string; categoryId: string | null; taxId: string | null; importId: string | null; tipo: string };
  const todos = await sql<Linha[]>`
    select ce.id, ce.account_id as "accountId", ce.occurred_on::text as "occurredOn",
           ce.amount::text as amount, ce.direction::text as direction,
           ce.category_id as "categoryId", ce.counterparty_tax_id as "taxId",
           ce.import_id as "importId", a.type::text as tipo
      from cash_entries ce join accounts a on a.id = ce.account_id
     where ce.entity_id = ${entity.id} and ce.occurred_on <= ${fim}`;
  const doCaixa = todos.filter((e) => e.tipo !== "credit_card");

  // A quebra da fatura (D116), como o carregador da tela faz.
  const porImport = new Map<string, Fatura["compras"][number][]>();
  for (const e of todos.filter((x) => x.tipo === "credit_card" && x.importId)) {
    porImport.set(e.importId!, [
      ...(porImport.get(e.importId!) ?? []),
      { categoryId: e.categoryId, amount: fromNumeric(e.amount!), direction: e.direction as "in" | "out" },
    ]);
  }
  const faturas: Fatura[] = [...porImport].map(([importId, compras]) => ({ importId, compras }));
  const fatura = new Set(categories.filter((c) => c.code === "99.02").map((c) => c.id));
  const pagamentos: Pagamento[] = doCaixa
    .filter((e) => e.categoryId && fatura.has(e.categoryId) && e.direction === "out")
    .map((e) => ({ id: e.id!, accountId: e.accountId!, occurredOn: e.occurredOn as IsoDate, amount: fromNumeric(e.amount!) }));
  const quebra = quebrarFaturas(pagamentos, faturas);

  const entries: FlowEntry[] = [
    ...doCaixa
      .filter((e) => !quebra.substituidos.has(e.id!))
      .map((e) => ({
        id: e.id!, accountId: e.accountId!, occurredOn: e.occurredOn as IsoDate,
        amount: fromNumeric(e.amount!), direction: e.direction as "in" | "out",
        categoryId: e.categoryId, counterpartyTaxId: e.taxId,
      })),
    ...quebra.partes.map((p) => ({
      id: p.id, accountId: p.accountId, occurredOn: p.occurredOn, amount: p.amount,
      direction: p.direction, categoryId: p.categoryId, counterpartyTaxId: null,
      ...(p.abatesSection === true ? { abatesSection: true } : {}),
    })),
  ];

  const socios = new Set(categories.filter((c) => SOCIOS_CODES.includes(c.code)).map((c) => c.id));
  const report = buildCashFlow({
    periods: periodRange(`${ANO}-01-01`, fim),
    accounts: caixa.map((c) => ({ id: c.id, name: c.name, openingBalance: fromNumeric(c.ob), openingDate: c.od as IsoDate })),
    entries,
    categories,
    oneLeggedTransferCategoryIds: fatura,
    balanceOnlyCategoryIds: new Set(categories.filter((c) => BALANCE_ONLY_CODES.includes(c.code)).map((c) => c.id)),
    mergedRows: socios.size === 2 ? [{ label: SOCIOS_LABEL, categoryIds: socios }] : [],
  });

  // A cópia da planilha, como a tela a lê.
  const linhas = (
    await sql<{ ordem: number; tipo: string; rotulo: string; detalhe: string | null; valores: string | null; total: string | null }[]>`
      select ordem, tipo, rotulo, detalhe, to_json(valores)::text as valores, total
        from planilha_linhas where entity_id = ${entity.id} and relatorio = 'fluxo' order by ordem`
  ).map((l): LinhaPlanilha => ({
    ordem: l.ordem, tipo: l.tipo as TipoLinha, rotulo: l.rotulo, detalhe: l.detalhe,
    valores: JSON.parse(l.valores ?? "[]") as (string | null)[], total: l.total,
  }));
  const ultimoCopiado = Math.max(-1, ...linhas.flatMap((l) => l.valores.flatMap((v, i) => (v == null ? [] : [i]))));
  const ultimoComExtrato = Math.max(
    -1,
    ...report.periods.map((_, i) => i).filter((i) => report.sections.some((s) => s.totals[i] !== 0n)),
  );
  const meses = Array.from({ length: Math.max(0, ultimoComExtrato - ultimoCopiado) }, (_, k) => ultimoCopiado + 1 + k);
  const mostrar = soMes === null ? meses : meses.filter((m) => m === soMes);
  const pronto = preencherComORazao(linhas, report, meses, SOCIOS_LABEL);

  const [ultimoDia] = await sql<{ d: string }[]>`
    select max(occurred_on)::text as d from cash_entries ce join accounts a on a.id = ce.account_id
     where ce.entity_id = ${entity.id} and a.type <> 'credit_card'`;
  console.log(`\n${BOLD}Fluxo de caixa — a planilha até ${NOMES[ultimoCopiado]}, o app depois${RESET}`);
  console.log(`${DIM}último lançamento de banco: ${ultimoDia?.d ?? "—"}${RESET}\n`);
  const cab = mostrar.map((m) => NOMES[m]!.padStart(16)).join("");
  console.log(`${"".padEnd(44)}${(NOMES[ultimoCopiado] ?? "").padStart(16)} ${DIM}(planilha)${RESET}${cab}`);
  for (const l of pronto) {
    const vals = mostrar.map((m) => l.valores[m] ?? null);
    const temAlgo = vals.some((v) => v !== null && fromNumeric(v) !== 0n);
    if (l.tipo === "linha" && !temAlgo) continue;
    const fmt = (v: string | null | undefined) => (v == null ? "—" : formatBRL(fromNumeric(v))).padStart(16);
    const rot = l.tipo === "linha" ? `  ${l.rotulo}` : l.tipo === "secao" ? `${BOLD}${l.rotulo}${RESET}` : `${l.tipo === "total" ? BOLD : ""}${l.rotulo}${RESET}`;
    const largura = l.tipo === "secao" ? 44 + BOLD.length + RESET.length : l.tipo === "linha" ? 44 : 44 + (l.tipo === "total" ? BOLD.length : 0) + RESET.length;
    if (l.tipo === "secao") {
      console.log(`\n${rot}`);
      continue;
    }
    console.log(`${rot.slice(0, largura).padEnd(largura)}${fmt(l.valores[ultimoCopiado] ?? null)}           ${CYAN}${vals.map(fmt).join("")}${RESET}`);
  }
  console.log(`\n${DIM}${report.warnings.join("\n")}${RESET}\n`);
} finally {
  await sql.end();
}
