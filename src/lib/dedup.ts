/**
 * The dedup hash of a cash entry (SPEC §7).
 *
 * `sha256(account | date | amount | direction | normalised description)`. It exists so
 * importing the same statement twice cannot create the same movement twice — the unique
 * index on `(entity_id, dedup_hash)` is what actually enforces it, this only computes it.
 *
 * Manual typing uses the same hash on purpose: if you type a movement the import already
 * brought in, the database refuses it and the form asks whether you really meant it.
 * That is why `suffix` exists — it is how a genuine second identical entry (two R$ 30
 * lunches on the same card, same day) gets through, explicitly.
 */

import { createHash } from "node:crypto";
import type { Cents } from "@/lib/money";
import { toNumeric } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";

/** Upper case, no accents, single spaces. Statement text is noisy; this makes it comparable. */
export function normalizeDescription(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type DedupSubject = {
  accountId: string;
  occurredOn: IsoDate;
  amount: Cents;
  direction: EntryDirection;
  description: string;
  /** Distinguishes a deliberate repeat of an otherwise identical movement. */
  suffix?: number;
};

export function dedupHash(subject: DedupSubject): string {
  const parts = [
    subject.accountId,
    subject.occurredOn,
    toNumeric(subject.amount),
    subject.direction,
    normalizeDescription(subject.description),
  ];
  if (subject.suffix !== undefined && subject.suffix > 0) parts.push(String(subject.suffix));

  return createHash("sha256").update(parts.join("|")).digest("hex");
}
