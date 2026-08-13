/**
 * The Itaú Empresas credit card invoice.
 *
 * Pure: positioned lines in, transactions out. The coordinates come from `pdf.ts`, the
 * reading order from `layout.ts`, and none of it touches a database.
 *
 * What makes this parser worth trusting is not the parsing — it is that the invoice
 * states its own total, and the caller refuses the import unless the extracted purchases
 * add up to it exactly (SPEC §7, DECISIONS D-B). A two-column layout read wrong will
 * miss or duplicate lines, and the total is what catches it.
 *
 * Three traps in the real documents:
 *
 *   1. The file name lies. `Itaucard_4460_fatura_062026.pdf` is the invoice due
 *      05/01/2026, and files named for different cards are the same PDF (A3). Account,
 *      card and period all come from inside.
 *   2. "Compras parceladas — próximas faturas" lists instalments of *future* invoices.
 *      Booking them would charge the company twice for the same purchase.
 *   3. `Repasse de IOF` is a charge with no purchase behind it. Skipping it makes the
 *      invoice fail to reconcile by exactly the IOF.
 */

import { parseMoney, sum, type Cents } from "@/lib/money";
import { parsePtBRDate, type IsoDate } from "@/lib/dates";
import type { LayoutLine, PdfPage } from "@/lib/import/layout";
import { toDocumentLines } from "@/lib/import/layout";
import type {
  CardInvoiceParse,
  DiscardedRow,
  ParsedTransaction,
  ParseWarning,
  Reconciliation,
} from "@/lib/import/types";

const DATE_TOKEN = /^\d{2}\/\d{2}$/;
const MONEY = /^-?\s?[\d.]+,\d{2}$/;

type Section = "none" | "charges" | "international" | "products" | "future" | "closed";

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function money(text: string): Cents | null {
  const cleaned = text.replace(/\s/g, "");
  if (!MONEY.test(text.trim()) && !MONEY.test(cleaned)) return null;
  try {
    return parseMoney(cleaned, { decimalSeparator: "," });
  } catch {
    return null;
  }
}

/** The last money-looking item on a line. */
function trailingAmount(line: LayoutLine): { amount: Cents; index: number } | null {
  for (let index = line.items.length - 1; index >= 0; index -= 1) {
    const value = money(line.items[index]?.text ?? "");
    if (value !== null) return { amount: value, index };
  }
  return null;
}

/** How far from the `VALOR EM R$` heading an amount may sit and still be that column's. */
const AMOUNT_COLUMN_TOLERANCE = 80;

/**
 * The amount of a transaction line.
 *
 * Taking the last number on the line is wrong whenever a neighbouring column bleeds into
 * it — `02/02 ADOBE 139,01 … Limite máximo para saque no exterior 7.220,00` would book
 * the credit limit as the purchase. The invoice prints a `VALOR EM R$` heading above the
 * column, so when we know where that heading sits, the amount is the number nearest to
 * it; otherwise the trailing number is the best guess available.
 */
function pickAmount(
  line: LayoutLine,
  amountX: number | undefined,
): { amount: Cents; index: number } | null {
  if (amountX === undefined) return trailingAmount(line);

  let best: { amount: Cents; index: number; distance: number } | null = null;
  for (const [index, item] of line.items.entries()) {
    const value = money(item.text);
    if (value === null) continue;
    const distance = Math.abs(item.x - amountX);
    if (distance > AMOUNT_COLUMN_TOLERANCE) continue;
    if (!best || distance < best.distance) best = { amount: value, index, distance };
  }

  return best ? { amount: best.amount, index: best.index } : null;
}

/**
 * The x of the amount column, read from a table heading:
 * `DATA  ESTABELECIMENTO  VALOR EM R$`, or `DATA  ESTABELECIMENTO  US$  R$` for the
 * international block, where the last `R$` is the column that actually gets billed.
 */
function amountColumnFromHeading(line: LayoutLine): number | null {
  const hasData = line.items.some((item) => /^DATA$/i.test(item.text));
  if (!hasData) return null;

  const valorEm = line.items.find((item) => /^valor\s+em\s+r\$$/i.test(item.text));
  if (valorEm) return valorEm.x;

  const brl = [...line.items].reverse().find((item) => /^R\$$/i.test(item.text));
  return brl ? brl.x : null;
}

/**
 * An invoice prints `23/12` with no year. The purchase sits in the weeks before the
 * invoice closed, so the closing year is right unless that would place it in the future —
 * which is exactly the December-purchase-on-a-January-invoice case.
 */
function resolveYear(ddmm: string, reference: IsoDate | null): IsoDate | null {
  const match = /^(\d{2})\/(\d{2})$/.exec(ddmm);
  if (!match) return null;
  const day = match[1] as string;
  const month = match[2] as string;

  const year = reference ? Number(reference.slice(0, 4)) : new Date().getUTCFullYear();
  const candidate = `${year}-${month}-${day}`;

  try {
    parsePtBRDate(`${day}/${month}/${year}`);
  } catch {
    return null;
  }

  if (reference && candidate > reference) {
    const earlier = `${year - 1}-${month}-${day}`;
    try {
      parsePtBRDate(`${day}/${month}/${year - 1}`);
      return earlier;
    } catch {
      return null;
    }
  }
  return candidate;
}

/** A continuation line sits one row below its transaction, never further. */
const CONTINUATION_GAP = 24;

const INSTALLMENT = /(\d{2})\/(\d{2})\s*$/;

function readInstallment(description: string): { current: number; total: number } | null {
  const match = INSTALLMENT.exec(description.trim());
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (total < 2 || total > 36 || current < 1 || current > total) return null;
  return { current, total };
}

export function parseItauCardInvoice(pages: readonly PdfPage[]): CardInvoiceParse {
  const lines = toDocumentLines(pages);
  const warnings: ParseWarning[] = [];
  const discarded: DiscardedRow[] = [];
  const transactions: ParsedTransaction[] = [];

  const source: CardInvoiceParse["source"] = {
    institution: "Itaú Unibanco",
    account: null,
    accountLastDigits: null,
    holder: null,
    cards: [],
  };

  let issueDate: IsoDate | null = null;
  let dueDate: IsoDate | null = null;
  let statedChargesTotal: Cents | null = null;
  let statedInvoiceTotal: Cents | null = null;

  // ---- Header ---------------------------------------------------------------
  for (const line of lines) {
    const { text } = line;

    const account = /(\d{4}\.[X\d]{4}\.[X\d]{4}\.(\d{4}))/.exec(text);
    if (account && !source.account) {
      source.account = account[1] as string;
      source.accountLastDigits = account[2] as string;
    }

    const holder = /Empresa\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 .,&'-]{4,})/.exec(text);
    if (holder && !source.holder) source.holder = (holder[1] as string).trim();

    const issue = /Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text);
    if (issue && !issueDate) issueDate = safeDate(issue[1] as string);

    const due = /Vencimento:\s*(\d{2}\/\d{2}\/\d{4})/.exec(text);
    if (due && !dueDate) dueDate = safeDate(due[1] as string);
  }

  if (!source.account) {
    warnings.push({
      severity: "warning",
      message: "não encontrei o número da conta do cartão dentro do PDF.",
    });
  }
  if (!dueDate) {
    warnings.push({
      severity: "error",
      message:
        "não encontrei a data de vencimento dentro do PDF. Sem ela não dá para " +
        "saber a que fatura o arquivo pertence — e o nome do arquivo não serve.",
    });
  }

  // Purchases close on the issue date; when it is missing, the due date is close enough
  // to place a December purchase in the right year.
  const reference = issueDate ?? dueDate;

  // ---- Sections and transactions --------------------------------------------
  let section: Section = "none";
  let currentCard: string | null = null;
  let lastTransaction: ParsedTransaction | null = null;
  // A continuation belongs to the transaction directly above it. Tracking where that was
  // stops a transaction from swallowing everything printed later in the column.
  let lastLine: { column: number; y: number } | null = null;
  const amountXByColumn = new Map<number, number>();

  for (const line of lines) {
    const flat = normalize(line.text);

    // A table heading tells us where this column's amounts live, until the next heading.
    const headingX = amountColumnFromHeading(line);
    if (headingX !== null) {
      amountXByColumn.set(line.column, headingX);
      lastTransaction = null;
      continue;
    }
    const amountX = amountXByColumn.get(line.column);

    // Section markers, checked before the line is considered for a transaction.
    if (flat.startsWith("lancamentos: compras e saques")) {
      section = "charges";
      lastTransaction = null;
      continue;
    }
    if (flat.startsWith("lancamentos internacionais")) {
      section = "international";
      lastTransaction = null;
      continue;
    }
    if (flat.startsWith("lancamentos: produtos e servicos")) {
      section = "products";
      lastTransaction = null;
      continue;
    }
    if (flat.startsWith("compras parceladas")) {
      section = "future";
      lastTransaction = null;
      continue;
    }
    if (flat.startsWith("limites de credito") || flat.startsWith("encargos cobrados")) {
      section = "closed";
      lastTransaction = null;
      continue;
    }

    // `Total dos lançamentos atuais` is the figure the whole import is checked against.
    // Matched with `includes` because the invoice prints a stray `L` marker before it.
    if (flat.includes("total dos lancamentos atuais")) {
      statedChargesTotal = pickAmount(line, amountX)?.amount ?? statedChargesTotal;
      section = "closed";
      continue;
    }
    if (flat.startsWith("total desta fatura") || flat.includes("= total desta fatura")) {
      statedInvoiceTotal = trailingAmount(line)?.amount ?? statedInvoiceTotal;
      continue;
    }

    // `Repasse de IOF` is a real charge with no purchase behind it.
    if (flat.startsWith("repasse de iof")) {
      const value = pickAmount(line, amountX)?.amount;
      if (value !== undefined && value !== 0n && reference) {
        transactions.push({
          occurredOn: reference,
          description: "Repasse de IOF",
          amount: value < 0n ? -value : value,
          direction: value < 0n ? "in" : "out",
          counterpartyName: null,
          counterpartyTaxId: null,
          installmentCurrent: null,
          installmentTotal: null,
          externalId: null,
          raw: { secao: "internacional", linha: line.text },
        });
      }
      continue;
    }

    // Per-card subtotals close the card's block without being transactions.
    if (flat.startsWith("lancamentos no cartao") || flat.startsWith("total transacoes inter")) {
      lastTransaction = null;
      continue;
    }
    if (flat.startsWith("total lancamentos inter") || flat.startsWith("lancamentos produtos")) {
      lastTransaction = null;
      continue;
    }

    // `R C CUSTODIO JR (final 2227)` names the card the next block belongs to.
    const cardHeader = /^(.*?)\s*\(final (\d{4})\)$/.exec(line.text.trim());
    if (cardHeader && !flat.startsWith("lancamentos")) {
      const label = (cardHeader[1] as string).trim() || null;
      const lastDigits = cardHeader[2] as string;
      currentCard = lastDigits;
      if (!source.cards.some((card) => card.lastDigits === lastDigits)) {
        source.cards.push({ label, lastDigits });
      }
      lastTransaction = null;
      continue;
    }

    const first = line.items[0];
    const isTransactionLine = first !== undefined && DATE_TOKEN.test(first.text);

    if (!isTransactionLine) {
      // A line with no date, straight after a transaction, is its category and city —
      // `DIVERSOS .SAO PAULO`, or the conversion rate on an international purchase.
      const adjacent =
        lastLine !== null &&
        lastLine.column === line.column &&
        lastLine.y - line.y <= CONTINUATION_GAP;

      if (lastTransaction && adjacent && line.text.trim() !== "") {
        lastTransaction.raw.detalhe = [lastTransaction.raw.detalhe, line.text]
          .filter(Boolean)
          .join(" · ");
        lastLine = { column: line.column, y: line.y };
      } else {
        lastTransaction = null;
        lastLine = null;
      }
      continue;
    }

    if (section === "future") {
      discarded.push({
        line: Math.round(line.y),
        description: line.text,
        reason: "parcela de fatura futura, não é lançamento deste período",
      });
      lastTransaction = null;
      continue;
    }

    if (section === "none" || section === "closed") {
      lastTransaction = null;
      continue;
    }

    const trailing = pickAmount(line, amountX);
    if (!trailing) {
      discarded.push({
        line: Math.round(line.y),
        description: line.text,
        reason: "linha com data mas sem valor",
      });
      lastTransaction = null;
      continue;
    }

    const occurredOn = resolveYear(first.text, reference);
    if (!occurredOn) {
      discarded.push({
        line: Math.round(line.y),
        description: line.text,
        reason: `não consegui datar “${first.text}”`,
      });
      lastTransaction = null;
      continue;
    }

    const description = line.items
      .slice(1, trailing.index)
      .map((item) => item.text)
      .join(" ")
      .trim();

    if (description === "") {
      discarded.push({
        line: Math.round(line.y),
        description: line.text,
        reason: "linha sem descrição",
      });
      lastTransaction = null;
      continue;
    }

    const installment = readInstallment(description);
    const transaction: ParsedTransaction = {
      occurredOn,
      description,
      amount: trailing.amount < 0n ? -trailing.amount : trailing.amount,
      // A purchase is money out; a refund on the invoice is money back in.
      direction: trailing.amount < 0n ? "in" : "out",
      counterpartyName: null,
      counterpartyTaxId: null,
      installmentCurrent: installment?.current ?? null,
      installmentTotal: installment?.total ?? null,
      externalId: null,
      raw: {
        secao: section,
        cartao: currentCard,
        linha: line.text,
        detalhe: null,
      },
    };

    transactions.push(transaction);
    lastTransaction = transaction;
    lastLine = { column: line.column, y: line.y };
  }

  if (transactions.length === 0) {
    warnings.push({
      severity: "error",
      message: "nenhum lançamento foi encontrado no PDF.",
    });
  }

  return {
    kind: "card_invoice",
    source,
    issueDate,
    dueDate,
    transactions,
    statedChargesTotal,
    statedInvoiceTotal,
    discarded,
    warnings,
  };
}

function safeDate(value: string): IsoDate | null {
  try {
    return parsePtBRDate(value);
  } catch {
    return null;
  }
}

/**
 * The safety catch (DECISIONS D-B). The invoice prints what its charges add up to; if our
 * reading disagrees by a single cent, the reading is wrong and the import is refused.
 * There is no "close enough" here — a two-column parse that drops one line is exactly the
 * failure this catches.
 */
export function reconcileCardInvoice(parse: CardInvoiceParse): Reconciliation {
  const actual = sum(
    parse.transactions.map((transaction) =>
      transaction.direction === "out" ? transaction.amount : -transaction.amount,
    ),
  );

  if (parse.statedChargesTotal === null) {
    return {
      ok: false,
      expected: null,
      actual,
      difference: 0n,
      message:
        "a fatura não declara “Total dos lançamentos atuais”, então não há como conferir " +
        "a leitura. A importação é recusada.",
    };
  }

  const difference = actual - parse.statedChargesTotal;
  return {
    ok: difference === 0n,
    expected: parse.statedChargesTotal,
    actual,
    difference,
    message:
      difference === 0n
        ? `a soma dos ${parse.transactions.length} lançamentos bate com o total impresso.`
        : "a soma dos lançamentos extraídos não bate com o total impresso na fatura. " +
          "A leitura está errada e a importação foi recusada.",
  };
}
