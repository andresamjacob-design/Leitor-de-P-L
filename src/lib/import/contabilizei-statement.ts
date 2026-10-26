/**
 * The Contabilizei (Banco 301) current-account statement, as a PDF.
 *
 * A third account nobody had mentioned: same CNPJ as DD Group, and it carries the same
 * freelancers the Itaú does. Its export is a PDF with no text layer worth the name — the
 * columns exist only as x positions — so this reads coordinates, exactly as the Itaú card
 * parser does (D34, A6).
 *
 * The format is kinder than the Itaú's in one decisive way: it prints the **running
 * balance on every row**, not just at the end of the day. So every movement is checkable
 * against the one before it, and `reconcileContabilizei` does exactly that. A statement
 * whose arithmetic does not close is refused rather than imported "as best we could"
 * (SPEC §7, D-B).
 *
 * It is harsher in another: **the amount carries no sign**. `Pix enviado` and
 * `Pix recebido` are both printed as `3.000,00`, and which way the money went is only
 * visible in the balance moving. That is what decides direction here — the words are used
 * to cross-check it, never to set it, because a verb is a label and a balance is arithmetic.
 *
 * And a warning about identity: **CPFs come masked** (`709.***.***-26`), CNPJs do not.
 * A masked document is not an identifier and must never reach `counterparty_tax_id`, or
 * `normalizeTaxId` would turn it into the five digits that survive and match the wrong
 * person. Masked documents are dropped; the name is kept.
 */

import type { Cents } from "@/lib/money";
import { parseMoney, formatMoney } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { PdfPage, PositionedItem } from "@/lib/import/layout";
import type {
  DiscardedRow,
  ParsedTransaction,
  ParseWarning,
  Reconciliation,
  StatementParse,
} from "@/lib/import/types";

/** Where each column sits, and how far a glyph may drift and still belong to it. */
const COLUMN = { date: 78, category: 129, detail: 166, id: 342, amount: 437, balance: 496 };
const COLUMN_TOLERANCE = 14;

/** Items whose baselines differ by less than this are the same visual row. */
const LINE_TOLERANCE = 2;

const MONTHS: Record<string, string> = {
  JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06",
  JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12",
};

const DATE = /^(\d{2})\s+([A-ZÇ]{3})\.?\s+(\d{4})$/i;
const MONEY = /^-?\s?[\d.]*\d,\d{2}$/;
/** A document the statement blanked out. Five digits survive, and they identify nobody. */
const MASKED = /\*/;
const CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const CPF = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;

type Row = { y: number; cells: Map<keyof typeof COLUMN, string>; loose: string[] };

function columnOf(x: number): keyof typeof COLUMN | null {
  for (const [name, position] of Object.entries(COLUMN)) {
    if (Math.abs(x - position) <= COLUMN_TOLERANCE) return name as keyof typeof COLUMN;
  }
  return null;
}

/** Groups a page's glyphs into visual rows, each glyph filed under the column it sits in. */
function toRows(pages: readonly PdfPage[]): Row[] {
  const items: PositionedItem[] = [];
  for (const page of pages) {
    // Pages stack: a later page's y restarts high, so it is pushed below everything before.
    const offset = page.number * 100_000;
    for (const item of page.items) items.push({ ...item, y: item.y - offset });
  }

  const rows: Row[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const text = item.text.trim();
    if (text === "" || text === "•") continue;

    let row = rows[rows.length - 1];
    if (!row || Math.abs(row.y - item.y) > LINE_TOLERANCE) {
      row = { y: item.y, cells: new Map(), loose: [] };
      rows.push(row);
    }

    const column = columnOf(item.x);
    if (column === null) {
      row.loose.push(text);
      continue;
    }
    const previous = row.cells.get(column);
    row.cells.set(column, previous === undefined ? text : `${previous} ${text}`);
  }

  return rows;
}

function money(text: string): Cents | null {
  const trimmed = text.replace(/R\$\s*/i, "").trim();
  if (!MONEY.test(trimmed)) return null;
  try {
    return parseMoney(trimmed, { decimalSeparator: "," });
  } catch {
    return null;
  }
}

function isoDate(text: string): IsoDate | null {
  const match = DATE.exec(text.trim());
  if (!match) return null;
  const month = MONTHS[match[2]!.toUpperCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1]}`;
}

/** `Pix enviado - LAURA SANTANA` → the name after the dash, which is the counterparty. */
function counterpartyOf(description: string): string | null {
  const at = description.indexOf(" - ");
  if (at < 0) return null;
  const name = description.slice(at + 3).trim();
  return name === "" ? null : name;
}

/**
 * The page furniture, repeated on every page.
 *
 * Tested only against rows that are *not* movements, and that ordering is the whole point:
 * the bank is also a counterparty, so `Pix recebido - CONTABILIZEI TECNOLOGIA LTDA` is a
 * real R$ 1,65 that a name-based filter swallowed until the reconciliation refused to
 * close over it.
 */
const NOISE = /SAC|WhatsApp|atendimento\.bank|P.gina \d+ de|Extrato solicitado/i;

/**
 * Is this PDF a Contabilizei statement rather than an Itaú card invoice?
 *
 * Both arrive as `.pdf` through the same field, and the two parsers read entirely
 * different shapes. Decided on the words the statement prints about itself, never on the
 * filename — the same lesson the card invoices taught, where the name meant nothing.
 */
export function looksLikeContabilizei(pages: readonly PdfPage[]): boolean {
  const text = pages
    .flatMap((page) => page.items.map((item) => item.text))
    .join(" ");
  return /Banco 301/i.test(text) && /Saldo inicial do per[íi]odo/i.test(text);
}

export function parseContabilizeiStatement(pages: readonly PdfPage[]): StatementParse {
  const rows = toRows(pages);
  const transactions: ParsedTransaction[] = [];
  const discarded: DiscardedRow[] = [];
  const warnings: ParseWarning[] = [];
  const declaredBalances: { date: IsoDate; balance: Cents; label: string }[] = [];

  const source = {
    institution: "Contabilizei",
    branch: null as string | null,
    account: null as string | null,
    holder: null as string | null,
  };
  let openingBalance: Cents | null = null;
  let declaredIn: Cents | null = null;
  let declaredOut: Cents | null = null;
  let periodStart: IsoDate | null = null;
  let periodEnd: IsoDate | null = null;

  let day: IsoDate | null = null;
  /** The transaction the following detail lines belong to. */
  let open: ParsedTransaction | null = null;
  /**
   * The balance after the last movement read, which is what gives the next one its sign.
   *
   * It has to survive the end of a day: `Saldo final do dia` closes the block but the
   * arithmetic runs straight through it, and resetting here made every first movement of
   * a day subtract from the opening balance of the whole period.
   */
  let running: Cents | null = null;

  for (const [index, row] of rows.entries()) {
    const whole = [...row.cells.values(), ...row.loose].join(" ").trim();
    if (whole === "") continue;

    const amount = money(row.cells.get("amount") ?? "");
    const balance = money(row.cells.get("balance") ?? "");
    const category = row.cells.get("category");
    const isMovement = amount !== null && balance !== null && category !== undefined;

    // A row that carries an amount and a balance is a movement whatever words are in it.
    if (!isMovement && NOISE.test(whole)) continue;

    // --- header -------------------------------------------------------------
    const branch = /Ag[êe]ncia\s+(\d{3,4})\b/.exec(whole);
    const account = /Conta\s+([\d-]{5,})/.exec(whole);
    if (branch && account && source.branch === null) {
      source.branch = branch[1]!;
      source.account = account[1]!;
    }
    if (/Saldo inicial do per[íi]odo/i.test(whole)) {
      openingBalance = money(whole.split(/R\$/).pop() ?? "") ?? openingBalance;
      continue;
    }
    // Both totals share one visual row, so they are read positionally rather than by
    // splitting on `R$` — taking the last match gave the outflow to both sides, and the
    // period check below is what noticed.
    if (/Total de (entradas|sa[íi]das)/i.test(whole)) {
      const labels = [...whole.matchAll(/Total de (entradas|sa[íi]das)/gi)];
      const values = [...whole.matchAll(/R\$\s*([\d.]+,\d{2})/g)];
      for (const [at, label] of labels.entries()) {
        const value = money(values[at]?.[1] ?? "");
        if (value === null) continue;
        if (/entradas/i.test(label[1] ?? "")) declaredIn = value;
        else declaredOut = value;
      }
      continue;
    }
    const period = whole.match(/(\d{2}) de ([A-ZÇ]+) de (\d{4})/gi);
    if (period && period.length === 2 && periodStart === null) {
      const asIso = (value: string): IsoDate | null => {
        const parts = /(\d{2}) de ([A-ZÇ]+) de (\d{4})/i.exec(value);
        if (!parts) return null;
        const month = MONTHS[parts[2]!.slice(0, 3).toUpperCase()];
        return month ? `${parts[3]}-${month}-${parts[1]}` : null;
      };
      periodStart = asIso(period[0]!);
      periodEnd = asIso(period[1]!);
      continue;
    }

    // --- end of day ---------------------------------------------------------
    if (/Saldo final do dia/i.test(whole)) {
      const balance = money(row.cells.get("balance") ?? "");
      if (balance !== null && day !== null) {
        declaredBalances.push({ date: day, balance, label: "saldo final do dia" });
      }
      open = null;
      continue;
    }

    const onDate = row.cells.get("date");
    if (onDate) {
      const parsed = isoDate(onDate);
      if (parsed) day = parsed;
    }

    // --- a movement ---------------------------------------------------------
    if (isMovement && amount !== null && balance !== null && category) {
      if (day === null) {
        discarded.push({ line: index, description: whole, reason: "movimento antes de qualquer data" });
        continue;
      }

      // The sign lives in the balance, never in the printed amount.
      const previous = running ?? openingBalance;
      const delta = previous === null ? null : balance - previous;

      // A row whose balance does not move moved no money, whatever it prints. The one in
      // this statement is `Boleto estornado`: a boleto issued and cancelled before anyone
      // paid it. Counting its 166,98 was the last thing keeping the period from closing.
      if (delta === 0n) {
        discarded.push({
          line: index,
          description: row.cells.get("detail") ?? category,
          reason: "o saldo não se move — nada foi pago nem recebido",
        });
        continue;
      }

      const direction: "in" | "out" = delta === null ? "in" : delta > 0n ? "in" : "out";

      if (delta !== null && (delta < 0n ? -delta : delta) !== amount) {
        warnings.push({
          severity: "warning",
          message:
            `${day}: o saldo anda ${formatMoney(delta < 0n ? -delta : delta)} ` +
            `e o lançamento diz ${formatMoney(amount)}.`,
        });
      }

      // The description sits on the same visual row as the amount, a hair above the
      // baseline; the document and the branch/account come on the rows below.
      const written = row.cells.get("detail") ?? null;

      const transaction: ParsedTransaction = {
        occurredOn: day,
        description: written ?? category,
        amount,
        direction,
        counterpartyName: written === null ? null : counterpartyOf(written),
        counterpartyTaxId: null,
        installmentCurrent: null,
        installmentTotal: null,
        externalId: row.cells.get("id") ?? null,
        raw: {
          data: day,
          categoria: category,
          lancamento: written,
          valor: row.cells.get("amount") ?? null,
          saldo: row.cells.get("balance") ?? null,
        },
      };
      transactions.push(transaction);
      open = transaction;
      running = balance;
      continue;
    }

    // --- detail lines that belong to the movement above ---------------------
    const detail = row.cells.get("detail");
    if (detail && open) {
      const transaction = open;
      if (CNPJ.test(detail)) {
        transaction.counterpartyTaxId = detail;
      } else if (CPF.test(detail) || MASKED.test(detail)) {
        // Masked: kept in `raw` for a human, never as identity.
        transaction.raw["documento"] = detail;
      } else if (/^Ag[êe]ncia:/i.test(detail)) {
        transaction.raw["origem"] = detail;
      } else {
        // A name that wrapped onto a second line.
        transaction.description = `${transaction.description} ${detail}`.trim();
        transaction.counterpartyName = counterpartyOf(transaction.description);
      }
    }
  }

  // The statement prints its own period totals, and they are an independent check: the
  // running balance would still close if two equal movements had their signs swapped, and
  // this would not.
  if (declaredIn !== null || declaredOut !== null) {
    const read = { in: 0n as Cents, out: 0n as Cents };
    for (const transaction of transactions) {
      if (transaction.direction === "in") read.in += transaction.amount;
      else read.out += transaction.amount;
    }
    for (const [side, declared, actual] of [
      ["entradas", declaredIn, read.in],
      ["saídas", declaredOut, read.out],
    ] as const) {
      if (declared === null) continue;
      warnings.push(
        declared === actual
          ? { severity: "info", message: `${side}: ${formatMoney(actual)}, como o extrato declara.` }
          : {
              severity: "warning",
              message:
                `${side}: li ${formatMoney(actual)} e o extrato declara ${formatMoney(declared)}.`,
            },
      );
    }
  }

  return {
    kind: "statement",
    source,
    periodStart,
    periodEnd,
    transactions,
    declaredBalances,
    openingBalance,
    discarded,
    warnings,
  };
}

/**
 * Checks the reading against the statement's own arithmetic.
 *
 * Every row carries the balance after it, so this walks them in order: opening balance,
 * then each movement, and the running total must land on the printed one every single
 * time. A statement that does not close is a statement read wrong.
 */
export function reconcileContabilizei(parse: StatementParse): Reconciliation {
  const total = parse.transactions.reduce(
    (sum, transaction) =>
      sum + (transaction.direction === "in" ? transaction.amount : -transaction.amount),
    0n,
  );

  const last = parse.declaredBalances[parse.declaredBalances.length - 1];
  if (parse.openingBalance === null || !last) {
    return {
      ok: false,
      expected: null,
      actual: total,
      difference: 0n,
      message: "o extrato não traz saldo inicial ou final para conferir.",
    };
  }

  const expected = last.balance - parse.openingBalance;
  const difference = total - expected;
  return {
    ok: difference === 0n,
    expected,
    actual: total,
    difference,
    message:
      difference === 0n
        ? `${parse.transactions.length} movimentos fecham com o saldo declarado.`
        : `a soma dos movimentos difere do saldo em ${difference / 100n}.`,
  };
}
