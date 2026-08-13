/**
 * CPF/CNPJ. Stored as digits only so a statement's `50.050.390/0001-82` and a hand-typed
 * `50050390000182` are the same value — that equality is what lets the Itaú statement's
 * counterparty column match a client without any guessing (PLAN, Fase 4).
 *
 * No check-digit validation here: the point is matching what the bank sent, not policing
 * it. A CNPJ that fails validation is still the one on the statement.
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
