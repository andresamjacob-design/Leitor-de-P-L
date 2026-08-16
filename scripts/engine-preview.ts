/**
 * Running the real categorisation engine over the staged lines, for reporting only.
 *
 * Shared by `preview-categorize` (against the live connection) and by the `--ensaio` mode
 * of `propose-parties` (against an open transaction that is about to be rolled back). It
 * takes whatever handle it is given, so the second case measures the effect of writes that
 * will never be committed — the only honest way to answer "what would I get" without
 * finding out the hard way.
 *
 * Deliberately no duplicated matching logic: it calls `suggestCategory`, the same function
 * the review screen calls. A preview that reimplements the engine is a preview of nothing.
 */

import type { Sql } from "postgres";
import { suggestCategory, type EngineInput } from "@/lib/categorize/engine";
import type { HistoryEntry, Person, Rule, Subject, Suggestion } from "@/lib/categorize/types";
import { parseMoney, formatMoney } from "@/lib/money";

/** Where a recognised person's salary lands. Mirrors `src/lib/data/categorize.ts`. */
const PAYROLL_CODE = "6.02";

const GREEN = "[32m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/** postgres.js hands `numeric` back as text, which is the only safe way to read it (D77). */
export const money = (value: string) => parseMoney(value, { decimalSeparator: "." });

export type Decision = { id: string; suggestion: Suggestion };

export type Preview = {
  total: number;
  decided: number;
  undecidedValue: bigint;
  bySource: Map<string, number>;
  byCategory: Map<string, { lines: number; total: bigint }>;
  rules: number;
  people: number;
  history: number;
  /** One per line the engine decided, so a caller can write them where the UI would. */
  decisions: Decision[];
};

export async function runPreview(sql: Sql, entityId: string): Promise<Preview> {
  const categories = await sql<{ id: string; code: string }[]>`
    select id, code from categories where entity_id = ${entityId}`;
  const payrollCategoryId = categories.find((category) => category.code === PAYROLL_CODE)?.id ?? null;

  const ruleRows = await sql<Record<string, string | number | boolean | null>[]>`
    select id, priority, match_type, pattern, counterparty_tax_id, direction,
           amount_min::text as amount_min, amount_max::text as amount_max,
           account_id, category_id, client_id, person_id, active, hit_count
    from categorization_rules where entity_id = ${entityId}`;

  const rules: Rule[] = ruleRows.map((row) => ({
    id: row["id"] as string,
    priority: row["priority"] as number,
    matchType: row["match_type"] as Rule["matchType"],
    pattern: row["pattern"] as string,
    counterpartyTaxId: row["counterparty_tax_id"] as string | null,
    direction: row["direction"] as Rule["direction"],
    amountMin: row["amount_min"] === null ? null : money(row["amount_min"] as string),
    amountMax: row["amount_max"] === null ? null : money(row["amount_max"] as string),
    accountId: row["account_id"] as string | null,
    categoryId: row["category_id"] as string,
    clientId: row["client_id"] as string | null,
    personId: row["person_id"] as string | null,
    active: row["active"] as boolean,
    hitCount: row["hit_count"] as number,
  }));

  const people = await sql<Person[]>`
    select id, name, tax_id as "taxId" from people where entity_id = ${entityId} and active`;

  const history = await sql<HistoryEntry[]>`
    select description,
           counterparty_tax_id as "counterpartyTaxId",
           category_id         as "categoryId",
           client_id           as "clientId",
           person_id           as "personId",
           occurred_on::text   as "occurredOn"
    from cash_entries
    where entity_id = ${entityId} and category_id is not null
    order by occurred_on desc limit 5000`;

  const input: EngineInput = { rules, history, people, payrollCategoryId };

  // Only what is still pending: a line already approved or rejected is a decision someone
  // made, and re-deciding it is the behaviour that makes an automatic system untrustworthy.
  const staged = await sql<
    {
      id: string;
      description: string;
      amount: string;
      accountId: string;
      counterpartyTaxId: string | null;
      counterpartyName: string | null;
    }[]
  >`
    select s.id, s.description, s.amount::text as amount,
           i.account_id          as "accountId",
           s.counterparty_tax_id as "counterpartyTaxId",
           s.counterparty_name   as "counterpartyName"
    from staged_transactions s
    join statement_imports i on i.id = s.import_id
    where s.entity_id = ${entityId} and s.status = 'pending'
    order by s.occurred_on`;

  const bySource = new Map<string, number>();
  const byCategory = new Map<string, { lines: number; total: bigint }>();
  const decisions: Decision[] = [];
  let decided = 0;
  let undecidedValue = 0n;

  for (const row of staged) {
    const amount = money(row.amount);
    const magnitude = amount < 0n ? -amount : amount;
    const subject: Subject = {
      description: row.description,
      amount,
      direction: amount < 0n ? "out" : "in",
      accountId: row.accountId,
      counterpartyTaxId: row.counterpartyTaxId,
      counterpartyName: row.counterpartyName,
    };

    const suggestion = suggestCategory(subject, input);
    if (!suggestion) {
      undecidedValue += magnitude;
      continue;
    }

    decided += 1;
    decisions.push({ id: row.id, suggestion });
    bySource.set(suggestion.source, (bySource.get(suggestion.source) ?? 0) + 1);
    const current = byCategory.get(suggestion.categoryId) ?? { lines: 0, total: 0n };
    byCategory.set(suggestion.categoryId, {
      lines: current.lines + 1,
      total: current.total + magnitude,
    });
  }

  return {
    total: staged.length,
    decided,
    undecidedValue,
    bySource,
    byCategory,
    rules: rules.length,
    people: people.length,
    history: history.length,
    decisions,
  };
}

/**
 * Writes the engine's decisions onto the staged rows — what the “Categorizar” button does.
 *
 * Only `suggested_*`, `suggestion_source` and `confidence`, exactly as
 * `suggestForImport` in src/lib/data/categorize.ts. A suggestion is not an approval: the
 * line stays `pending` and still waits for a human (SPEC §7).
 */
export async function writeSuggestions(sql: Sql, decisions: readonly Decision[]): Promise<number> {
  let written = 0;
  for (const { id, suggestion } of decisions) {
    await sql`
      update staged_transactions set
        suggested_category_id = ${suggestion.categoryId},
        suggested_client_id   = ${suggestion.clientId},
        suggested_person_id   = ${suggestion.personId},
        suggestion_source     = ${suggestion.ruleId ? "rule" : "none"},
        confidence            = ${suggestion.confidence.toFixed(3)}
      where id = ${id}`;
    written += 1;
  }
  return written;
}

export function report(preview: Preview, names: Map<string, { code: string; name: string }>): void {
  console.log(
    `\n${BOLD}${preview.rules} regras, ${preview.people} pessoas e ${preview.history} lançamentos ` +
      `de histórico, contra ${preview.total} linhas paradas${RESET}\n`,
  );

  const share = preview.total === 0 ? 0 : (preview.decided / preview.total) * 100;
  console.log(
    `${BOLD}${GREEN}${preview.decided} de ${preview.total} linhas categorizadas (${share.toFixed(1)}%)${RESET}, ` +
      `${preview.total - preview.decided} sem decisão ${DIM}somando ${formatMoney(preview.undecidedValue)}${RESET}\n`,
  );

  if (preview.bySource.size > 0) {
    console.log(`${BOLD}por que o motor decidiu${RESET}`);
    for (const [source, count] of [...preview.bySource].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${source}`);
    }
  }

  if (preview.byCategory.size > 0) {
    console.log(`\n${BOLD}onde as linhas caíram${RESET}`);
    for (const [categoryId, tally] of [...preview.byCategory].sort((a, b) => b[1].lines - a[1].lines)) {
      const category = names.get(categoryId);
      console.log(
        `  ${String(tally.lines).padStart(4)}  ${(category?.code ?? "?").padEnd(6)}` +
          `${(category?.name ?? "—").padEnd(34)} ${DIM}${formatMoney(tally.total)}${RESET}`,
      );
    }
  }
}
