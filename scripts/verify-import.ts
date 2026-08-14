/**
 * Runs the importers over the real files in `docs/reference/` and checks each one against
 * the totals it prints on itself.
 *
 * This is not a test, and deliberately so: those files hold client names, CNPJs and
 * balances, they are gitignored, and no test may depend on them. The unit tests cover the
 * parsers with synthetic input; this covers them with reality, on the one machine that
 * has it.
 *
 *   npm run verify:import              # docs/reference
 *   npm run verify:import -- <pasta>
 *
 * Exits non-zero if any file fails to reconcile, so it can gate a change to a parser.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readXlsx } from "@/lib/import/xlsx";
import { parseItauStatement, reconcileStatement } from "@/lib/import/itau-statement";
import { readPdfPages } from "@/lib/import/pdf";
import { parseItauCardInvoice, reconcileCardInvoice } from "@/lib/import/itau-card";
import { detectRecurring, totalMonthly } from "@/lib/categorize/recurrence";
import type { RecurrenceCandidate } from "@/lib/categorize/recurrence";
import { formatMoney } from "@/lib/money";

const directory = process.argv[2] ?? "docs/reference";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const RESET = "[0m";

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

async function main(): Promise<void> {
  let entries: string[];
  try {
    entries = readdirSync(directory).filter((name) => statSync(join(directory, name)).isFile());
  } catch {
    console.log(`${directory} não existe. Nada a verificar.`);
    return;
  }

  const seen = new Map<string, string>();
  const charges: RecurrenceCandidate[] = [];
  let checked = 0;
  let failed = 0;
  let duplicates = 0;

  console.log(`Conferindo ${directory}\n`);

  // ---- Statements ---------------------------------------------------------
  console.log("Extratos de conta corrente");
  for (const name of entries.filter((file) => file.toLowerCase().endsWith(".xlsx")).sort()) {
    const bytes = new Uint8Array(readFileSync(join(directory, name)));

    let parse;
    try {
      parse = parseItauStatement(readXlsx(bytes)[0]?.rows ?? []);
    } catch (cause) {
      console.log(`  ${RED}ERRO ${RESET}${pad(name, 46)} ${(cause as Error).message}`);
      failed += 1;
      continue;
    }

    // A workbook that is not a statement is not a failure — it is a different file.
    if (parse.transactions.length === 0 && parse.warnings.some((w) => w.severity === "error")) {
      console.log(`  ${DIM}pular${RESET} ${pad(name, 46)} não é um extrato`);
      continue;
    }

    checked += 1;
    const result = reconcileStatement(parse);
    if (!result.ok) failed += 1;

    console.log(
      `  ${result.ok ? GREEN + "OK   " : RED + "FALHA"}${RESET} ${pad(name, 46)}` +
        ` ${String(parse.transactions.length).padStart(4)} mov` +
        ` ${DIM}${parse.periodStart ?? "?"} a ${parse.periodEnd ?? "?"}${RESET}` +
        `  ${result.message}`,
    );
    for (const failure of result.failures.slice(0, 3)) {
      console.log(
        `        ${failure.date}: extrato ${formatMoney(failure.expected)},` +
          ` calculei ${formatMoney(failure.actual)}`,
      );
    }
  }

  // ---- Card invoices ------------------------------------------------------
  console.log("\nFaturas de cartão");
  for (const name of entries.filter((file) => file.toLowerCase().endsWith(".pdf")).sort()) {
    const bytes = new Uint8Array(readFileSync(join(directory, name)));

    let parse;
    try {
      parse = parseItauCardInvoice(await readPdfPages(bytes));
    } catch (cause) {
      console.log(`  ${DIM}pular${RESET} ${pad(name, 46)} não abriu: ${(cause as Error).message}`);
      continue;
    }

    if (parse.transactions.length === 0 && parse.statedChargesTotal === null) {
      console.log(`  ${DIM}pular${RESET} ${pad(name, 46)} não é uma fatura`);
      continue;
    }

    checked += 1;
    const result = reconcileCardInvoice(parse);
    if (!result.ok) failed += 1;

    // The file name says nothing (A3); identity is the account and the due date.
    const identity = `${parse.source.accountLastDigits ?? "????"}|${parse.dueDate ?? "?"}`;
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const previous = seen.get(identity);
    if (previous !== undefined) duplicates += 1;
    else seen.set(identity, hash);

    // Only invoices that reconcile feed the recurrence pass — a misread file would
    // invent subscriptions that do not exist.
    if (result.ok && previous === undefined) {
      for (const [index, transaction] of parse.transactions.entries()) {
        if (transaction.direction !== "out") continue;
        charges.push({
          id: `${identity}-${index}`,
          description: transaction.description,
          occurredOn: transaction.occurredOn,
          amount: transaction.amount,
          categoryId: null,
          accountId: parse.source.accountLastDigits ?? "?",
        });
      }
    }

    console.log(
      `  ${result.ok ? GREEN + "OK   " : RED + "FALHA"}${RESET} ${pad(name, 46)}` +
        ` ${String(parse.transactions.length).padStart(4)} lanç` +
        ` ${DIM}conta ${parse.source.accountLastDigits ?? "----"} venc ${parse.dueDate ?? "?"}${RESET}` +
        `  ${formatMoney(result.actual).padStart(12)}` +
        (previous !== undefined ? `  ${DIM}(mesma fatura de outro arquivo)${RESET}` : ""),
    );
    if (!result.ok) {
      console.log(
        `        impresso ${result.expected === null ? "—" : formatMoney(result.expected)},` +
          ` extraído ${formatMoney(result.actual)}, diferença ${formatMoney(result.difference)}`,
      );
    }
  }

  // ---- Recurrences --------------------------------------------------------
  const recurrences = detectRecurring(charges);
  if (recurrences.length > 0) {
    console.log(`\nAssinaturas reconstruídas de ${charges.length} compras`);
    for (const recurrence of recurrences.slice(0, 20)) {
      console.log(
        `  ${pad(recurrence.label, 34)} ${recurrence.cadence.padEnd(7)}` +
          ` ${String(recurrence.occurrences).padStart(2)}x` +
          ` ${DIM}última ${recurrence.lastCharge}${RESET}` +
          (recurrence.active ? "     " : ` ${DIM}encerrada${RESET}`) +
          `  ${formatMoney(recurrence.monthlyCost).padStart(11)}/mês` +
          `  ${DIM}${formatMoney(recurrence.annualCost).padStart(11)}/ano${RESET}`,
      );
    }
    console.log(
      `  ${recurrences.filter((item) => item.active).length} ativas de ${recurrences.length}` +
        ` · ${formatMoney(totalMonthly(recurrences))} por mês` +
        ` · ${formatMoney(totalMonthly(recurrences) * 12n)} por ano`,
    );
  }

  console.log(
    `\n${checked} arquivos conferidos · ${checked - failed} fecham · ${failed} falham` +
      ` · ${duplicates} são a mesma fatura sob outro nome`,
  );

  if (failed > 0) process.exitCode = 1;
}

await main();
