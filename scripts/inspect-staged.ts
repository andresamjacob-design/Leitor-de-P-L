/**
 * Read-only look at what is sitting in `staged_transactions`.
 *
 * Answers the question the handoff left half-open: how many of the uncategorised lines
 * carry a `counterparty_tax_id`. That number decides the order of the work — the engine
 * prefers identity over text (D40), so if most lines name a counterparty, registering
 * people and clients beats writing any number of text rules.
 *
 * Never prints a tax id in full: the last digits are enough to tell two apart, and this
 * output ends up in terminals and transcripts.
 *
 *   npm run inspect:staged
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";

loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

const sql = postgres(url, { max: 1, connect_timeout: 20 });

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

try {
  const columns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_name = 'categorization_rules' and column_name = 'direction'`;
  console.log(
    `\n${BOLD}coluna direction em categorization_rules:${RESET} ${
      columns.length === 1 ? "presente" : "AUSENTE — migration 0004 não aplicada"
    }`,
  );

  const [totals] = await sql<
    {
      total: string;
      com_cnpj: string;
      com_nome: string;
      categorizadas: string;
      entradas: string;
      saidas: string;
    }[]
  >`
    select
      count(*)                                                          as total,
      count(*) filter (where counterparty_tax_id is not null)           as com_cnpj,
      count(*) filter (where counterparty_name is not null)             as com_nome,
      count(*) filter (where suggested_category_id is not null)         as categorizadas,
      count(*) filter (where amount > 0)                                as entradas,
      count(*) filter (where amount < 0)                                as saidas
    from staged_transactions`;

  if (!totals) throw new Error("consulta de totais não retornou linha");

  const total = Number(totals.total);
  console.log(`\n${BOLD}staged_transactions — ${total} linhas${RESET}`);
  console.log(`  entradas ....................... ${totals.entradas}`);
  console.log(`  saídas ......................... ${totals.saidas}`);
  console.log(`  já com categoria sugerida ...... ${totals.categorizadas}`);
  console.log(
    `  com counterparty_name .......... ${totals.com_nome} ${DIM}(${pct(Number(totals.com_nome), total)})${RESET}`,
  );
  console.log(
    `  com counterparty_tax_id ........ ${totals.com_cnpj} ${DIM}(${pct(Number(totals.com_cnpj), total)})${RESET}`,
  );

  const [semCategoria] = await sql<{ total: string; com_cnpj: string; com_nome: string }[]>`
    select
      count(*)                                                as total,
      count(*) filter (where counterparty_tax_id is not null) as com_cnpj,
      count(*) filter (where counterparty_name is not null)   as com_nome
    from staged_transactions
    where suggested_category_id is null`;

  if (!semCategoria) throw new Error("consulta de não-categorizadas não retornou linha");

  const sem = Number(semCategoria.total);
  console.log(`\n${BOLD}das ${sem} sem categoria${RESET}`);
  console.log(
    `  com counterparty_name .......... ${semCategoria.com_nome} ${DIM}(${pct(Number(semCategoria.com_nome), sem)})${RESET}`,
  );
  console.log(
    `  com counterparty_tax_id ........ ${semCategoria.com_cnpj} ${DIM}(${pct(Number(semCategoria.com_cnpj), sem)})${RESET}`,
  );

  // A tax id is 11 digits (CPF, a person) or 14 (CNPJ, a company). Which of the two it is
  // says whether the line belongs to `people` or to `clients`.
  const porTipo = await sql<{ tipo: string; linhas: string; distintos: string }[]>`
    select
      case length(regexp_replace(counterparty_tax_id, '\\D', '', 'g'))
        when 11 then 'CPF (pessoa)'
        when 14 then 'CNPJ (empresa)'
        else 'outro tamanho'
      end                                                        as tipo,
      count(*)                                                   as linhas,
      count(distinct regexp_replace(counterparty_tax_id, '\\D', '', 'g')) as distintos
    from staged_transactions
    where suggested_category_id is null and counterparty_tax_id is not null
    group by 1 order by 2 desc`;

  if (porTipo.length > 0) {
    console.log(`\n${BOLD}contrapartes identificadas, por tipo de documento${RESET}`);
    for (const row of porTipo) {
      console.log(
        `  ${row.tipo.padEnd(16)} ${row.linhas.padStart(4)} linhas ${DIM}em ${row.distintos} documentos distintos${RESET}`,
      );
    }
  }

  const topContrapartes = await sql<
    { nome: string; documento: string; linhas: string; entradas: string; saidas: string }[]
  >`
    select
      coalesce(counterparty_name, '—')                           as nome,
      right(regexp_replace(counterparty_tax_id, '\\D', '', 'g'), 4) as documento,
      count(*)                                                   as linhas,
      count(*) filter (where amount > 0)                         as entradas,
      count(*) filter (where amount < 0)                         as saidas
    from staged_transactions
    where suggested_category_id is null and counterparty_tax_id is not null
    group by 1, 2 order by 3 desc limit 25`;

  if (topContrapartes.length > 0) {
    console.log(`\n${BOLD}contrapartes mais frequentes sem categoria${RESET} ${DIM}(documento mascarado)${RESET}`);
    for (const row of topContrapartes) {
      const nome = row.nome.length > 38 ? `${row.nome.slice(0, 37)}…` : row.nome.padEnd(38);
      console.log(
        `  ${row.linhas.padStart(3)}  ${nome} ${DIM}…${row.documento}  ${row.entradas}e/${row.saidas}s${RESET}`,
      );
    }
  }

  const semNada = await sql<{ prefixo: string; linhas: string }[]>`
    select
      substring(upper(description) from '^[A-Z ]+')  as prefixo,
      count(*)                                       as linhas
    from staged_transactions
    where suggested_category_id is null and counterparty_tax_id is null
    group by 1 order by 2 desc limit 15`;

  if (semNada.length > 0) {
    console.log(`\n${BOLD}sem categoria e sem documento — só resta o texto${RESET}`);
    for (const row of semNada) {
      console.log(`  ${row.linhas.padStart(3)}  ${(row.prefixo ?? "—").trim()}`);
    }
  }

  console.log("");
} finally {
  await sql.end();
}
