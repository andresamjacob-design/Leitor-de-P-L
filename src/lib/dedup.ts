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
  /**
   * Who the money went to or came from.
   *
   * Without this, a payroll run is destroyed: the Itaú statement writes `PIX ENVIADO` in
   * the description and puts the person in a separate column, so four payments of
   * R$ 4.000 on the same day to four different people hash identically — and three of
   * them would be marked as duplicates and never reach the ledger. Found on the first
   * real import; 29 groups were affected.
   *
   * Prefer the tax id, which is stable; fall back to the name.
   */
  counterparty?: string | null;
  /**
   * Which occurrence of an otherwise identical movement this is, counting from zero.
   *
   * Two genuinely identical lines can appear in one statement — the same supplier paid
   * twice for the same amount on the same day. They are different movements, and the
   * index is what keeps them apart while still letting a re-import of the same file match
   * them one for one.
   */
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

  const counterparty = subject.counterparty?.trim();
  if (counterparty) parts.push(normalizeDescription(counterparty));

  if (subject.suffix !== undefined && subject.suffix > 0) parts.push(`#${subject.suffix}`);

  return createHash("sha256").update(parts.join("|")).digest("hex");
}
