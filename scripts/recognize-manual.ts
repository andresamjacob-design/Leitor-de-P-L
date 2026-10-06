/**
 * Writes the monthly plan of a `manual` contract into `recognition_entries`.
 *
 * The engine generates nothing for a contract whose method is `manual` — and rightly so:
 * `manual` means the lines are entered by hand. But for these contracts the hand is the
 * spreadsheet the company already keeps. Gringo bills 104.000 for three months, 65.000 for
 * one and 40.000 for five; that is not an unknown schedule waiting to be invented, it is a
 * known one that neither `straight_line` nor `poc` can express. `propose-contracts` stored
 * it month by month in `contract_items`, and this turns those into competência.
 *
 * Without it half the year is invisible: twelve contracts, and the largest client among
 * them.
 *
 * Two limits it respects:
 *
 *   - **Nothing beyond the current month.** Revenue that has not been earned is not
 *     recognised, however confident the forecast. The engine's own bulk action stops at
 *     today, and so does this.
 *   - **Nothing already there.** The unique key `(contrato, período, origem, tipo)` makes
 *     a second run a no-op, so a row somebody edited afterwards survives it.
 *
 *   npm run recognize:manual
 *   npm run recognize:manual -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatMoney, parseMoney, toNumeric } from "@/lib/money";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");

const GREEN = "[32m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/**
 * The account a contract's type reaches. Mirrors `REVENUE_CODE` in
 * src/lib/data/contracts.ts — and, like it, only decides when the contract does not carry
 * its own `category_id` (migration 0005).
 */
const REVENUE_CODE: Record<string, string> = { retainer: "3.01", project: "3.02" };

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** `Janeiro/2026` → `2026-01-01`, the first day of the month (D18). */
function periodOf(description: string): string | null {
  const match = /^(.+)\/(\d{4})$/.exec(description.trim());
  if (!match) return null;
  const index = MONTH_NAMES.indexOf(match[1]!.trim());
  if (index < 0) return null;
  return `${match[2]}-${String(index + 1).padStart(2, "0")}-01`;
}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const entities = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  const entity = entities[0];
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");
  const entityId = entity.id;

  const users = await sql<{ id: string }[]>`
    select user_id as id from user_entities where entity_id = ${entityId} limit 1`;
  const userId = users[0]?.id ?? null;

  const categories = await sql<{ id: string; code: string }[]>`
    select id, code from categories where entity_id = ${entityId}`;
  const categoryByCode = new Map(categories.map((category) => [category.code, category.id]));

  const now = new Date();
  const through = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const rows = await sql<
    {
      contractId: string;
      contractName: string;
      clientId: string;
      type: string;
      status: string;
      categoryOverrideId: string | null;
      description: string;
      value: string;
    }[]
  >`
    select c.id as "contractId", c.name as "contractName", c.client_id as "clientId",
           c.type::text as type, c.status::text as status,
           c.category_id as "categoryOverrideId",
           i.description, i.value::text as value
    from contracts c
    join contract_items i on i.contract_id = c.id
    where c.entity_id = ${entityId}
      and c.recognition_method = 'manual'
      and c.status in ('active', 'completed')
    order by c.name, i.description`;

  type Line = { contractId: string; clientId: string; categoryId: string; period: string; amount: bigint };
  const lines: Line[] = [];
  const byContract = new Map<string, { name: string; months: number; total: bigint }>();
  const skippedFuture: string[] = [];

  for (const row of rows) {
    const period = periodOf(row.description);
    if (!period) continue;
    if (period > through) {
      skippedFuture.push(`${row.contractName} · ${row.description}`);
      continue;
    }

    // The contract's own account wins; the type is the fallback.
    const categoryId = row.categoryOverrideId ?? categoryByCode.get(REVENUE_CODE[row.type] ?? "");
    if (!categoryId) continue;

    const amount = parseMoney(row.value, { decimalSeparator: "." });
    lines.push({ contractId: row.contractId, clientId: row.clientId, categoryId, period, amount });

    const tally = byContract.get(row.contractId) ?? { name: row.contractName, months: 0, total: 0n };
    byContract.set(row.contractId, {
      name: tally.name,
      months: tally.months + 1,
      total: tally.total + amount,
    });
  }

  console.log(
    `\n${BOLD}${byContract.size} contratos manuais, ${lines.length} meses até ${through.slice(0, 7)}${RESET}\n`,
  );
  for (const tally of [...byContract.values()].sort((a, b) => Number(b.total - a.total))) {
    console.log(
      `  ${tally.name.padEnd(32).slice(0, 32)} ${String(tally.months).padStart(2)} meses  ` +
        `${formatMoney(tally.total).padStart(14)}`,
    );
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0n);
  console.log(`\n${BOLD}${formatMoney(total)} de competência a gravar.${RESET}`);
  if (skippedFuture.length > 0) {
    console.log(`${DIM}${skippedFuture.length} meses futuros não reconhecidos, corretamente.${RESET}`);
  }

  if (!APPLY) {
    console.log(`\n${DIM}nada foi gravado. Rode com --aplicar.${RESET}\n`);
  } else {
    let written = 0;
    for (const line of lines) {
      const result = await sql`
        insert into recognition_entries
          (entity_id, period, contract_id, client_id, category_id, kind, amount,
           method, source, created_by)
        values (${entityId}, ${line.period}, ${line.contractId}, ${line.clientId},
                ${line.categoryId}, 'revenue', ${toNumeric(line.amount)},
                'manual', 'manual', ${userId})
        on conflict (contract_id, period, source, kind) do nothing
        returning id`;
      written += result.length;
    }
    console.log(
      `\n${GREEN}${written} linhas de competência gravadas${RESET}` +
        `${written < lines.length ? `, ${lines.length - written} já existiam` : ""}.\n`,
    );
  }
} finally {
  await sql.end();
}
