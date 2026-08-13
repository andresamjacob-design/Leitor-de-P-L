/**
 * What a parser hands back. Deliberately dumb: a parser reads a file and reports what it
 * found, including what it refused to read. It never touches the database, never decides
 * a category, and never rounds a number a second time.
 *
 * Nothing here reaches `cash_entries` directly — everything lands in
 * `staged_transactions` and waits for a human (SPEC §7).
 */

import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";

export type ParsedTransaction = {
  occurredOn: IsoDate;
  description: string;
  /** Magnitude; the sign lives in `direction`. */
  amount: Cents;
  direction: EntryDirection;
  counterpartyName: string | null;
  /** Digits only, ready to match `clients.tax_id`. */
  counterpartyTaxId: string | null;
  /** `2` and `3` for a "02/03" instalment. */
  installmentCurrent: number | null;
  installmentTotal: number | null;
  /** Set when the file carries a stable identifier of its own. */
  externalId: string | null;
  /** The source row, kept verbatim so a wrong reading can be diagnosed later. */
  raw: Record<string, string | null>;
};

/** A line the parser deliberately did not turn into a transaction, and why. */
export type DiscardedRow = {
  line: number;
  description: string;
  reason: string;
};

export type ParseWarning = {
  severity: "info" | "warning" | "error";
  message: string;
};

export type StatementParse = {
  kind: "statement";
  source: {
    institution: string;
    branch: string | null;
    account: string | null;
    holder: string | null;
  };
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  transactions: ParsedTransaction[];
  /** End-of-day balances the file declares, used to check the reading against itself. */
  declaredBalances: { date: IsoDate; balance: Cents; label: string }[];
  openingBalance: Cents | null;
  discarded: DiscardedRow[];
  warnings: ParseWarning[];
};

export type CardInvoiceParse = {
  kind: "card_invoice";
  source: {
    institution: string;
    /** The billing account, e.g. `5336.XXXX.XXXX.5780`. */
    account: string | null;
    accountLastDigits: string | null;
    holder: string | null;
    /** Every card that billed on this invoice. */
    cards: { label: string | null; lastDigits: string }[];
  };
  issueDate: IsoDate | null;
  dueDate: IsoDate | null;
  transactions: ParsedTransaction[];
  /** `Total dos lançamentos atuais` — what the extracted purchases must add up to. */
  statedChargesTotal: Cents | null;
  /** `= Total desta fatura` — what the bank will debit from the current account. */
  statedInvoiceTotal: Cents | null;
  discarded: DiscardedRow[];
  warnings: ParseWarning[];
};

export type AnyParse = StatementParse | CardInvoiceParse;

/**
 * The result of checking a parse against the totals the document prints on itself.
 * SPEC §7 and DECISIONS D-B: a card invoice that does not reconcile is refused, never
 * imported "as best we could".
 */
export type Reconciliation = {
  ok: boolean;
  expected: Cents | null;
  actual: Cents;
  difference: Cents;
  message: string;
};
