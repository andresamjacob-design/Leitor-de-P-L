/**
 * Turns the revenue block of the `DRE Geral` sheet into contracts.
 *
 * The cash side of the books is nearly full and the competence side is empty: without a
 * contract there is no revenue recognition, so the DRE gerencial shows cost mirrored from
 * cash and nothing above it. The sheet already holds what a contract needs — who, what
 * scope, and how much per month across 2026 — so this reads it rather than asking someone
 * to retype sixty rows.
 *
 * What it will not invent:
 *
 *   - **`poc` is never assigned.** Percentage-of-completion needs someone to report
 *     progress; the sheet says nothing about it, so a contract whose months are equal
 *     gets `straight_line` and one whose months vary gets `manual`. Switching a project
 *     to POC afterwards is a decision, and it belongs to a person.
 *   - **A varying month is never smoothed.** Gringo bills 104.000 for three months and
 *     40.000 for six; averaging that would invent a number nobody agreed to. Those months
 *     are written one by one into `contract_items`, and the contract carries the total.
 *   - **A row with no value in any month becomes nothing.** The sheet lists prospects
 *     alongside contracts; a contract with no money in it is a line in a spreadsheet.
 *
 * Each row is its own contract, deliberately: `Mary kay - B2B` and `Mary kay - TBD` are
 * two contracts of one client, and the qualifier after the dash is what says so.
 *
 *   npm run propose:contracts             # mostra o que faria
 *   npm run propose:contracts -- --ensaio # grava numa transação revertida
 *   npm run propose:contracts -- --aplicar
 */

import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readXlsx } from "@/lib/import/xlsx";
import { formatMoney, toNumeric } from "@/lib/money";

loadEnvLocal();

// `--planilha` para ler outra versão — a de 24/09 traz o bloco GSJACOB e os contratos novos
// de agosto e setembro (D162).
const SPREADSHEET = (() => {
  const i = process.argv.indexOf("--planilha");
  return i === -1 ? "docs/reference/Claude de DRE - Dynamics Data 2026.xlsx" : (process.argv[i + 1] as string);
})();
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/** Thrown to undo everything the rehearsal inserted. */
class Rollback extends Error {}

import {
  type Draft,
  lastDayOf,
  lerContratosDaDre,
  MONTH_NAMES,
  pad,
  REACHABLE_BY_TYPE,
  YEAR,
} from "@/lib/contratos-da-planilha";

function readDrafts() {
  const dre = readXlsx(new Uint8Array(readFileSync(SPREADSHEET))).find((sheet) => sheet.name === "DRE Geral");
  if (!dre) throw new Error("aba “DRE Geral” não encontrada");
  return lerContratosDaDre(dre.rows);
}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const entities = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  const entity = entities[0];
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");
  const entityId = entity.id;

  const categories = await sql<{ id: string; code: string }[]>`
    select id, code from categories where entity_id = ${entityId}`;
  const categoryByCode = new Map(categories.map((category) => [category.code, category.id]));

  const clients = await sql<{ id: string; name: string }[]>`
    select id, name from clients where entity_id = ${entityId}`;
  const clientByName = new Map(clients.map((client) => [client.name.toLowerCase(), client]));

  const existing = await sql<{ name: string }[]>`
    select name from contracts where entity_id = ${entityId}`;
  const already = new Set(existing.map((row) => row.name.toLowerCase()));

  const { drafts, empty, unknown, declared } = readDrafts();

  console.log(
    `\n${BOLD}${drafts.length} contratos com valor no bloco de receita de ${YEAR}${RESET}\n`,
  );

  let missingClients = 0;
  const pending: Draft[] = [];

  for (const draft of drafts) {
    const client = clientByName.get(draft.clientLabel.toLowerCase());
    const isNew = !already.has(draft.label.toLowerCase());
    if (isNew) pending.push(draft);
    if (!client) missingClients += 1;

    const span =
      draft.firstMonth === draft.lastMonth
        ? MONTH_NAMES[draft.firstMonth]!.slice(0, 3)
        : `${MONTH_NAMES[draft.firstMonth]!.slice(0, 3)}–${MONTH_NAMES[draft.lastMonth]!.slice(0, 3)}`;

    console.log(
      `  ${draft.type === "retainer" ? "🔁" : "📦"} ${draft.label.padEnd(30).slice(0, 30)} ` +
        `${DIM}${draft.clientLabel.padEnd(18).slice(0, 18)}${RESET} ` +
        `${span.padEnd(8)} ${formatMoney(draft.total).padStart(12)}  ` +
        `${draft.recognition === "straight_line" ? `${GREEN}linear${RESET}` : `${YELLOW}manual${RESET}`}` +
        `${draft.monthlyValue ? ` ${DIM}${formatMoney(draft.monthlyValue)}/mês${RESET}` : ""}` +
        `${client ? "" : `  ${YELLOW}cliente a cadastrar${RESET}`}` +
        `${REACHABLE_BY_TYPE.has(draft.code) ? "" : `  ${YELLOW}conta ${draft.code} no próprio contrato${RESET}`}` +
        `${isNew ? "" : `  ${DIM}já existe${RESET}`}`,
    );
  }

  if (unknown.length > 0) {
    console.log(
      `\n${BOLD}${YELLOW}escopo desconhecido — tem valor e não foi classificado${RESET}\n` +
        unknown.map((line) => `  ${line}`).join("\n"),
    );
  }

  if (empty.length > 0) {
    console.log(
      `\n${DIM}${empty.length} linhas sem valor em nenhum mês, ignoradas: ${empty.slice(0, 8).join(", ")}` +
        `${empty.length > 8 ? "…" : ""}${RESET}`,
    );
  }

  const totalValue = pending.reduce((sum, draft) => sum + draft.total, 0n);
  console.log(
    `\n${BOLD}${pending.length} contratos a criar, somando ${formatMoney(totalValue)}.${RESET}` +
      `${missingClients > 0 ? ` ${YELLOW}${missingClients} precisam de cliente novo.${RESET}` : ""}`,
  );

  const everything = drafts.reduce((sum, draft) => sum + draft.total, 0n);
  if (declared !== null) {
    const difference = everything - declared;
    // A cent or two is the sheet's own rounding: it stores 5833.333333 and prints a total
    // that was summed before rounding. More than that means a row went missing.
    const ok = (difference < 0n ? -difference : difference) <= 2n;
    console.log(
      `${ok ? GREEN : YELLOW}confere com a planilha:${RESET} ${formatMoney(everything)} lidos ` +
        `contra ${formatMoney(declared)} declarados no total do ano` +
        `${ok ? "" : ` ${YELLOW}— diferença de ${formatMoney(difference)}${RESET}`}`,
    );
  }

  async function write(db: Sql): Promise<{ contracts: number; items: number; clients: number }> {
    let created = 0;
    let items = 0;
    let newClients = 0;
    const resolved = new Map(clientByName);

    for (const draft of pending) {
      let client = resolved.get(draft.clientLabel.toLowerCase());
      if (!client) {
        // A name in the revenue block is a client, even one that never paid into this
        // account in the imported period. No tax id is invented for it.
        const inserted = await db<{ id: string; name: string }[]>`
          insert into clients (entity_id, name) values (${entityId}, ${draft.clientLabel})
          returning id, name`;
        client = inserted[0]!;
        resolved.set(draft.clientLabel.toLowerCase(), client);
        newClients += 1;
      }

      const startDate = `${YEAR}-${pad(draft.firstMonth + 1)}-01`;
      const endDate = `${YEAR}-${pad(draft.lastMonth + 1)}-${pad(lastDayOf(draft.lastMonth))}`;

      const contract = await db<{ id: string }[]>`
        insert into contracts
          (entity_id, client_id, name, type, status, category_id, total_value, monthly_value,
           start_date, end_date, billing_terms, recognition_method, prorate_first_last_month)
        values (${entityId}, ${client.id}, ${draft.label}, ${draft.type}, ${draft.status},
                ${REACHABLE_BY_TYPE.has(draft.code) ? null : (categoryByCode.get(draft.code) ?? null)},
                ${toNumeric(draft.total)},
                ${draft.monthlyValue === null ? null : toNumeric(draft.monthlyValue)},
                ${startDate}, ${endDate}, ${draft.billing === "" ? null : draft.billing},
                ${draft.recognition}, false)
        returning id`;
      const contractId = contract[0]!.id;
      created += 1;

      // Only when the months differ: for a straight line the monthly value already says
      // everything, and repeating it twelve times would be noise.
      if (draft.recognition === "manual") {
        for (const [index, value] of draft.months.entries()) {
          if (value === null) continue;
          await db`
            insert into contract_items (entity_id, contract_id, description, value)
            values (${entityId}, ${contractId}, ${`${MONTH_NAMES[index]}/${YEAR}`},
                    ${toNumeric(value)})`;
          items += 1;
        }
      }
    }

    return { contracts: created, items, clients: newClients };
  }

  if (pending.length === 0) {
    console.log(`\n${DIM}nada a fazer.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para ensaiar numa transação revertida, ` +
        `ou --aplicar para criar.${RESET}\n`,
    );
  } else {
    const done = await (REHEARSE
      ? sql
          .begin(async (tx) => {
            const counts = await write(tx as unknown as Sql);
            throw new Rollback(JSON.stringify(counts));
          })
          .catch((error: unknown) => {
            if (error instanceof Rollback) {
              return JSON.parse(error.message) as { contracts: number; items: number; clients: number };
            }
            throw error;
          })
      : write(sql));

    console.log(
      `\n${GREEN}${done.contracts} contratos, ${done.items} parcelas mensais e ` +
        `${done.clients} clientes novos ${REHEARSE ? "seriam criados" : "criados"}.${RESET}`,
    );
    if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada foi gravado.${RESET}\n`);
    else console.log("");
  }
} finally {
  await sql.end();
}
