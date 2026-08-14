/**
 * The management P&L (DRE gerencial), and the consolidation of both entities.
 *
 * Pure: recognition rows in, matrix out. It reads `recognition_entries` and **only**
 * `recognition_entries` — never a cash entry, never a bank balance (SPEC §5). The cash
 * flow answers "when did the money move"; this answers "when was it earned or owed", and
 * the two are not supposed to agree month to month.
 *
 * The line order is the one the company already works from in the `DRE Geral` sheet:
 *
 *     Receita bruta
 *   − Deduções
 *   = Receita líquida
 *   − Custos diretos
 *   = Margem bruta
 *   − Despesas operacionais
 *   = EBITDA
 *   − Sócios
 *   = Resultado do período
 *
 * Transfers never appear. Moving money between your own accounts is not a result, and a
 * DRE that showed it would be adding the same money to itself.
 */

import { sum, type Cents } from "@/lib/money";
import type { Period } from "@/lib/dates";
import { DRE_GROUP_LABEL } from "@/lib/ledger-types";

export type PlCategory = {
  id: string;
  code: string;
  name: string;
  dreGroup: string | null;
  sortOrder: number;
};

export type PlEntry = {
  period: Period;
  entityId: string;
  categoryId: string;
  amount: Cents;
  kind: "revenue" | "cost";
  isIntercompany: boolean;
};

export type PlLineKind = "group" | "category" | "subtotal";

export type PlLine = {
  key: string;
  label: string;
  kind: PlLineKind;
  /** One value per column, in the same order as `columns`. */
  values: Cents[];
  total: Cents;
  /** Set on category lines, so a cell can be opened as the rows behind it. */
  categoryId: string | null;
  /** A subtotal that closes a block — drawn heavier. */
  emphasis: boolean;
};

export type PlColumn = {
  key: string;
  label: string;
};

export type PlReport = {
  columns: PlColumn[];
  lines: PlLine[];
  warnings: string[];
};

/**
 * The blocks, in order. `transferencias` is deliberately absent — see the header.
 *
 * `socios` sits below EBITDA because a profit distribution is not an operating expense;
 * pró-labore is payroll and lives in `pessoal` (D24).
 */
const REVENUE_GROUP = "receita_bruta";
const DEDUCTION_GROUP = "deducoes";
const DIRECT_COST_GROUP = "custos_diretos";
const OPERATING_GROUPS = [
  "pessoal",
  "ferramentas",
  "servicos",
  "viagem",
  "outras",
  "financeiras",
] as const;
const OWNER_GROUP = "socios";

const IGNORED_GROUPS = new Set(["transferencias"]);

function zeros(length: number): Cents[] {
  return Array.from({ length }, () => 0n);
}

function subtract(left: readonly Cents[], right: readonly Cents[]): Cents[] {
  return left.map((value, index) => value - ((right[index] as Cents | undefined) ?? 0n));
}

function add(left: readonly Cents[], right: readonly Cents[]): Cents[] {
  return left.map((value, index) => value + ((right[index] as Cents | undefined) ?? 0n));
}

type Bucket = Map<string, Cents[]>;

/**
 * Sums the entries into `[dreGroup][categoryId] -> values per column`.
 *
 * `columnOf` is what makes one builder serve both views: by month for a single entity, by
 * entity for the consolidated one. An entry whose column is not in the report is dropped,
 * which is how the period filter works.
 */
function bucketize(
  entries: readonly PlEntry[],
  categories: readonly PlCategory[],
  columns: readonly PlColumn[],
  columnOf: (entry: PlEntry) => string | null,
): { byGroup: Map<string, Bucket>; uncategorized: Cents[]; warnings: string[] } {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const indexOf = new Map(columns.map((column, index) => [column.key, index]));
  const byGroup = new Map<string, Bucket>();
  const uncategorized = zeros(columns.length);
  const warnings: string[] = [];
  let missingGroup = 0;

  for (const entry of entries) {
    const key = columnOf(entry);
    if (key === null) continue;
    const index = indexOf.get(key);
    if (index === undefined) continue;

    const category = categoryById.get(entry.categoryId);
    if (!category) {
      uncategorized[index] = (uncategorized[index] as Cents) + entry.amount;
      continue;
    }

    const group = category.dreGroup;
    if (group === null) {
      missingGroup += 1;
      uncategorized[index] = (uncategorized[index] as Cents) + entry.amount;
      continue;
    }
    if (IGNORED_GROUPS.has(group)) continue;

    const bucket = byGroup.get(group) ?? new Map<string, Cents[]>();
    const values = bucket.get(category.id) ?? zeros(columns.length);
    values[index] = (values[index] as Cents) + entry.amount;
    bucket.set(category.id, values);
    byGroup.set(group, bucket);
  }

  if (missingGroup > 0) {
    warnings.push(
      `${missingGroup} linha${missingGroup === 1 ? "" : "s"} de competência ` +
        `est${missingGroup === 1 ? "á" : "ão"} numa categoria sem grupo de DRE — ` +
        "aparece(m) em “Sem grupo” e não entra(m) em nenhum subtotal.",
    );
  }

  return { byGroup, uncategorized, warnings };
}

/** Emits the lines of one block: a heading, its categories, and its total. */
function blockLines(
  group: string,
  byGroup: Map<string, Bucket>,
  categories: readonly PlCategory[],
  columnCount: number,
): { lines: PlLine[]; totals: Cents[] } {
  const bucket = byGroup.get(group);
  if (!bucket || bucket.size === 0) {
    return { lines: [], totals: zeros(columnCount) };
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const rows = [...bucket]
    .map(([categoryId, values]) => {
      const category = categoryById.get(categoryId);
      return {
        categoryId,
        code: category?.code ?? "",
        label: category ? `${category.code} · ${category.name}` : "Categoria removida",
        sortOrder: category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        values,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  const totals = rows.reduce<Cents[]>((accumulated, row) => add(accumulated, row.values), zeros(columnCount));

  const lines: PlLine[] = [
    {
      key: `group-${group}`,
      label: DRE_GROUP_LABEL[group] ?? group,
      kind: "group",
      values: totals,
      total: sum(totals),
      categoryId: null,
      emphasis: false,
    },
    ...rows.map((row) => ({
      key: `cat-${row.categoryId}`,
      label: row.label,
      kind: "category" as const,
      values: row.values,
      total: sum(row.values),
      categoryId: row.categoryId,
      emphasis: false,
    })),
  ];

  return { lines, totals };
}

function subtotal(key: string, label: string, values: Cents[]): PlLine {
  return {
    key,
    label,
    kind: "subtotal",
    values,
    total: sum(values),
    categoryId: null,
    emphasis: true,
  };
}

function assemble(
  entries: readonly PlEntry[],
  categories: readonly PlCategory[],
  columns: readonly PlColumn[],
  columnOf: (entry: PlEntry) => string | null,
): PlReport {
  const count = columns.length;
  const { byGroup, uncategorized, warnings } = bucketize(entries, categories, columns, columnOf);

  const revenue = blockLines(REVENUE_GROUP, byGroup, categories, count);
  const deductions = blockLines(DEDUCTION_GROUP, byGroup, categories, count);
  const directCosts = blockLines(DIRECT_COST_GROUP, byGroup, categories, count);

  const netRevenue = subtract(revenue.totals, deductions.totals);
  const grossMargin = subtract(netRevenue, directCosts.totals);

  const operating = OPERATING_GROUPS.map((group) => blockLines(group, byGroup, categories, count));
  const operatingTotals = operating.reduce<Cents[]>(
    (accumulated, block) => add(accumulated, block.totals),
    zeros(count),
  );

  const ebitda = subtract(grossMargin, operatingTotals);
  const owners = blockLines(OWNER_GROUP, byGroup, categories, count);
  const result = subtract(ebitda, owners.totals);

  const lines: PlLine[] = [
    ...revenue.lines,
    ...deductions.lines,
    subtotal("net-revenue", "Receita líquida", netRevenue),
    ...directCosts.lines,
    subtotal("gross-margin", "Margem bruta", grossMargin),
    ...operating.flatMap((block) => block.lines),
    subtotal("operating", "Total de despesas operacionais", operatingTotals),
    subtotal("ebitda", "EBITDA", ebitda),
    ...owners.lines,
    subtotal("result", "Resultado do período", result),
  ];

  if (uncategorized.some((value) => value !== 0n)) {
    lines.splice(lines.length - 1, 0, {
      key: "no-group",
      label: "Sem grupo de DRE",
      kind: "category",
      values: uncategorized,
      total: sum(uncategorized),
      categoryId: null,
      emphasis: false,
    });
  }

  return { columns: [...columns], lines, warnings };
}

// ---------------------------------------------------------------------------
// Per entity: months as columns
// ---------------------------------------------------------------------------

export function buildPl({
  periods,
  entries,
  categories,
  formatColumn,
}: {
  periods: readonly Period[];
  entries: readonly PlEntry[];
  categories: readonly PlCategory[];
  formatColumn: (period: Period) => string;
}): PlReport {
  const columns = periods.map((period) => ({ key: period, label: formatColumn(period) }));
  const report = assemble(entries, categories, columns, (entry) => entry.period);

  if (periods.length === 0) {
    return { ...report, warnings: [...report.warnings, "Nenhum mês selecionado."] };
  }
  return report;
}

// ---------------------------------------------------------------------------
// Consolidated: one column per entity, plus eliminations and a total
// ---------------------------------------------------------------------------

export const ELIMINATION_KEY = "__eliminacoes__";
export const TOTAL_KEY = "__total__";

/**
 * Consolidation across entities (SPEC §11.7).
 *
 * Each entity keeps its own column with its own numbers — including the intercompany ones,
 * because from that entity's point of view they are real revenue and real cost. The
 * consolidated total removes them: money the group charged itself is not group revenue,
 * and leaving it in would inflate both sides at once (D14e).
 *
 * The elimination column exists so the reader can see what was removed rather than
 * discovering that the columns do not add up.
 */
export function buildConsolidatedPl({
  entities,
  entries,
  categories,
}: {
  entities: readonly { id: string; name: string }[];
  entries: readonly PlEntry[];
  categories: readonly PlCategory[];
}): PlReport {
  const columns: PlColumn[] = [
    ...entities.map((entity) => ({ key: entity.id, label: entity.name })),
    { key: ELIMINATION_KEY, label: "Eliminações" },
    { key: TOTAL_KEY, label: "Consolidado" },
  ];

  // Every entry lands in its entity's column; an intercompany entry also lands in the
  // elimination column with the opposite sign, so the total nets it out.
  const expanded: PlEntry[] = [];
  for (const entry of entries) {
    expanded.push(entry);
    expanded.push({ ...entry, entityId: TOTAL_KEY });
    if (entry.isIntercompany) {
      expanded.push({ ...entry, entityId: ELIMINATION_KEY, amount: -entry.amount });
      expanded.push({ ...entry, entityId: TOTAL_KEY, amount: -entry.amount });
    }
  }

  const report = assemble(expanded, categories, columns, (entry) => entry.entityId);

  const hasIntercompany = entries.some((entry) => entry.isIntercompany);
  return {
    ...report,
    warnings: hasIntercompany
      ? report.warnings
      : [...report.warnings, "Nenhum lançamento intercompany no período — nada foi eliminado."],
  };
}

/** The line a screen wants to headline. */
export function findLine(report: PlReport, key: string): PlLine | undefined {
  return report.lines.find((line) => line.key === key);
}
