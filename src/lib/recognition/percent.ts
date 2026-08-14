/**
 * Percentages, as integers.
 *
 * Same reasoning as money: `0.1 + 0.2` is not `0.3`, and a POC delta multiplied by a
 * contract value is exactly where that would surface as a missing cent. A percent is
 * stored as **millipercent** — hundredths of a percent times ten — so `100%` is
 * `100_000n` and the three decimals `numeric(6,3)` allows survive the round trip.
 */

export type Percent = bigint;

export const ZERO_PERCENT: Percent = 0n;
export const FULL: Percent = 100_000n;

/** `"30"` → 30%, `"30,5"` → 30,5%, `"0,001"` → the smallest step the column holds. */
export function parsePercent(input: string): Percent {
  const text = input.trim().replace(/%/g, "").replace(/\s/g, "");
  if (text === "") throw new Error("percentual vazio");

  const match = /^(-?)(\d*)(?:[.,](\d*))?$/.exec(text);
  if (!match) throw new Error(`não é um percentual: ${JSON.stringify(input)}`);

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] === "" ? "0" : (match[2] as string);
  const fraction = ((match[3] ?? "") + "000").slice(0, 3);

  return sign * (BigInt(whole) * 1000n + BigInt(fraction));
}

/** `30_000n` → `"30"`, `30_500n` → `"30,5"`. Trailing zeros are dropped. */
export function formatPercent(value: Percent): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(4, "0");
  const whole = digits.slice(0, -3);
  const fraction = digits.slice(-3).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `,${fraction}` : ""}`;
}

/** For the `numeric(6,3)` column. */
export function toNumericPercent(value: Percent): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -3)}.${digits.slice(-3)}`;
}

export function fromNumericPercent(value: string | number): Percent {
  return parsePercent(String(value).replace(".", ","));
}

export function isWithinRange(value: Percent): boolean {
  return value >= 0n && value <= FULL;
}
