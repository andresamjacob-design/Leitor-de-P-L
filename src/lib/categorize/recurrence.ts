/**
 * Finding subscriptions in the ledger.
 *
 * Nobody keeps a list of what the company pays every month — the list is in the card
 * invoice, spread across a year. This reconstructs it: the same supplier, at roughly the
 * same interval, for roughly the same amount, at least three times.
 *
 * Pure, so the thresholds can be argued with in a test instead of in production.
 */

import { abs, mulRatio, sum, type Cents } from "@/lib/money";
import { compareDates, type IsoDate } from "@/lib/dates";
import { normalizeDescription } from "@/lib/dedup";

export type RecurrenceCandidate = {
  id: string;
  description: string;
  amount: Cents;
  occurredOn: IsoDate;
  categoryId: string | null;
  accountId: string;
};

export type Recurrence = {
  /** The normalised supplier the charges share. */
  key: string;
  label: string;
  categoryId: string | null;
  accountId: string;
  occurrences: number;
  firstCharge: IsoDate;
  lastCharge: IsoDate;
  /** The typical charge — the median, so one annual payment does not distort it. */
  typicalAmount: Cents;
  /** Median days between charges. */
  intervalDays: number;
  cadence: "mensal" | "anual" | "irregular";
  /** Normalised to a month, so different cadences can be compared and added up. */
  monthlyCost: Cents;
  annualCost: Cents;
  /**
   * Still being charged, judged against the cadence itself: two intervals of silence
   * means it stopped, or the supplier started writing its name another way. Either way
   * counting it in the monthly total would inflate the number.
   */
  active: boolean;
};

/** At least this many charges before a pattern is a subscription rather than a coincidence. */
const MIN_OCCURRENCES = 3;

/** How far a charge may drift from the expected date and still count as the same cadence. */
const DAY_TOLERANCE = 5;

/** How much the amount may vary — a price rise should not split one subscription in two. */
const AMOUNT_TOLERANCE_PERCENT = 25n;

const MONTHLY = 30;
const ANNUAL = 365;

/**
 * The supplier behind a description.
 *
 * Card statements append references that change every month — `WIX*1217485431`,
 * `EBN*Canva04748 36`. Dropping digits and everything after the first separator is what
 * makes twelve charges look like one subscription.
 */
export function supplierKey(description: string): string {
  const normalized = normalizeDescription(description)
    .replace(/\d+/g, " ")
    .replace(/[*#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Two words are enough to identify a supplier and short enough to survive the noise.
  const words = normalized.split(" ").filter((word) => word.length >= 2);
  return words.slice(0, 2).join(" ") || normalized;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((end - start) / 86400000);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

/**
 * The middle charge — and on an even count, the lower of the two middles rather than
 * their average. "What this normally costs" should be a number that was actually charged,
 * not one halfway between two that never were.
 */
function medianCents(values: readonly Cents[]): Cents {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)] as Cents;
}

function cadenceOf(intervalDays: number): Recurrence["cadence"] {
  if (Math.abs(intervalDays - MONTHLY) <= DAY_TOLERANCE + 3) return "mensal";
  if (Math.abs(intervalDays - ANNUAL) <= 20) return "anual";
  return "irregular";
}

export function detectRecurring(
  candidates: readonly RecurrenceCandidate[],
  { today }: { today?: IsoDate } = {},
): Recurrence[] {
  // Without a reference date, "still active" is measured from the last charge seen
  // anywhere — which is the right anchor when reading a fixed set of files.
  const reference =
    today ??
    candidates.reduce<IsoDate>(
      (latest, candidate) =>
        compareDates(candidate.occurredOn, latest) > 0 ? candidate.occurredOn : latest,
      "0000-01-01",
    );

  const groups = new Map<string, RecurrenceCandidate[]>();

  for (const candidate of candidates) {
    // Only outflows: money coming in on a schedule is a contract, not a subscription,
    // and Fase 5 models that properly.
    const key = supplierKey(candidate.description);
    if (key === "") continue;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const found: Recurrence[] = [];

  for (const [key, all] of groups) {
    const charges = [...all].sort((a, b) => compareDates(a.occurredOn, b.occurredOn));
    if (charges.length < MIN_OCCURRENCES) continue;

    const typicalAmount = medianCents(charges.map((charge) => abs(charge.amount)));
    if (typicalAmount === 0n) continue;

    // A charge far from the typical amount is a different thing that shares a name.
    const tolerance = mulRatio(typicalAmount, AMOUNT_TOLERANCE_PERCENT, 100n);
    const consistent = charges.filter(
      (charge) => abs(abs(charge.amount) - typicalAmount) <= tolerance,
    );
    if (consistent.length < MIN_OCCURRENCES) continue;

    const gaps: number[] = [];
    for (let index = 1; index < consistent.length; index += 1) {
      gaps.push(
        daysBetween(
          (consistent[index - 1] as RecurrenceCandidate).occurredOn,
          (consistent[index] as RecurrenceCandidate).occurredOn,
        ),
      );
    }

    const intervalDays = median(gaps);
    if (intervalDays <= 0) continue;

    const cadence = cadenceOf(intervalDays);
    if (cadence === "irregular") continue;

    const regular = gaps.filter((gap) => Math.abs(gap - intervalDays) <= DAY_TOLERANCE);
    // Most gaps have to fit the cadence, or it is not a cadence.
    if (regular.length * 2 < gaps.length) continue;

    const first = consistent[0] as RecurrenceCandidate;
    const last = consistent[consistent.length - 1] as RecurrenceCandidate;

    const monthlyCost =
      cadence === "mensal" ? typicalAmount : mulRatio(typicalAmount, 1n, 12n);
    const annualCost =
      cadence === "mensal" ? mulRatio(typicalAmount, 12n, 1n) : typicalAmount;

    found.push({
      key,
      label: last.description,
      categoryId: last.categoryId,
      accountId: last.accountId,
      occurrences: consistent.length,
      firstCharge: first.occurredOn,
      lastCharge: last.occurredOn,
      typicalAmount,
      intervalDays,
      cadence,
      monthlyCost,
      annualCost,
      active: daysBetween(last.occurredOn, reference) <= intervalDays * 2 + DAY_TOLERANCE,
    });
  }

  return found.sort((a, b) => (b.monthlyCost > a.monthlyCost ? 1 : b.monthlyCost < a.monthlyCost ? -1 : 0));
}

/** Only what is still being charged: a stopped subscription costs nothing this month. */
export function totalMonthly(recurrences: readonly Recurrence[]): Cents {
  return sum(
    recurrences.filter((recurrence) => recurrence.active).map((recurrence) => recurrence.monthlyCost),
  );
}
