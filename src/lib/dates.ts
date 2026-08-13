/**
 * Dates. A movement date is a calendar day, not an instant — so the domain uses plain
 * `YYYY-MM-DD` strings and never a `Date` object. That is what keeps a 01/03 entry from
 * becoming 28/02 when someone's runtime decides to interpret it in UTC.
 *
 * `Date` appears in exactly one place: reading today's date in São Paulo.
 */

export const TIME_ZONE = "America/Sao_Paulo";

/** A calendar day, `YYYY-MM-DD`. */
export type IsoDate = string;

/** The first day of a month, `YYYY-MM-01`. This is what `recognition_entries.period` holds. */
export type Period = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PT_BR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parts(date: IsoDate): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`not an ISO date: ${JSON.stringify(date)}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) throw new Error(`month out of range: ${date}`);
  if (day < 1 || day > daysInMonthOf(year, month)) {
    throw new Error(`day out of range: ${date}`);
  }
  return { year, month, day };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function daysInMonthOf(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one. UTC keeps it timezone-free.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(value: string): boolean {
  try {
    parts(value);
    return true;
  } catch {
    return false;
  }
}

/** `15/04/2026` → `2026-04-15`. Throws on anything else. */
export function parsePtBRDate(value: string): IsoDate {
  const match = PT_BR_DATE.exec(value.trim());
  if (!match) throw new Error(`not a dd/mm/aaaa date: ${JSON.stringify(value)}`);
  const date = `${match[3]}-${pad(Number(match[2]), 2)}-${pad(Number(match[1]), 2)}`;
  parts(date);
  return date;
}

/** `2026-04-15` → `15/04/2026`. */
export function formatPtBRDate(date: IsoDate): string {
  const { year, month, day } = parts(date);
  return `${pad(day, 2)}/${pad(month, 2)}/${year}`;
}

/** The month a date belongs to, as its first day. */
export function periodOf(date: IsoDate): Period {
  const { year, month } = parts(date);
  return `${year}-${pad(month, 2)}-01`;
}

/** `2026-04-01` → `abril de 2026`. */
const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

export function formatPeriod(period: Period): string {
  const { year, month } = parts(period);
  return `${MONTH_NAMES[month - 1]} de ${year}`;
}

/** `2026-04-01` → `abr/26`, for column headers. */
export function formatPeriodShort(period: Period): string {
  const { year, month } = parts(period);
  const name = MONTH_NAMES[month - 1] ?? "";
  return `${name.slice(0, 3)}/${pad(year % 100, 2)}`;
}

export function daysInMonth(date: IsoDate): number {
  const { year, month } = parts(date);
  return daysInMonthOf(year, month);
}

export function addMonths(date: IsoDate, count: number): IsoDate {
  const { year, month, day } = parts(date);
  const total = year * 12 + (month - 1) + count;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  // Clamp so 31/01 + 1 month lands on 28/02 instead of overflowing into March.
  const clamped = Math.min(day, daysInMonthOf(nextYear, nextMonth));
  return `${pad(nextYear, 4)}-${pad(nextMonth, 2)}-${pad(clamped, 2)}`;
}

/** Whole months from one period to another. Same month → 0. */
export function monthsBetween(from: Period, to: Period): number {
  const a = parts(from);
  const b = parts(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Every month from `start` to `end`, inclusive, as first-of-month periods. */
export function eachPeriod(start: IsoDate, end: IsoDate): Period[] {
  const first = periodOf(start);
  const last = periodOf(end);
  const count = monthsBetween(first, last);
  if (count < 0) return [];
  return Array.from({ length: count + 1 }, (_, index) => addMonths(first, index));
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  parts(a);
  parts(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * How many days of a month a contract actually covers, and how many the month has.
 *
 * The convention (DECISIONS D14f): real calendar days, counting the start day itself.
 * A retainer starting 15/04 covers 16 of April's 30 days. One ending 10/06 covers 10 of
 * June's 30. A month fully inside the term covers all of it.
 */
export function coveredDays(
  period: Period,
  termStart: IsoDate,
  termEnd: IsoDate | null,
): { covered: number; total: number } {
  const total = daysInMonth(period);
  const monthStart = periodOf(period);
  const monthEnd = `${monthStart.slice(0, 8)}${pad(total, 2)}`;

  if (compareDates(termStart, monthEnd) > 0) return { covered: 0, total };
  if (termEnd !== null && compareDates(termEnd, monthStart) < 0) {
    return { covered: 0, total };
  }

  const from = compareDates(termStart, monthStart) > 0 ? termStart : monthStart;
  const to =
    termEnd !== null && compareDates(termEnd, monthEnd) < 0 ? termEnd : monthEnd;

  const covered = parts(to).day - parts(from).day + 1;
  return { covered, total };
}

/** Today, as seen from São Paulo. The one place a real clock is read. */
export function todayInSaoPaulo(now: Date = new Date()): IsoDate {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}
