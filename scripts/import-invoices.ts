/**
 * Loads the real card invoices from `docs/reference/` into `staged_transactions`.
 *
 * The statement went in through the UI, one file at a time. Nineteen invoices spread over
 * thirty-four files — nine of which are the same invoice saved under another card's name —
 * is not a job for a file picker, so this does it in bulk, and does it the same way:
 * the same parsers, the same reconciliation, the same dedup hash, the same `pending`
 * status waiting for a human. Nothing reaches a ledger table (SPEC §7).
 *
 * Two things it refuses to do:
 *
 *   - import an invoice that does not reconcile against the total printed on itself
 *     (D-B: never "as best we could");
 *   - trust a filename. `Itaucard_4460_fatura_072026.pdf` is account 5780's invoice due
 *     2026-04-05, and `4460` is one of the seven cards billing on it. Identity is read
 *     from inside the PDF, and two files carrying the same (account, due date) are the
 *     same invoice.
 *
 *   npm run import:invoices             # mostra o que faria
 *   npm run import:invoices -- --ensaio # grava numa transação revertida e mede
 *   npm run import:invoices -- --aplicar
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "./load-env.ts";
import { readPdfPages } from "@/lib/import/pdf";
import { parseItauCardInvoice, reconcileCardInvoice } from "@/lib/import/itau-card";
import { dedupHash } from "@/lib/dedup";
import { formatMoney, toNumeric } from "@/lib/money";
import type { CardInvoiceParse } from "@/lib/import/types";

loadEnvLocal();

const DIRECTORY = process.env["REFERENCE_DIR"] ?? "docs/reference";
const APPLY = process.argv.includes("--aplicar");
const REHEARSE = process.argv.includes("--ensaio");

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

/** Thrown to undo everything the rehearsal inserted. */
class Rollback extends Error {}

/**
 * The billing account printed on the invoice → the account it was seeded as.
 *
 * `8384` is the account; `8299` is the only card on it, and the seed named the account
 * after that card. Every other invoice belongs to account `5780`, whose seven cards
 * (2227, 4460, 4740, 8993, 6256, 0063, 4200) are what the filenames are named for.
 * Both facts were read out of the PDFs, not assumed.
 */
const ACCOUNT_BY_INVOICE_DIGITS: Record<string, string> = {
  "5780": "5780",
  "8384": "8299",
};

type Invoice = {
  filename: string;
  bytes: Uint8Array;
  fileHash: string;
  parse: CardInvoiceParse;
  accountDigits: string;
  dueDate: string;
  /** Files that carry this same invoice under another name. */
  aliases: string[];
};

function isoOf(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

async function read(): Promise<{ invoices: Invoice[]; skipped: string[]; refused: string[] }> {
  let entries: string[];
  try {
    entries = readdirSync(DIRECTORY).filter((name) => statSync(join(DIRECTORY, name)).isFile());
  } catch {
    throw new Error(`${DIRECTORY} não existe — nada a importar.`);
  }

  const byIdentity = new Map<string, Invoice>();
  const skipped: string[] = [];
  const refused: string[] = [];

  for (const name of entries.filter((entry) => entry.toLowerCase().endsWith(".pdf")).sort()) {
    const bytes = new Uint8Array(readFileSync(join(DIRECTORY, name)));

    let parse: CardInvoiceParse;
    try {
      parse = parseItauCardInvoice(await readPdfPages(bytes));
    } catch {
      skipped.push(`${name} — não é uma fatura`);
      continue;
    }

    const accountDigits = parse.source.accountLastDigits;
    const dueDate = isoOf(parse.dueDate);
    if (!accountDigits || !dueDate) {
      skipped.push(`${name} — sem conta ou vencimento legível`);
      continue;
    }

    const check = reconcileCardInvoice(parse);
    if (!check.ok) {
      refused.push(`${name} — ${check.message}`);
      continue;
    }

    const identity = `${accountDigits}|${dueDate}`;
    const existing = byIdentity.get(identity);
    if (existing) {
      existing.aliases.push(name);
      continue;
    }

    byIdentity.set(identity, {
      filename: name,
      bytes,
      fileHash: createHash("sha256").update(bytes).digest("hex"),
      parse,
      accountDigits,
      dueDate,
      aliases: [],
    });
  }

  const invoices = [...byIdentity.values()].sort((a, b) =>
    a.accountDigits === b.accountDigits
      ? a.dueDate.localeCompare(b.dueDate)
      : a.accountDigits.localeCompare(b.accountDigits),
  );

  return { invoices, skipped, refused };
}

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, connect_timeout: 20 });

try {
  const entities = await sql<{ id: string }[]>`
    select id from entities where slug = 'dd-group'`;
  const entity = entities[0];
  if (!entity) throw new Error("entidade dd-group não encontrada — rode npm run db:seed");
  const entityId = entity.id;

  const users = await sql<{ id: string }[]>`
    select user_id as id from user_entities where entity_id = ${entityId} limit 1`;
  const userId = users[0]?.id ?? null;

  const accounts = await sql<{ id: string; name: string; lastDigits: string | null }[]>`
    select id, name, last_digits as "lastDigits"
    from accounts where entity_id = ${entityId} and type = 'credit_card'`;
  const accountByDigits = new Map(
    accounts.filter((account) => account.lastDigits).map((account) => [account.lastDigits!, account]),
  );

  const alreadyImported = await sql<{ fileHash: string }[]>`
    select file_hash as "fileHash" from statement_imports where entity_id = ${entityId}`;
  const seenHashes = new Set(alreadyImported.map((row) => row.fileHash));

  const { invoices, skipped, refused } = await read();

  console.log(`\n${BOLD}${invoices.length} faturas distintas em ${DIRECTORY}${RESET}\n`);

  let totalLines = 0;
  const pending: Invoice[] = [];

  for (const invoice of invoices) {
    const target = ACCOUNT_BY_INVOICE_DIGITS[invoice.accountDigits];
    const account = target ? accountByDigits.get(target) : undefined;
    const already = seenHashes.has(invoice.fileHash);
    if (account && !already) {
      pending.push(invoice);
      totalLines += invoice.parse.transactions.length;
    }

    const status = !account
      ? `${RED}sem conta cadastrada para ${invoice.accountDigits}${RESET}`
      : already
        ? `${YELLOW}já importada${RESET}`
        : `${GREEN}importar${RESET}`;

    console.log(
      `  conta ${invoice.accountDigits}  venc ${invoice.dueDate}  ` +
        `${String(invoice.parse.transactions.length).padStart(3)} lanç  ` +
        `${(invoice.parse.statedInvoiceTotal === null ? "—" : formatMoney(invoice.parse.statedInvoiceTotal)).padStart(12)}  ` +
        `${status}` +
        `${invoice.aliases.length > 0 ? `${DIM}  (+${invoice.aliases.length} arquivo(s) com o mesmo conteúdo)${RESET}` : ""}`,
    );
  }

  if (skipped.length > 0) {
    console.log(`\n${DIM}ignorados: ${skipped.length} arquivos que não são fatura${RESET}`);
  }
  if (refused.length > 0) {
    console.log(`\n${BOLD}${RED}recusadas por não fechar${RESET}`);
    for (const line of refused) console.log(`  ${line}`);
  }

  console.log(
    `\n${BOLD}${pending.length} faturas a importar, ${totalLines} lançamentos.${RESET}`,
  );

  /** Mirrors `stageImport`/`stageRows` in src/lib/data/imports.ts. */
  async function write(db: Sql): Promise<{ imports: number; lines: number; duplicates: number }> {
    let imports = 0;
    let lines = 0;
    let duplicates = 0;

    for (const invoice of pending) {
      const target = ACCOUNT_BY_INVOICE_DIGITS[invoice.accountDigits]!;
      const account = accountByDigits.get(target)!;
      const dates = invoice.parse.transactions.map((transaction) => transaction.occurredOn).sort();

      const inserted = await db<{ id: string }[]>`
        insert into statement_imports
          (entity_id, account_id, filename, file_hash, format, period_start, period_end,
           statement_closing_balance, status, imported_by)
        values (${entityId}, ${account.id}, ${invoice.filename}, ${invoice.fileHash}, 'pdf',
                ${dates[0] ?? null}, ${dates[dates.length - 1] ?? null},
                ${invoice.parse.statedInvoiceTotal === null ? null : toNumeric(invoice.parse.statedInvoiceTotal)},
                'reviewing', ${userId})
        returning id`;
      const importId = inserted[0]?.id;
      if (!importId) throw new Error(`não foi possível registrar ${invoice.filename}`);
      imports += 1;

      // Two identical lines in the same invoice are two purchases, not a duplicate, so
      // each repeat takes the next occurrence index (SPEC §11.5, D78).
      const occurrences = new Map<string, number>();
      const hashes = invoice.parse.transactions.map((transaction) => {
        const subject = {
          accountId: account.id,
          occurredOn: transaction.occurredOn,
          amount: transaction.amount,
          direction: transaction.direction,
          description: transaction.description,
          counterparty: transaction.counterpartyTaxId ?? transaction.counterpartyName,
        };
        const key = dedupHash(subject);
        const index = occurrences.get(key) ?? 0;
        occurrences.set(key, index + 1);
        return dedupHash({ ...subject, suffix: index });
      });

      // Only what is already in the ledger counts as a duplicate.
      const inLedger = await db<{ dedupHash: string }[]>`
        select dedup_hash as "dedupHash" from cash_entries
        where entity_id = ${entityId} and dedup_hash = any(${hashes})`;
      const existing = new Set(inLedger.map((row) => row.dedupHash));

      for (const [index, transaction] of invoice.parse.transactions.entries()) {
        const hash = hashes[index] as string;
        const isDuplicate = existing.has(hash);
        if (isDuplicate) duplicates += 1;

        await db`
          insert into staged_transactions
            (entity_id, import_id, occurred_on, description, amount, counterparty_name,
             counterparty_tax_id, installment_current, installment_total, external_id,
             dedup_hash, status, raw_json)
          values (${entityId}, ${importId}, ${transaction.occurredOn}, ${transaction.description},
                  ${toNumeric(transaction.direction === "out" ? -transaction.amount : transaction.amount)},
                  ${transaction.counterpartyName}, ${transaction.counterpartyTaxId},
                  ${transaction.installmentCurrent}, ${transaction.installmentTotal},
                  ${transaction.externalId}, ${hash},
                  ${isDuplicate ? "duplicate" : "pending"}, ${db.json(transaction.raw)})`;
        lines += 1;
      }
    }

    return { imports, lines, duplicates };
  }

  if (pending.length === 0) {
    console.log(`\n${DIM}nada a fazer.${RESET}\n`);
  } else if (!APPLY && !REHEARSE) {
    console.log(
      `\n${DIM}nada foi gravado. Rode com --ensaio para ensaiar numa transação revertida, ` +
        `ou --aplicar para importar.${RESET}\n`,
    );
  } else {
    const done = await (REHEARSE
      ? sql
          .begin(async (tx) => {
            const counts = await write(tx as unknown as Sql);
            throw new Rollback(JSON.stringify(counts));
          })
          .catch((error: unknown) => {
            if (error instanceof Rollback) {
              return JSON.parse(error.message) as { imports: number; lines: number; duplicates: number };
            }
            throw error;
          })
      : write(sql));

    console.log(
      `\n${GREEN}${done.imports} faturas e ${done.lines} lançamentos ` +
        `${REHEARSE ? "seriam importados" : "importados"}${RESET}` +
        `${done.duplicates > 0 ? `, ${done.duplicates} marcados como duplicata` : ""}.`,
    );
    if (REHEARSE) console.log(`${DIM}ensaio: a transação foi revertida, nada foi gravado.${RESET}\n`);
    else console.log("");
  }
} finally {
  await sql.end();
}
