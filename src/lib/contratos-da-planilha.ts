/**
 * O bloco de receita da `DRE Geral` lido como contratos — tirado de `propose-contracts` para
 * que a importação e a sincronização (D162) leiam a planilha do mesmo jeito.
 */

import { parseMoney, type Cents } from "@/lib/money";

export const YEAR = 2026;

/**
 * The scope words of the revenue block, and what each one is.
 *
 * `Referral` and `Salesforce` are not client work — they are a commission and a partner
 * share — and it is not a coincidence that the chart of accounts carries `3.03 Receita —
 * Referral` and `3.04 Receita — Parceria`: the chart was derived from these very rows.
 * Leaving them out silently would drop R$ 378.848 of 2026 revenue.
 *
 * An allow-list rather than "any non-empty scope" on purpose: the header row says
 * `Escopo`, the cost block below says nothing, and a new word appearing here should make
 * this script complain instead of guessing which side of the P&L it belongs to.
 */
export const SCOPES: Record<string, { type: "retainer" | "project"; code: string; note: string }> = {
  Ongoing: { type: "retainer", code: "3.01", note: "suporte contínuo" },
  Projeto: { type: "project", code: "3.02", note: "projeto" },
  Referral: { type: "retainer", code: "3.03", note: "comissão de indicação" },
  Salesforce: { type: "retainer", code: "3.04", note: "parceria" },
};

/**
 * The accounts a contract's *type* can reach on its own: `3.01` and `3.02`.
 *
 * Anything else — `3.03` para indicação, `3.04` para parceria — is written onto the
 * contract itself, in `category_id`, which the migration `0005` added for exactly this.
 * Before it existed these two rows had to be parked as `draft`, because a type with two
 * values cannot point at four accounts and landing them in `3.01` would have misstated
 * R$ 378.848 as ongoing support.
 */
export const REACHABLE_BY_TYPE = new Set(["3.01", "3.02"]);

/** Columns 4..15 of the revenue block are January through December of `YEAR`. */
export const FIRST_MONTH_COLUMN = 4;
export const MONTHS = 12;
export const TOTAL_COLUMN = 16;

export const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export type Draft = {
  /** The row as written, qualifier and all — this is the contract's name. */
  label: string;
  /** The part before the qualifier, which is the client. */
  clientLabel: string;
  type: "retainer" | "project";
  status: "active" | "completed";
  /** The revenue account this contract belongs in, whether or not the engine can reach it. */
  code: string;
  billing: string;
  /** Cents per month, index 0 = January. Null where the sheet is blank. */
  months: (Cents | null)[];
  total: Cents;
  firstMonth: number;
  lastMonth: number;
  recognition: "straight_line" | "manual";
  monthlyValue: Cents | null;
};

/** A sheet cell holding money. Numbers arrive as JS floats, so they go through the one
 * parser that produces cents — never `* 100` on a float (D77 is the same lesson). */
export function cents(value: unknown): Cents | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === "-") return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return parseMoney(numeric.toFixed(2), { decimalSeparator: "." });
}

export function baseName(raw: string): string {
  return raw.replace(/\(.*?\)/g, " ").split(/\s+-\s+/)[0]!.replace(/\s+/g, " ").trim();
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function lastDayOf(month: number): number {
  return new Date(Date.UTC(YEAR, month + 1, 0)).getUTCDate();
}

export function lerContratosDaDre(dreRows: readonly (readonly unknown[])[]): {
  drafts: Draft[];
  empty: string[];
  unknown: string[];
  declared: Cents | null;
} {
  const dre = { rows: dreRows };

  const drafts: Draft[] = [];
  const empty: string[] = [];
  const unknown: string[] = [];

  // A planilha inteira, não só as 90 primeiras linhas: desde 01/09 ela tem um segundo bloco
  // de receita, o da GSJACOB, abaixo do da DD (D141, D162). As linhas de custo não têm escopo
  // e caem fora pelo `scope === ""` logo abaixo.
  for (const row of dre.rows) {
    const status = String(row[0] ?? "").trim();
    const scope = String(row[1] ?? "").trim();
    const label = String(row[2] ?? "").trim();
    const billing = String(row[3] ?? "").trim();
    if (label === "" || scope === "" || scope === "Escopo") continue;

    // No bloco de custos a mesma coluna diz como se paga (`cartão`, `boleto`): não é receita.
    if (scope === "cartão" || scope === "boleto") continue;
    const kind = SCOPES[scope];
    if (!kind) {
      // Money under a word this script does not know is money it must not classify.
      if (cents(row[TOTAL_COLUMN]) !== null) unknown.push(`${scope} — ${label}`);
      continue;
    }

    const months: (Cents | null)[] = [];
    for (let index = 0; index < MONTHS; index += 1) {
      months.push(cents(row[FIRST_MONTH_COLUMN + index]));
    }

    const filled = months
      .map((value, index) => ({ value, index }))
      .filter((entry): entry is { value: Cents; index: number } => entry.value !== null);

    if (filled.length === 0) {
      empty.push(label);
      continue;
    }

    const firstMonth = filled[0]!.index;
    const lastMonth = filled[filled.length - 1]!.index;
    const summed = filled.reduce((total, entry) => total + entry.value, 0n);
    // The sheet's own year total wins when it is there: it is what a human looked at.
    const total = cents(row[TOTAL_COLUMN]) ?? summed;

    // Equal months across a contiguous stretch is a straight line and nothing else needs
    // saying. Anything else keeps its months and is recognised by hand.
    const first = filled[0]!.value;
    const even =
      filled.every((entry) => entry.value === first) &&
      filled.length === lastMonth - firstMonth + 1;

    drafts.push({
      label,
      clientLabel: baseName(label),
      type: kind.type,
      status: status.toLowerCase() === "finalizado" ? "completed" : "active",
      code: kind.code,
      // The scope word survives into the contract, so `Referral` and `Salesforce` stay
      // distinguishable from client work once they are rows in a table.
      billing: billing === "" ? kind.note : `${billing} · ${kind.note}`,
      months,
      total,
      firstMonth,
      lastMonth,
      recognition: even ? "straight_line" : "manual",
      monthlyValue: even ? first : null,
    });
  }

  // The sheet prints its own year total on the header row. Checking the contracts against
  // it is the same discipline the importers use: a reading that does not reconcile is a
  // reading that is wrong somewhere, and it is better to say so than to load it.
  const declared = cents(dre.rows[1]?.[TOTAL_COLUMN]);

  return { drafts, empty, unknown, declared };
}

