/**
 * Money. Integer cents as `bigint`, never a JavaScript float.
 *
 * `bigint` is deliberate over `number`: it makes `value * 0.17` a TypeError instead of
 * a silent float, which is the whole failure mode SPEC §3 forbids. Every division has
 * to go through `mulRatio` or `allocate`, so the rounding is always written down.
 *
 * Postgres side is `numeric(14,2)`. Conversion happens only at the edges.
 */

export type Cents = bigint;

/** Rounding is half-up away from zero — 0,005 → 0,01 and −0,005 → −0,01. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export const ZERO: Cents = 0n;

export function sum(values: readonly Cents[]): Cents {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function abs(value: Cents): Cents {
  return value < 0n ? -value : value;
}

/**
 * Multiply by a rational. Use this for proration (16/30 days) and POC deltas —
 * never `Number(cents) * pct`.
 */
export function mulRatio(value: Cents, numerator: bigint, denominator: bigint): Cents {
  return divRoundHalfUp(value * numerator, denominator);
}

/**
 * Split a total into parts by weight, losing nothing. The remainder cents go to the
 * largest fractional remainders first (largest-remainder method), so the parts always
 * add back up to exactly `total`.
 *
 * This is what spreads R$ 50.000 over 5 months and what explodes a card invoice across
 * the categories of its purchases.
 */
export function allocate(total: Cents, weights: readonly bigint[]): Cents[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) {
    throw new Error("cannot allocate across zero total weight");
  }

  const parts: Cents[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0n;

  for (const [index, weight] of weights.entries()) {
    const exact = total * weight;
    const part = exact / totalWeight; // truncates toward zero
    parts.push(part);
    distributed += part;
    remainders.push({ index, remainder: exact - part * totalWeight });
  }

  // Hand out the leftover cents, biggest remainder first, tie broken by position so
  // the result is deterministic.
  let leftover = total - distributed;
  const step = leftover < 0n ? -1n : 1n;
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    const bigger = step > 0n ? b.remainder > a.remainder : b.remainder < a.remainder;
    return bigger ? 1 : -1;
  });

  let cursor = 0;
  while (leftover !== 0n) {
    const target = remainders[cursor % remainders.length];
    if (target === undefined) break;
    parts[target.index] = (parts[target.index] ?? 0n) + step;
    leftover -= step;
    cursor += 1;
  }

  return parts;
}

export type ParseOptions = {
  /**
   * Which character separates the decimals. Leave undefined to infer.
   * Set it explicitly once a CSV column mapping is known — inference is a fallback,
   * not a policy.
   */
  decimalSeparator?: "," | ".";
};

/**
 * Parse a money string into cents.
 *
 * Handles `1.234,56`, `1,234.56`, `R$ 1.234,56`, `-50,00`, `(50,00)`, and the
 * `D`/`C` debit/credit suffix Brazilian statements use.
 *
 * When only one separator is present and the format was not declared, the fallback is:
 * a comma is always decimal; a dot followed by exactly three digits is a thousands
 * separator; any other dot is decimal. That is right for Brazilian files and wrong for
 * an en-US file with a `1.234` thousands group — which is why the caller should declare
 * the format when it knows it.
 */
export function parseMoney(input: string, options: ParseOptions = {}): Cents {
  let text = input.trim();
  if (text === "") throw new Error("empty money string");

  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // Trailing D (débito) / C (crédito) used by Brazilian statement exports.
  const suffix = /\s([DC])$/i.exec(text);
  if (suffix) {
    if (suffix[1]?.toUpperCase() === "D") negative = true;
    text = text.slice(0, suffix.index).trim();
  }

  text = text.replace(/R\$/gi, "").replace(/\s| /g, "");

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^[\d.,]+$/.test(text)) {
    throw new Error(`not a money string: ${JSON.stringify(input)}`);
  }

  const separator = options.decimalSeparator ?? inferDecimalSeparator(text);

  let integerPart: string;
  let fractionPart: string;

  // A declared separator that is not in the string means there is no fractional part at
  // all. Without this branch `lastIndexOf` returns −1, `slice(0, -1)` silently drops the
  // last digit, and `"800"` parses as R$ 80,80.
  //
  // That is not hypothetical: PostgREST serialises `numeric` as a JSON **number**, so
  // `800.00` arrives as `800` with no dot. The first real import mangled 327 of 426 rows
  // this way, and no test caught it because postgres.js hands back `"800.00"` as a string.
  const at = separator === null ? -1 : text.lastIndexOf(separator);

  if (at < 0) {
    integerPart = text.replace(/[.,]/g, "");
    fractionPart = "";
  } else {
    integerPart = text.slice(0, at).replace(/[.,]/g, "");
    fractionPart = text.slice(at + 1).replace(/[.,]/g, "");
  }

  if (integerPart === "") integerPart = "0";
  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart)) {
    throw new Error(`not a money string: ${JSON.stringify(input)}`);
  }

  // More than two decimals means the source carried spreadsheet float noise
  // (30714.28571). Round once, here, explicitly.
  const padded = (fractionPart + "00").slice(0, 3);
  const cents = BigInt(integerPart) * 100n + BigInt(padded.slice(0, 2) || "0");
  const roundUp = fractionPart.length > 2 && Number(padded[2]) >= 5;
  const value = roundUp ? cents + 1n : cents;

  return negative ? -value : value;
}

function inferDecimalSeparator(text: string): "," | "." | null {
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma === -1 && lastDot === -1) return null;
  if (lastComma !== -1 && lastDot !== -1) return lastComma > lastDot ? "," : ".";
  if (lastComma !== -1) {
    // A comma is decimal unless it is clearly repeated grouping (1,234,567).
    return text.indexOf(",") === lastComma ? "," : null;
  }
  if (text.indexOf(".") !== lastDot) return null; // 1.234.567
  return text.length - lastDot - 1 === 3 ? null : ".";
}

/** Format as pt-BR digits without the currency symbol: `1.234,56`. */
export function formatMoney(value: Cents): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, "0");
  const reais = digits.slice(0, -2);
  const cents = digits.slice(-2);
  const grouped = reais.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${cents}`;
}

/** Format with the currency symbol: `R$ 1.234,56`. */
export function formatBRL(value: Cents): string {
  return `R$ ${formatMoney(value)}`;
}

/** Serialise for a Postgres `numeric(14,2)` column. */
export function toNumeric(value: Cents): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Read a Postgres `numeric(14,2)` value back into cents. */
export function fromNumeric(value: string | number): Cents {
  return parseMoney(String(value), { decimalSeparator: "." });
}
