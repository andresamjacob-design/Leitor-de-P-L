/**
 * Gives the CDB account the leg it never got — the handover's §5.1, the largest defect
 * still open.
 *
 * `Itaú — CDB DI` was seeded with R$ 367.735,49 on 01/01/2026 and has **zero entries**.
 * Every movement of the CDB lives only in the conta corrente, as a 99.03 transfer:
 *
 *     2026-01-07  entra   367.735,49   RESGATE CDB
 *     2026-06-09  sai     300.000,00   APLICACAO CDB DI
 *     2026-06-15  sai     100.000,00   APLICACAO CDB DI
 *     2026-07-01  sai      50.000,00   APLICACAO CDB DI
 *     2026-07-28  sai      35.000,00   APLICACAO CDB DI
 *
 * A transfer with one leg lies twice. The January resgate emptied the CDB into the conta
 * corrente, so that money is inside the R$ 226.916,33 **and** still frozen in the CDB's
 * opening balance — counted twice. And the R$ 485.000 applied from June left the conta
 * corrente and arrived nowhere — money that simply vanished from the report.
 *
 * Nothing here is invented. Each leg is fully determined by a line the bank already
 * printed: same date, same amount, opposite direction, other account. The arithmetic
 * closes on a round number, which is the tell that the reading is right:
 *
 *     367.735,49 − 367.735,49 + 485.000,00 = 485.000,00
 *
 * **What this cannot see:** yield that stayed inside the CDB instead of being swept to the
 * conta corrente. The `REND PAGO APLIC AUT MAIS` credits land in the conta corrente, so
 * the sweep is the norm here — but R$ 485.000 is the principal, and a CDB statement is
 * still the only thing that proves the balance to the centavo. That caveat is printed
 * with the result rather than buried, and it is why this writes nothing without
 * `--aplicar`.
 *
 * Uses the same mechanism as the Lançamentos screen: category 99.03 pairs as
 * `investment` in `transfer_pairs`, and the counterpart carries its own dedup hash.
 *
 *   npm run propose:cdb
 *   npm run propose:cdb -- --ensaio
 *   npm run propose:cdb -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric, toNumeric } from "@/lib/money";
import { dedupHash } from "@/lib/dedup";
import type { EntryDirection } from "@/lib/ledger-types";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

type Leg = {
  id: string;
  entity_id: string;
  account_id: string;
  occurred_on: string;
  direction: EntryDirection;
  amount: string;
  description: string;
  category_id: string;
  paired: string | null;
};

async function balances(db: postgres.Sql | postgres.TransactionSql) {
  const rows = await db<{ name: string; saldo: string }[]>`
    select a.name,
           (a.opening_balance +
            coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0)) as saldo
    from accounts a
    left join cash_entries e on e.account_id = a.id
    where a.type in ('bank', 'cash', 'investment')
    group by a.id, a.name, a.opening_balance
    order by a.name`;
  return rows.map((row) => ({ name: row.name, saldo: fromNumeric(row.saldo) }));
}

try {
  const [cdb] = await sql<{ id: string; name: string; opening_balance: string }[]>`
    select id, name, opening_balance from accounts where name ilike '%CDB%'`;
  if (!cdb) throw new Error("conta CDB não encontrada");

  // The 99.03 lines of the conta corrente that name the CDB. `APL/RES APLIC AUT` is the
  // automatic overnight sweep and is discarded on import (D35), so it cannot appear here.
  const legs = await sql<Leg[]>`
    select e.id, e.entity_id, e.account_id, e.occurred_on, e.direction, e.amount,
           e.description, e.category_id,
           (select p.id from transfer_pairs p where p.from_cash_entry_id = e.id) as paired
    from cash_entries e
    join categories c on c.id = e.category_id
    join accounts a on a.id = e.account_id
    where c.code = '99.03'
      and a.id <> ${cdb.id}
      and (upper(e.description) like '%CDB%')
    order by e.occurred_on`;

  const pending = legs.filter((leg) => leg.paired === null);

  console.log(`\n${BOLD}${legs.length} transferências de CDB na conta corrente${RESET}`);
  let derived = 0n;
  for (const leg of legs) {
    // Out of the conta corrente is into the CDB.
    const signed = leg.direction === "out" ? fromNumeric(leg.amount) : -fromNumeric(leg.amount);
    derived += signed;
    console.log(
      `  ${isoDate(leg.occurred_on)}  ${formatBRL(fromNumeric(leg.amount)).padStart(14)}  ` +
        `${leg.direction === "out" ? "→ entra no CDB" : "← sai do CDB "}  ${leg.description.slice(0, 26)}` +
        `${leg.paired ? `  ${DIM}já pareada${RESET}` : ""}`,
    );
  }

  const abertura = fromNumeric(cdb.opening_balance);
  console.log(`\n${BOLD}O que o CDB deveria ter${RESET}`);
  console.log(`  abertura em 01/01/2026 ......... ${formatBRL(abertura).padStart(16)}`);
  console.log(`  movimento derivado ............. ${formatBRL(derived).padStart(16)}`);
  console.log(`  ${BOLD}saldo ..........................${formatBRL(abertura + derived).padStart(16)}${RESET}`);
  console.log(
    `\n${DIM}  Não enxerga rendimento que tenha ficado dentro do CDB em vez de ser varrido para\n` +
      `  a conta corrente. R$ 485.000,00 é o principal; só um extrato do CDB prova o centavo.${RESET}`,
  );

  const antes = await balances(sql);
  const caixaAntes = antes.reduce((acc, row) => acc + row.saldo, 0n);

  if (pending.length === 0) {
    console.log(`\n${GREEN}todas as pernas já existem — nada a fazer.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${YELLOW}${pending.length} pernas faltam${RESET} — nada foi gravado. Rode com --ensaio para medir, ou --aplicar.\n`,
    );
  } else {
    const write = async (db: postgres.TransactionSql) => {
      for (const leg of pending) {
        const opposite: EntryDirection = leg.direction === "out" ? "in" : "out";
        const amount = fromNumeric(leg.amount);
        const occurredOn = isoDate(leg.occurred_on);
        const hash = dedupHash({
          accountId: cdb.id,
          occurredOn,
          amount,
          direction: opposite,
          description: `${leg.description.trim()} (contrapartida de ${leg.id})`,
        });

        const [created] = await db<{ id: string }[]>`
          insert into cash_entries ${db({
            entity_id: leg.entity_id,
            account_id: cdb.id,
            occurred_on: occurredOn,
            amount: toNumeric(amount),
            direction: opposite,
            description: leg.description.trim(),
            category_id: leg.category_id,
            dedup_hash: hash,
          })} returning id`;

        await db`insert into transfer_pairs ${db({
          entity_id: leg.entity_id,
          from_cash_entry_id: leg.id,
          to_cash_entry_id: created!.id,
          to_account_id: cdb.id,
          kind: "investment",
        })}`;
      }
      return balances(db);
    };

    let depois = antes;
    if (REHEARSE) {
      const ROLLBACK = Symbol("ensaio");
      try {
        await sql.begin(async (db) => {
          depois = await write(db);
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
    } else {
      depois = await sql.begin(write);
    }

    const caixaDepois = depois.reduce((acc, row) => acc + row.saldo, 0n);
    console.log(
      `\n${BOLD}${REHEARSE ? "Ensaio (revertido)" : "Aplicado"}${RESET} — ${pending.length} pernas criadas.\n`,
    );
    for (const row of depois) {
      const before = antes.find((item) => item.name === row.name);
      const changed = before && before.saldo !== row.saldo;
      console.log(
        `  ${row.name.padEnd(32)} ${formatBRL(row.saldo).padStart(16)}` +
          `${changed ? `  ${YELLOW}antes ${formatBRL(before.saldo)}${RESET}` : ""}`,
      );
    }
    console.log(`\n  caixa total antes ..... ${formatBRL(caixaAntes).padStart(16)}`);
    console.log(`  caixa total depois .... ${formatBRL(caixaDepois).padStart(16)}`);
    console.log(
      `  ${GREEN}diferença ............. ${formatBRL(caixaDepois - caixaAntes).padStart(16)}${RESET}\n`,
    );
  }
} finally {
  await sql.end();
}
