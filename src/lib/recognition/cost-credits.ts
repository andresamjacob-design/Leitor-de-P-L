/**
 * When money *arrives* in a cost category.
 *
 * `planCashMirror` turns a cash entry into competência, and it signs the mirror by
 * direction: a payment is a positive cost, money coming back on the same category is a
 * negative one. That is right — a freelancer who returns a payment should reduce the
 * month's freelancer cost, not vanish.
 *
 * It is only right when the payment being returned is *itself* in that category. Two ways
 * the real data broke that assumption:
 *
 *   - **A devolução whose payment is invisible.** R$ 115.000 came back from Ricardo in
 *     January, and the PIX that left is not a line of its own — it sits inside a
 *     `SISPAG FORNECEDORES` batch, uncategorised, because the batch pays many suppliers at
 *     once and the statement never names them. The credit alone put a R$ 115.000 negative
 *     cost in the folha and dragged January's cost below zero.
 *   - **A client who is also a supplier.** Ciclo, Hold Beauty and Conexão pay DD Group.
 *     The identity layer knew the counterparty and filed the receipt under the agency cost
 *     the company pays *them*, so revenue read as negative expense. It is the documented
 *     Salesforce problem (the reason `categorization_rules.direction` exists) arriving
 *     through a different door — identity, not text, so the rule's `direction` never got
 *     a say.
 *
 * The discriminator is the account, and it is structural rather than a guess:
 *
 *   - **On a credit card, a credit can only be a refund of a charge.** Nobody pays you on
 *     your own card bill. Every card credit in a cost category stays, no matter what the
 *     amount is — partial refunds are common and matching them by value would throw away
 *     the honest ones (Adobe's R$ 11,43, Salesforce's R$ 1.394,43).
 *   - **In a bank account, money arriving is usually revenue.** It is a devolução only
 *     when the payment it reverses is visible in the same category: a matching outgoing,
 *     same amount, near the same date. Inaldo's R$ 1.000 out and R$ 1.000 back on 05/05
 *     is the shape of a real one.
 *
 * The function is pure so the rule can be argued with in a test instead of against the
 * production database.
 */

import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { AccountType, CategoryKind, EntryDirection } from "@/lib/ledger-types";

/** How far back the reversed payment may sit. A card bill can take two months to land. */
export const MATCH_WINDOW_BEFORE_DAYS = 120;
/** And how far forward — a devolução occasionally clears before the debit posts. */
export const MATCH_WINDOW_AFTER_DAYS = 30;

const MIRRORED_KINDS: readonly CategoryKind[] = ["cost", "expense", "tax"];

export type CostCredit = {
  accountType: AccountType;
  categoryKind: CategoryKind | null;
  direction: EntryDirection;
  occurredOn: IsoDate;
  /** Magnitude, as stored. */
  amount: Cents;
};

/** A candidate payment this credit might be reversing, already in the same category. */
export type Payment = {
  direction: EntryDirection;
  occurredOn: IsoDate;
  amount: Cents;
};

export type Verdict =
  | { keep: true; reason: "nao-e-credito-em-custo" | "estorno-de-cartao" | "devolucao-casada" }
  | { keep: false; reason: "sem-pagamento-correspondente" };

function daysBetween(a: IsoDate, b: IsoDate): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * True when `payment` is close enough, in value and in time, to be what `credit` reverses.
 * Exported because the script explains its matches and needs the same arithmetic.
 */
export function reverses(credit: CostCredit, payment: Payment): boolean {
  if (payment.direction !== "out") return false;
  if (payment.amount !== credit.amount) return false;

  const delta = daysBetween(credit.occurredOn, payment.occurredOn);
  return delta >= -MATCH_WINDOW_AFTER_DAYS && delta <= MATCH_WINDOW_BEFORE_DAYS;
}

/**
 * Whether this credit belongs in the cost category it currently carries.
 *
 * `keep: false` means the category is wrong, not that the entry is wrong: the money did
 * arrive and the bank statement says so. The fix is to clear the category — which deletes
 * the mirror through `planCashMirror` returning null — and leave the line for a human to
 * file. It never suggests deleting the cash entry: the line reconciles the account, and a
 * ledger that no longer matches the bank is a worse defect than an unfiled receipt.
 */
export function judgeCostCredit(
  credit: CostCredit,
  candidates: readonly Payment[],
): Verdict {
  if (credit.direction !== "in") return { keep: true, reason: "nao-e-credito-em-custo" };
  if (credit.categoryKind === null || !MIRRORED_KINDS.includes(credit.categoryKind)) {
    return { keep: true, reason: "nao-e-credito-em-custo" };
  }

  if (credit.accountType === "credit_card") return { keep: true, reason: "estorno-de-cartao" };

  const matched = candidates.some((payment) => reverses(credit, payment));
  return matched
    ? { keep: true, reason: "devolucao-casada" }
    : { keep: false, reason: "sem-pagamento-correspondente" };
}

export const VERDICT_LABEL: Record<Verdict["reason"], string> = {
  "nao-e-credito-em-custo": "não é crédito em conta de custo",
  "estorno-de-cartao": "estorno de cartão — só pode ser devolução de compra",
  "devolucao-casada": "devolução com pagamento correspondente na mesma categoria",
  "sem-pagamento-correspondente": "sem pagamento correspondente — a categoria está errada",
};
