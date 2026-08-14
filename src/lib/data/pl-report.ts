/**
 * Loading the P&L and the reports that hang off it.
 *
 * Everything here reads `recognition_entries`. The one place cash appears is the
 * two-ledger comparison, and there it is shown *beside* the P&L, never mixed into it.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, sum, type Cents } from "@/lib/money";
import { formatPeriodShort, periodOf, type IsoDate, type Period } from "@/lib/dates";
import { buildConsolidatedPl, buildPl, type PlCategory, type PlEntry, type PlReport } from "@/lib/pl";
import { listCategories } from "@/lib/data/categories";
import { listCashEntries } from "@/lib/data/cash-entries";
import { isCashAccount } from "@/lib/ledger-types";
import { listAccounts } from "@/lib/data/accounts";

export type RecognitionRow = {
  id: string;
  entityId: string;
  period: Period;
  categoryId: string;
  clientId: string | null;
  personId: string | null;
  contractId: string | null;
  amount: Cents;
  kind: "revenue" | "cost";
  source: string;
  isIntercompany: boolean;
  manuallyEdited: boolean;
};

export async function listRecognition(
  entityIds: string[],
  { from, to }: { from: Period; to: Period },
): Promise<RecognitionRow[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recognition_entries")
    .select(
      "id, entity_id, period, category_id, client_id, person_id, contract_id, amount, kind, source, is_intercompany, manually_edited",
    )
    .in("entity_id", entityIds)
    .gte("period", from)
    .lte("period", to)
    .limit(20000);

  if (error) throw new Error(`não foi possível carregar a competência: ${error.message}`);

  return (
    data as {
      id: string;
      entity_id: string;
      period: string;
      category_id: string;
      client_id: string | null;
      person_id: string | null;
      contract_id: string | null;
      amount: string;
      kind: "revenue" | "cost";
      source: string;
      is_intercompany: boolean;
      manually_edited: boolean;
    }[]
  ).map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    period: row.period,
    categoryId: row.category_id,
    clientId: row.client_id,
    personId: row.person_id,
    contractId: row.contract_id,
    amount: fromNumeric(row.amount),
    kind: row.kind,
    source: row.source,
    isIntercompany: row.is_intercompany,
    manuallyEdited: row.manually_edited,
  }));
}

function toPlEntries(rows: readonly RecognitionRow[]): PlEntry[] {
  return rows.map((row) => ({
    period: row.period,
    entityId: row.entityId,
    categoryId: row.categoryId,
    amount: row.amount,
    kind: row.kind,
    isIntercompany: row.isIntercompany,
  }));
}

/**
 * Consolidated scope merges the chart of accounts by code, exactly as the cash flow does:
 * the same line exists once per entity with a different id, and keeping them apart would
 * split "Salários" into two rows that nobody thinks of as different.
 */
function toPlCategories(
  categories: readonly { id: string; code: string; name: string; dreGroup: string | null; sortOrder: number }[],
  consolidated: boolean,
): { categories: PlCategory[]; remap: Map<string, string> } {
  const remap = new Map<string, string>();
  const out: PlCategory[] = [];

  for (const category of categories) {
    const key = consolidated ? category.code : category.id;
    remap.set(category.id, key);
    if (!out.some((candidate) => candidate.id === key)) {
      out.push({
        id: key,
        code: category.code,
        name: category.name,
        dreGroup: category.dreGroup,
        sortOrder: category.sortOrder,
      });
    }
  }

  return { categories: out, remap };
}

export type PlView = {
  report: PlReport;
  rows: RecognitionRow[];
  /** Report column key → the category ids behind it, so a cell can be drilled into. */
  categoryIds: Map<string, string[]>;
};

export async function loadPl({
  entityIds,
  entities,
  from,
  to,
  consolidated,
}: {
  entityIds: string[];
  entities: { id: string; name: string }[];
  from: Period;
  to: Period;
  consolidated: boolean;
}): Promise<PlView> {
  const [rows, rawCategories] = await Promise.all([
    listRecognition(entityIds, { from, to }),
    listCategories(entityIds, { includeInactive: true }),
  ]);

  const { categories, remap } = toPlCategories(rawCategories, consolidated);

  const categoryIds = new Map<string, string[]>();
  for (const category of rawCategories) {
    const key = remap.get(category.id) as string;
    categoryIds.set(key, [...(categoryIds.get(key) ?? []), category.id]);
  }

  const entries = toPlEntries(rows).map((entry) => ({
    ...entry,
    categoryId: remap.get(entry.categoryId) ?? entry.categoryId,
  }));

  const periods: Period[] = [];
  for (let period = from; period <= to; period = nextMonth(period)) periods.push(period);

  const report = consolidated
    ? buildConsolidatedPl({ entities, entries, categories })
    : buildPl({ periods, entries, categories, formatColumn: formatPeriodShort });

  return { report, rows, categoryIds };
}

function nextMonth(period: Period): Period {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// The two ledgers, side by side
// ---------------------------------------------------------------------------

export type LedgerComparisonRow = {
  period: Period;
  cashIn: Cents;
  cashOut: Cents;
  recognizedRevenue: Cents;
  recognizedCost: Cents;
};

/**
 * Cash and competência in the same table.
 *
 * They are **not** supposed to match, and this report exists to make that legible rather
 * than alarming: revenue earned in March may arrive in May, and February's card purchases
 * leave the bank in March. A month where they happen to agree is a coincidence, not a
 * validation — what matters is that each column is internally consistent.
 */
export async function compareLedgers({
  entityIds,
  from,
  to,
}: {
  entityIds: string[];
  from: Period;
  to: Period;
}): Promise<{ rows: LedgerComparisonRow[]; totals: Omit<LedgerComparisonRow, "period"> }> {
  const monthEnd = lastDayOf(to);

  const [recognition, accounts] = await Promise.all([
    listRecognition(entityIds, { from, to }),
    listAccounts(entityIds, { includeInactive: true }),
  ]);

  const cashAccounts = accounts.filter((account) => isCashAccount(account.type));
  const entries = await listCashEntries({
    entityIds,
    from,
    to: monthEnd,
    accountIds: cashAccounts.map((account) => account.id),
    limit: 20000,
  });

  const byPeriod = new Map<Period, LedgerComparisonRow>();
  const touch = (period: Period) => {
    const current = byPeriod.get(period) ?? {
      period,
      cashIn: 0n,
      cashOut: 0n,
      recognizedRevenue: 0n,
      recognizedCost: 0n,
    };
    byPeriod.set(period, current);
    return current;
  };

  for (const row of recognition) {
    const target = touch(row.period);
    if (row.kind === "revenue") target.recognizedRevenue += row.amount;
    else target.recognizedCost += row.amount;
  }

  for (const entry of entries) {
    const target = touch(periodOf(entry.occurredOn));
    if (entry.direction === "in") target.cashIn += entry.amount;
    else target.cashOut += entry.amount;
  }

  const rows = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));

  return {
    rows,
    totals: {
      cashIn: sum(rows.map((row) => row.cashIn)),
      cashOut: sum(rows.map((row) => row.cashOut)),
      recognizedRevenue: sum(rows.map((row) => row.recognizedRevenue)),
      recognizedCost: sum(rows.map((row) => row.recognizedCost)),
    },
  };
}

function lastDayOf(period: Period): IsoDate {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period.slice(0, 8)}${String(day).padStart(2, "0")}`;
}
