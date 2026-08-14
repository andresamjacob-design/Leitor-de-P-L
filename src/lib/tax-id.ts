/**
 * CPF/CNPJ. Stored as digits only so a statement's `50.050.390/0001-82` and a hand-typed
 * `50050390000182` are the same value — that equality is what lets the Itaú statement's
 * counterparty column match a client without any guessing (PLAN, Fase 4).
 *
 * Matching never validates: a CNPJ that fails the check digit is still the one the bank
 * sent, and refusing it would lose the movement. `isValidTaxId` exists for the other
 * direction — a number somebody types into a form, where a typo would quietly attach
 * another company's money to this client.
 */

export function normalizeTaxId(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatTaxId(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = normalizeTaxId(value);

  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return value;
}

export function isSameTaxId(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const left = normalizeTaxId(a);
  return left.length > 0 && left === normalizeTaxId(b);
}

/** Mod-11 check digits, the algorithm both CPF and CNPJ use with different weights. */
function checkDigit(digits: readonly number[], weights: readonly number[]): number {
  const total = digits.reduce(
    (accumulated, digit, index) => accumulated + digit * (weights[index] as number),
    0,
  );
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCpf(digits: readonly number[]): boolean {
  const first = checkDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[9] === first && digits[10] === second;
}

function isValidCnpj(digits: readonly number[]): boolean {
  const first = checkDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[12] === first && digits[13] === second;
}

/**
 * Whether a hand-typed CPF or CNPJ checks out.
 *
 * Repeated digits (`111.111.111-11`) pass the arithmetic and are never real, so they are
 * rejected outright — they are also what a keyboard produces when someone gives up on a
 * required field.
 */
export function isValidTaxId(value: string): boolean {
  const text = normalizeTaxId(value);
  if (text.length !== 11 && text.length !== 14) return false;
  if (/^(\d)\1+$/.test(text)) return false;

  const digits = [...text].map(Number);
  return text.length === 11 ? isValidCpf(digits) : isValidCnpj(digits);
}
