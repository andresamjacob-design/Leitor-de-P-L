/**
 * Clears the category of money that *arrived* in a cost category without a payment to
 * reverse — the defect the handover records as §5.3.
 *
 * The rule it applies lives in `src/lib/recognition/cost-credits.ts`, pure and tested.
 * This file is the part that talks to the database: it loads every credit sitting in a
 * cost, expense or tax category, hands each one the outgoing entries of that same
 * category as candidates, and clears the ones the rule refuses.
 *
 * **It never deletes a cash entry.** That is deliberate and worth stating, because
 * "apague esse PIX" is the natural way to ask for this. The R$ 115.000 that came back
 * from Ricardo is a real line of the bank statement: the conta corrente only reconciles
 * to the R$ 226.916,33 the bank declares *because* that line is there. Removing it would
 * trade a wrong category — which shows up as a pendência and gets filed — for a ledger
 * that no longer matches the bank, which is the harder error to ever find again. Clearing
 * the category deletes the competência mirror through `planCashMirror` returning null, so
 * the money leaves the DRE and the folha and stays in the caixa, which is exactly where a
 * payment that went out and came back belongs.
 *
 * Respects D-A: a mirror somebody edited by hand is left alone, and so is its entry.
 *
 *   npm run fix:credits            # dry run, decide nothing
 *   npm run fix:credits -- --ensaio   # grava numa transação revertida e mede
 *   npm run fix:credits -- --aplicar
 */

import postgres from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { formatBRL, fromNumeric } from "@/lib/money";
import { judgeCostCredit, VERDICT_LABEL } from "@/lib/recognition/cost-credits";
import type { CostCredit, Payment, Verdict } from "@/lib/recognition/cost-credits";
import type { AccountType, CategoryKind } from "@/lib/ledger-types";

loadEnvLocal();

const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definido — veja o README.");

const sql = postgres(url, { max: 1, connect_timeout: 20 });

type Row = {
  id: string;
  entity_id: string;
  occurred_on: string;
  direction: "in" | "out";
  amount: string;
  description: string;
  counterparty_name: string | null;
  category_id: string | null;
  category_code: string | null;
  category_name: string | null;
  category_kind: CategoryKind | null;
  account_name: string;
  account_type: AccountType;
  mirror_id: string | null;
  mirror_manually_edited: boolean | null;
};

/** Postgres `date` comes back as a Date; the whole codebase speaks `YYYY-MM-DD`. */
function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function contaCorrenteBalance(db: postgres.Sql | postgres.TransactionSql) {
  const [row] = await db<{ saldo: string }[]>`
    select (a.opening_balance +
            coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0)) as saldo
    from accounts a
    left join cash_entries e on e.account_id = a.id
    where a.type = 'bank' and a.name ilike 'Ita%conta corrente%'
    group by a.id, a.opening_balance`;
  return row ? fromNumeric(row.saldo) : 0n;
}

try {
  const rows = await sql<Row[]>`
    select e.id, e.entity_id, e.occurred_on, e.direction, e.amount, e.description,
           e.counterparty_name, e.category_id,
           c.code as category_code, c.name as category_name, c.kind as category_kind,
           a.name as account_name, a.type as account_type,
           r.id as mirror_id, r.manually_edited as mirror_manually_edited
    from cash_entries e
    join categories c on c.id = e.category_id
    join accounts a on a.id = e.account_id
    left join recognition_entries r
      on r.cash_entry_id = e.id and r.source = 'cash_mirror'
    where e.direction = 'in' and c.kind in ('cost', 'expense', 'tax')
    order by c.code, e.amount desc`;

  // The candidate payments: every outgoing entry of the categories in play. Loaded once
  // rather than per credit — 49 credits would otherwise be 49 round trips.
  const categoryIds = [...new Set(rows.map((row) => row.category_id).filter((id) => id !== null))];
  const payments = categoryIds.length
    ? await sql<{ category_id: string; occurred_on: string; amount: string }[]>`
        select category_id, occurred_on, amount from cash_entries
        where direction = 'out' and category_id in ${sql(categoryIds)}`
    : [];

  const byCategory = new Map<string, Payment[]>();
  for (const row of payments) {
    const list = byCategory.get(row.category_id) ?? [];
    list.push({
      direction: "out",
      occurredOn: isoDate(row.occurred_on),
      amount: fromNumeric(row.amount),
    });
    byCategory.set(row.category_id, list);
  }

  const judged = rows.map((row) => {
    const subject: CostCredit = {
      accountType: row.account_type,
      categoryKind: row.category_kind,
      direction: row.direction,
      occurredOn: isoDate(row.occurred_on),
      amount: fromNumeric(row.amount),
    };
    const verdict: Verdict = judgeCostCredit(
      subject,
      byCategory.get(row.category_id ?? "") ?? [],
    );
    return { row, subject, verdict };
  });

  const toClear = judged.filter(({ verdict }) => !verdict.keep);
  const kept = judged.filter(({ verdict }) => verdict.keep);
  // D-A: a mirror a human edited is not the engine's to undo.
  const blocked = toClear.filter(({ row }) => row.mirror_manually_edited === true);
  const actionable = toClear.filter(({ row }) => row.mirror_manually_edited !== true);

  const total = (list: typeof judged) =>
    list.reduce((acc, item) => acc + item.subject.amount, 0n);

  console.log(
    `\n${BOLD}${rows.length} entradas em conta de custo${RESET}, somando ${formatBRL(total(judged))}\n`,
  );

  console.log(`${BOLD}Ficam como estão — ${kept.length} linhas, ${formatBRL(total(kept))}${RESET}`);
  const byReason = new Map<string, typeof judged>();
  for (const item of kept) {
    const list = byReason.get(item.verdict.reason) ?? [];
    list.push(item);
    byReason.set(item.verdict.reason, list);
  }
  for (const [reason, list] of byReason) {
    console.log(
      `  ${GREEN}✓${RESET} ${String(list.length).padStart(2)} linhas  ${DIM}${VERDICT_LABEL[reason as Verdict["reason"]]}${RESET}`,
    );
  }

  console.log(
    `\n${BOLD}Perdem a categoria — ${actionable.length} linhas, ${formatBRL(total(actionable))}${RESET}`,
  );
  for (const { row, subject } of actionable) {
    console.log(
      `  ${YELLOW}·${RESET} ${isoDate(row.occurred_on)}  ${formatBRL(subject.amount).padStart(14)}  ` +
        `[${row.category_code} ${row.category_name}]  ${row.description.slice(0, 38)}`,
    );
    console.log(
      `      ${DIM}${row.account_name} · ${row.counterparty_name ?? "sem contraparte"}` +
        `${row.mirror_id ? " · espelho de competência será removido" : ""}${RESET}`,
    );
  }

  if (blocked.length > 0) {
    console.log(
      `\n${YELLOW}${blocked.length} linhas não foram tocadas${RESET} — a competência delas foi editada à mão (D-A).`,
    );
  }

  if (actionable.length === 0) {
    console.log(`\n${DIM}nada a fazer.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(`\n${DIM}nada foi gravado. Rode com --ensaio para medir, ou --aplicar.${RESET}\n`);
  } else {
    const ids = actionable.map(({ row }) => row.id);
    const mirrorIds = actionable
      .map(({ row }) => row.mirror_id)
      .filter((id): id is string => id !== null);

    const antes = await contaCorrenteBalance(sql);

    const write = async (db: postgres.TransactionSql) => {
      // Order matters only in the other direction (an orphan mirror would be worse than
      // an orphan entry), but both happen in one transaction, so neither can be seen.
      if (mirrorIds.length > 0) {
        await db`delete from recognition_entries where id in ${db(mirrorIds)}`;
      }
      await db`update cash_entries set category_id = null where id in ${db(ids)}`;
      return contaCorrenteBalance(db);
    };

    let depois: bigint;
    if (REHEARSE) {
      const ROLLBACK = Symbol("ensaio");
      try {
        await sql.begin(async (db) => {
          depois = await write(db);
          throw ROLLBACK;
        });
        depois = antes;
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
      // `depois` is assigned inside the transaction before the rollback throw.
      depois ??= antes;
    } else {
      depois = await sql.begin(write);
    }

    console.log(
      `\n${BOLD}${REHEARSE ? "Ensaio (revertido)" : "Aplicado"}${RESET} — ` +
        `${ids.length} lançamentos sem categoria, ${mirrorIds.length} espelhos removidos.`,
    );
    console.log(`  conta corrente antes .... ${formatBRL(antes)}`);
    console.log(`  conta corrente depois ... ${formatBRL(depois)}`);
    console.log(
      antes === depois
        ? `  ${GREEN}o saldo não mudou — a conciliação com o extrato continua de pé.${RESET}\n`
        : `  ${YELLOW}o saldo mudou. Isso não deveria acontecer: só a categoria foi mexida.${RESET}\n`,
    );
  }
} finally {
  await sql.end();
}
