/**
 * Deterministic categorisation.
 *
 * Everything here is a pure function over data the system already has. No LLM is involved
 * — that is Fase 7, it writes only to `suggested_*`, and it never reaches a ledger table
 * (SPEC §9). If this layer cannot decide, the honest answer is "no suggestion", not a
 * guess dressed up as one.
 */

import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";

export type MatchType = "contains" | "regex" | "exact" | "amount_range";

export type Rule = {
  id: string;
  priority: number;
  matchType: MatchType;
  pattern: string;
  /** Digits only. When set, the rule only applies to that counterparty. */
  counterpartyTaxId: string | null;
  /**
   * When set, the rule only applies to movements in that direction.
   *
   * An expense rule that fires on money coming in is not a small annoyance: `CICLO`
   * matched five receipts from a client whose name matches an agency the company pays,
   * turning revenue into cost. Found on the first real statement.
   */
  direction: EntryDirection | null;
  amountMin: Cents | null;
  amountMax: Cents | null;
  /** When set, the rule only applies to movements of that account. */
  accountId: string | null;
  categoryId: string;
  clientId: string | null;
  personId: string | null;
  active: boolean;
  hitCount: number;
};

/** What we know about a movement that still needs a category. */
export type Subject = {
  description: string;
  amount: Cents;
  direction: EntryDirection;
  accountId: string;
  counterpartyTaxId: string | null;
  counterpartyName: string | null;
};

/** A movement that was already categorised — the material the engine learns from. */
export type HistoryEntry = {
  description: string;
  counterpartyTaxId: string | null;
  categoryId: string;
  clientId: string | null;
  personId: string | null;
  occurredOn: IsoDate;
};

export type Person = {
  id: string;
  name: string;
};

/**
 * Where a suggestion came from. Ordered from most to least authoritative, and shown to
 * the user as-is — a suggestion nobody can explain is a suggestion nobody should accept.
 */
export type SuggestionSource =
  | "rule_tax_id"
  | "rule_text"
  | "history_tax_id"
  | "history_description"
  | "person";

export type Suggestion = {
  categoryId: string;
  clientId: string | null;
  personId: string | null;
  source: SuggestionSource;
  /** 0 to 1. Below 0,8 the review screen shows it without pre-selecting it (SPEC §9). */
  confidence: number;
  /** Why, in Portuguese, for the person deciding. */
  reason: string;
  ruleId: string | null;
};
