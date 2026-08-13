/**
 * The cash mirror (DECISIONS D2a).
 *
 * A cost only shows up in the P&L if it exists in `recognition_entries`, and typing every
 * expense twice would be absurd. So saving a cash cost writes its competência row too,
 * automatically, in the month of `occurred_on` — unless the user overrode the competência
 * (D2b), which is the salary-paid-in-February-for-January case.
 *
 * What this file deliberately does NOT mirror:
 *
 *   - **Revenue.** Revenue is recognised from contracts and NFs, never from the day the
 *     money landed (SPEC §5). Mirroring it would make the two ledgers agree by
 *     construction and destroy the whole point of having two.
 *   - **Transfers.** Moving money between your own accounts is not a result.
 *   - **Owner draws.** A profit distribution is below the line, not an expense.
 *
 * The function is pure so the rule can be tested without a database.
 */

import type { Cents } from "@/lib/money";
import { periodOf, type IsoDate, type Period } from "@/lib/dates";
import type { CategoryKind, EntryDirection } from "@/lib/ledger-types";

export type MirrorSubject = {
  categoryId: string | null;
  categoryKind: CategoryKind | null;
  direction: EntryDirection;
  occurredOn: IsoDate;
  /** The competência override, or null for "the month it happened". */
  competencePeriod: Period | null;
  /** Magnitude, as stored. */
  amount: Cents;
};

export type MirrorPlan = {
  categoryId: string;
  period: Period;
  kind: "cost";
  /**
   * Signed. A payment is a positive cost; a refund on the same category is a negative
   * one, so money coming back reduces the month's result instead of vanishing.
   */
  amount: Cents;
};

const MIRRORED_KINDS: readonly CategoryKind[] = ["cost", "expense", "tax"];

/**
 * What the recognition ledger should hold for this cash entry, or `null` when it should
 * hold nothing. `null` also means "delete any mirror that exists" — that is how an entry
 * recategorised from expense to transfer cleans up after itself.
 */
export function planCashMirror(entry: MirrorSubject): MirrorPlan | null {
  if (entry.categoryId === null || entry.categoryKind === null) return null;
  if (!MIRRORED_KINDS.includes(entry.categoryKind)) return null;
  if (entry.amount === 0n) return null;

  return {
    categoryId: entry.categoryId,
    period: entry.competencePeriod ?? periodOf(entry.occurredOn),
    kind: "cost",
    amount: entry.direction === "out" ? entry.amount : -entry.amount,
  };
}

/** The competência a screen should show for an entry, override or not. */
export function competenceOf(entry: {
  occurredOn: IsoDate;
  competencePeriod: Period | null;
}): Period {
  return entry.competencePeriod ?? periodOf(entry.occurredOn);
}

/** True when the two regimes disagree — worth flagging in a list. */
export function hasCompetenceOverride(entry: {
  occurredOn: IsoDate;
  competencePeriod: Period | null;
}): boolean {
  return (
    entry.competencePeriod !== null && entry.competencePeriod !== periodOf(entry.occurredOn)
  );
}
