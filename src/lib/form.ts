/**
 * Reading a form. The browser gives us strings; the domain wants `bigint` cents,
 * `YYYY-MM-DD` days and first-of-month periods. This is the only place that conversion
 * happens on the way in.
 *
 * Every failure is a message in Portuguese aimed at the person filling the form, because
 * that is who reads it (SPEC §14).
 */

import { parseMoney, type Cents } from "@/lib/money";
import { isIsoDate, type IsoDate, type Period } from "@/lib/dates";

export class FormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormError";
  }
}

export function readText(data: FormData, name: string, label: string): string {
  const value = String(data.get(name) ?? "").trim();
  if (value === "") throw new FormError(`${label} é obrigatório.`);
  return value;
}

export function readOptionalText(data: FormData, name: string): string | null {
  const value = String(data.get(name) ?? "").trim();
  return value === "" ? null : value;
}

/** An `<input type="date">` already speaks ISO; the check is for hand-crafted requests. */
export function readDate(data: FormData, name: string, label: string): IsoDate {
  const value = readText(data, name, label);
  if (!isIsoDate(value)) throw new FormError(`${label} não é uma data válida.`);
  return value;
}

/** An `<input type="month">` gives `YYYY-MM`; the ledger stores the first day. */
export function readOptionalPeriod(data: FormData, name: string, label: string): Period | null {
  const value = String(data.get(name) ?? "").trim();
  if (value === "") return null;

  const period = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  if (!isIsoDate(period) || !period.endsWith("-01")) {
    throw new FormError(`${label} não é um mês válido.`);
  }
  return period;
}

export function readMoney(data: FormData, name: string, label: string): Cents {
  const value = readText(data, name, label);
  try {
    return parseMoney(value);
  } catch {
    throw new FormError(`${label} não é um valor válido. Use o formato 1.234,56.`);
  }
}

/** Money that may be left blank, meaning zero. */
export function readOptionalMoney(data: FormData, name: string, label: string): Cents {
  const value = String(data.get(name) ?? "").trim();
  if (value === "") return 0n;
  try {
    return parseMoney(value);
  } catch {
    throw new FormError(`${label} não é um valor válido. Use o formato 1.234,56.`);
  }
}

export function readBoolean(data: FormData, name: string): boolean {
  const value = data.get(name);
  return value === "on" || value === "true" || value === "1";
}

/** A `<select>` whose empty option means "none". */
export function readOptionalId(data: FormData, name: string): string | null {
  const value = String(data.get(name) ?? "").trim();
  return value === "" ? null : value;
}

export function readChoice<T extends string>(
  data: FormData,
  name: string,
  allowed: readonly T[],
  label: string,
): T {
  const value = String(data.get(name) ?? "").trim();
  if (!(allowed as readonly string[]).includes(value)) {
    throw new FormError(`${label} não é uma opção válida.`);
  }
  return value as T;
}

export function readInteger(data: FormData, name: string, fallback: number): number {
  const value = String(data.get(name) ?? "").trim();
  if (value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type FormState = {
  error?: string;
  notices?: string[];
  /**
   * What was submitted, echoed back. React resets an uncontrolled form once its action
   * finishes, so without this a rejected save would wipe everything the user typed —
   * which matters most in the one flow that always rejects first: "gravar mesmo assim"
   * after a duplicate.
   */
  values?: Record<string, string>;
};

export const EMPTY_FORM_STATE: FormState = {};

export function echo(data: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/** Turns any thrown value into something a form can render, without leaking a stack. */
export function toFormState(cause: unknown, data?: FormData): FormState {
  const values = data ? echo(data) : undefined;
  if (cause instanceof FormError) return { error: cause.message, values };
  if (cause instanceof Error) return { error: cause.message, values };
  return { error: "não foi possível salvar. Tente de novo.", values };
}
