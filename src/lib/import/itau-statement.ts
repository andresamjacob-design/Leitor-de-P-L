/**
 * The Itaú current-account statement (XLSX or CSV export).
 *
 * Pure: rows in, transactions out. No file reading, no database, so the whole thing is
 * testable without either.
 *
 * Two rules learned from the real exports (DECISIONS A7, and the Fase 1 reading of the
 * files):
 *
 *   1. **Columns are matched by header text, never by position.** One export carries an
 *      extra `Ag/origem` column, which shifts everything after it. Reading column E
 *      because it was E last time is how an import silently books the CNPJ as the amount.
 *   2. **A row with no value in `Valor` is not a transaction.** That is what removes
 *      `SALDO ANTERIOR`, `SALDO TOTAL DISPONÍVEL DIA`, `SDO APLIC AUT MAIS AP` and the
 *      rest — a description blacklist would need updating every time the bank invents a
 *      new label, and would double the cash flow the day it missed one.
 */

import { parseMoney, type Cents } from "@/lib/money";
import { isIsoDate, parsePtBRDate, type IsoDate } from "@/lib/dates";
import { normalizeTaxId } from "@/lib/tax-id";
import type { Cell } from "@/lib/import/xlsx";
import type {
  DiscardedRow,
  ParsedTransaction,
  ParseWarning,
  StatementParse,
} from "@/lib/import/types";

/** Accent- and case-insensitive, so `Razão Social` and `RAZAO SOCIAL` are one thing. */
function normalizeHeader(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ColumnRole =
  | "date"
  | "description"
  | "counterparty"
  | "taxId"
  | "amount"
  | "balance"
  | "debit"
  | "credit"
  | "originBranch";

/**
 * Header spellings seen in the real exports, plus the separate debit/credit columns some
 * banks use instead of one signed amount (SPEC §7).
 */
const HEADER_ROLES: { match: string[]; role: ColumnRole }[] = [
  { match: ["data", "data lancamento", "data do lancamento"], role: "date" },
  { match: ["lancamento", "historico", "descricao"], role: "description" },
  { match: ["razao social", "nome", "beneficiario", "favorecido"], role: "counterparty" },
  { match: ["cpf cnpj", "cnpj cpf", "documento"], role: "taxId" },
  { match: ["valor r", "valor", "valor da transacao"], role: "amount" },
  { match: ["saldo r", "saldo"], role: "balance" },
  { match: ["debito", "saida"], role: "debit" },
  { match: ["credito", "entrada"], role: "credit" },
  { match: ["ag origem", "agencia origem"], role: "originBranch" },
];

function roleOf(header: string): ColumnRole | null {
  const normalized = normalizeHeader(header);
  if (normalized === "") return null;
  for (const { match, role } of HEADER_ROLES) {
    if (match.includes(normalized)) return role;
  }
  // `Valor (R$)` normalises to `valor r`; anything else starting with the word is a
  // reasonable fallback, but only after the exact matches above have had their turn.
  for (const { match, role } of HEADER_ROLES) {
    if (match.some((candidate) => normalized.startsWith(candidate))) return role;
  }
  return null;
}

/**
 * The account is swept into an automatic investment every day, so it holds R$ 1,00 at
 * close and the money sits in `SALDO APLIC. AUT.`. Three balances therefore exist:
 *
 *   SALDO TOTAL DISPONÍVEL DIA  = SALDO MOVIMENTAÇÃO CONTA + SALDO APLIC. AUT.
 *
 * The one that means "how much money does the company have" is the **total**, and that is
 * what this file reconciles against (DECISIONS D35). `SALDO EM CONTA CORRENTE` is a
 * snapshot taken when the file was exported, not an end-of-day close, so it is recorded
 * but never used as a checkpoint — it disagrees by the yield accrued since.
 */
function isOpeningBalance(description: string): boolean {
  return normalizeHeader(description) === "saldo anterior";
}

function isDailyTotalBalance(description: string): boolean {
  return normalizeHeader(description) === "saldo total disponivel dia";
}

function isSnapshotBalance(description: string): boolean {
  return normalizeHeader(description) === "saldo em conta corrente";
}

/**
 * A sweep in or out of the automatic investment. It is not a movement of money — it is
 * the same money changing shelf inside the same balance — so booking it would double the
 * cash flow. `RENDIMENTO ... REND PAGO APLIC AUT MAIS` is the yield and *is* real income,
 * which is why "REND" excludes a line from being a sweep.
 */
export function isAutomaticSweep(description: string): boolean {
  const normalized = normalizeHeader(description);
  if (normalized.includes("rend")) return false;
  return /\b(apl|res)\b.*\baplic\b.*\baut\b/.test(normalized);
}

function text(cell: Cell | undefined): string {
  return (cell ?? "").toString().trim();
}

/**
 * A cell that came from a numeric XLSX cell is always dot-decimal; one that came from a
 * CSV is whatever the locale wrote. Deciding per cell keeps both readable without asking
 * the user which is which.
 */
function readAmount(raw: string): Cents {
  const machineNumber = /^[-+]?\d+(\.\d+)?$/.test(raw);
  return parseMoney(raw, machineNumber ? { decimalSeparator: "." } : {});
}

function readDate(raw: string): IsoDate | null {
  if (isIsoDate(raw)) return raw;
  try {
    return parsePtBRDate(raw);
  } catch {
    return null;
  }
}

const INSTALLMENT = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/;

function readInstallment(description: string): { current: number; total: number } | null {
  const match = INSTALLMENT.exec(description);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  // `01/03` is an instalment; `16/07` is a date. Only a total above the current, and a
  // plausible number of instalments, is worth believing.
  if (total < 2 || total > 36 || current < 1 || current > total) return null;
  return { current, total };
}

export function parseItauStatement(rows: readonly Cell[][]): StatementParse {
  const warnings: ParseWarning[] = [];
  const discarded: DiscardedRow[] = [];
  const transactions: ParsedTransaction[] = [];
  const declaredBalances: StatementParse["declaredBalances"] = [];

  const source = {
    institution: "Itaú Unibanco",
    branch: null as string | null,
    account: null as string | null,
    holder: null as string | null,
  };
  let periodStart: IsoDate | null = null;
  let periodEnd: IsoDate | null = null;
  let openingBalance: Cents | null = null;

  // ---- Metadata and header -------------------------------------------------
  let headerIndex = -1;
  const columns = new Map<ColumnRole, number>();

  for (const [index, row] of rows.entries()) {
    const label = normalizeHeader(text(row[0]));
    const value = text(row[1]);

    if (label === "nome") source.holder = value || null;
    if (label === "agencia") source.branch = value || null;
    if (label === "conta") source.account = value || null;
    if (label === "periodo") {
      const match = /(\d{2}\/\d{2}\/\d{4}).*?(\d{2}\/\d{2}\/\d{4})/.exec(value);
      if (match) {
        periodStart = readDate(match[1] as string);
        periodEnd = readDate(match[2] as string);
      }
    }

    // The header is the first row that names both a date and an amount column.
    const roles = row.map((cell) => roleOf(text(cell)));
    if (roles.includes("date") && (roles.includes("amount") || roles.includes("debit"))) {
      headerIndex = index;
      for (const [column, role] of roles.entries()) {
        if (role && !columns.has(role)) columns.set(role, column);
      }
      break;
    }
  }

  if (headerIndex < 0) {
    return {
      kind: "statement",
      source,
      periodStart,
      periodEnd,
      transactions: [],
      declaredBalances: [],
      openingBalance: null,
      discarded: [],
      warnings: [
        {
          severity: "error",
          message:
            "não encontrei o cabeçalho do extrato — esperava uma linha com “Data” e " +
            "“Valor”. O arquivo é mesmo um extrato do Itaú?",
        },
      ],
    };
  }

  const dateColumn = columns.get("date") as number;
  const descriptionColumn = columns.get("description");
  const amountColumn = columns.get("amount");
  const debitColumn = columns.get("debit");
  const creditColumn = columns.get("credit");
  const balanceColumn = columns.get("balance");

  if (amountColumn === undefined && debitColumn === undefined) {
    warnings.push({
      severity: "error",
      message: "o extrato não tem coluna de valor reconhecível.",
    });
  }

  // ---- Rows ----------------------------------------------------------------
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const line = headerIndex + offset + 2; // 1-based, as a spreadsheet shows it
    const rawDate = text(row[dateColumn]);
    const description =
      descriptionColumn === undefined ? "" : text(row[descriptionColumn]);

    if (rawDate === "" && description === "") continue;

    const occurredOn = readDate(rawDate);
    if (!occurredOn) {
      discarded.push({ line, description: description || rawDate, reason: "sem data válida" });
      continue;
    }

    const rawAmount = amountColumn === undefined ? "" : text(row[amountColumn]);
    const rawDebit = debitColumn === undefined ? "" : text(row[debitColumn]);
    const rawCredit = creditColumn === undefined ? "" : text(row[creditColumn]);
    const rawBalance = balanceColumn === undefined ? "" : text(row[balanceColumn]);

    // A balance line carries a balance and no value. This is the whole rule.
    if (rawAmount === "" && rawDebit === "" && rawCredit === "") {
      if (rawBalance !== "") {
        try {
          const balance = readAmount(rawBalance);
          if (isOpeningBalance(description)) openingBalance = balance;
          if (isDailyTotalBalance(description) || isSnapshotBalance(description)) {
            declaredBalances.push({ date: occurredOn, balance, label: description });
          }
        } catch {
          // A balance we cannot read is not worth failing the import over; it only costs
          // us the reconciliation for that day.
          warnings.push({
            severity: "info",
            message: `saldo ilegível na linha ${line}: ${JSON.stringify(rawBalance)}`,
          });
        }
      }
      discarded.push({
        line,
        description,
        reason: rawBalance === "" ? "linha sem valor" : "linha de saldo, não é movimento",
      });
      continue;
    }

    let amount: Cents;
    try {
      if (rawAmount !== "") {
        amount = readAmount(rawAmount);
      } else if (rawDebit !== "") {
        amount = -readAmount(rawDebit);
      } else {
        amount = readAmount(rawCredit);
      }
    } catch {
      discarded.push({ line, description, reason: `valor ilegível: ${rawAmount || rawDebit || rawCredit}` });
      continue;
    }

    if (amount === 0n) {
      discarded.push({ line, description, reason: "valor zero" });
      continue;
    }

    // The daily sweep is the same money moving inside the same balance (D35).
    if (isAutomaticSweep(description)) {
      discarded.push({
        line,
        description,
        reason: "varredura da aplicação automática, não é movimento de dinheiro",
      });
      continue;
    }

    const counterpartyColumn = columns.get("counterparty");
    const taxIdColumn = columns.get("taxId");
    const counterpartyName =
      counterpartyColumn === undefined ? null : text(row[counterpartyColumn]) || null;
    const rawTaxId = taxIdColumn === undefined ? "" : text(row[taxIdColumn]);
    const installment = readInstallment(description);

    transactions.push({
      occurredOn,
      description,
      amount: amount < 0n ? -amount : amount,
      direction: amount < 0n ? "out" : "in",
      counterpartyName,
      counterpartyTaxId: rawTaxId ? normalizeTaxId(rawTaxId) || null : null,
      installmentCurrent: installment?.current ?? null,
      installmentTotal: installment?.total ?? null,
      externalId: null,
      raw: {
        data: rawDate,
        lancamento: description,
        valor: rawAmount || rawDebit || rawCredit,
        razao_social: counterpartyName,
        cpf_cnpj: rawTaxId || null,
      },
    });
  }

  if (transactions.length === 0) {
    warnings.push({
      severity: "warning",
      message: "o arquivo foi lido, mas nenhuma linha virou movimento.",
    });
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
 * Checks the reading against the balances the statement prints on itself.
 *
 * Grouping by day is deliberate: exports come newest-first or oldest-first, and the order
 * inside a day is not meaningful — but the end-of-day balance is. If every day lands on
 * the declared figure, no line was dropped, duplicated or misread.
 */
export function reconcileStatement(parse: StatementParse): {
  ok: boolean;
  checked: number;
  failures: { date: IsoDate; expected: Cents; actual: Cents; difference: Cents }[];
  message: string;
} {
  const byDay = new Map<IsoDate, Cents>();
  for (const transaction of parse.transactions) {
    const signed =
      transaction.direction === "in" ? transaction.amount : -transaction.amount;
    byDay.set(transaction.occurredOn, (byDay.get(transaction.occurredOn) ?? 0n) + signed);
  }

  // Only the end-of-day total is a checkpoint; the export-time snapshot is not.
  const declared = new Map<IsoDate, Cents>();
  for (const entry of parse.declaredBalances) {
    if (normalizeHeader(entry.label) === "saldo total disponivel dia") {
      declared.set(entry.date, entry.balance);
    }
  }

  const days = [...new Set([...byDay.keys(), ...declared.keys()])].sort();
  const failures: { date: IsoDate; expected: Cents; actual: Cents; difference: Cents }[] = [];

  let running: Cents | null = parse.openingBalance;
  let checked = 0;

  for (const day of days) {
    const movement = byDay.get(day) ?? 0n;
    const stated = declared.get(day);

    if (running === null) {
      // No opening balance: anchor on the first declared figure and check from there.
      if (stated === undefined) continue;
      running = stated;
      continue;
    }

    running += movement;

    if (stated !== undefined) {
      checked += 1;
      if (stated !== running) {
        failures.push({ date: day, expected: stated, actual: running, difference: running - stated });
        // Re-anchor, so one bad day does not cascade into every day after it.
        running = stated;
      }
    }
  }

  const ok = failures.length === 0;
  return {
    ok,
    checked,
    failures,
    message: ok
      ? checked === 0
        ? "o extrato não traz saldos para conferir."
        : `saldo confere em ${checked} dia${checked === 1 ? "" : "s"}.`
      : `o saldo não fecha em ${failures.length} de ${checked} dias conferidos.`,
  };
}
