/**
 * Staging an import, and letting a human approve it.
 *
 * The rule this file exists to enforce (SPEC §7): **nothing a parser produces reaches
 * `cash_entries` without a click**. A file becomes a `statement_import` plus a pile of
 * `staged_transactions`, and only an explicit approval turns those into ledger rows — one
 * at a time, through the same `createCashEntry` the manual form uses, so the competência
 * mirror and the audit trail behave identically whether a movement was typed or imported.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";
import { dedupHash } from "@/lib/dedup";
import {
  createCashEntry,
  DuplicateEntryError,
  type CashEntryInput,
} from "@/lib/data/cash-entries";
import type { Category } from "@/lib/data/categories";
import type { ParsedTransaction } from "@/lib/import/types";

export type ImportFormat = "ofx" | "csv" | "xlsx" | "pdf";
export type ImportStatus = "parsing" | "reviewing" | "approved" | "discarded" | "failed";
export type StagedStatus = "pending" | "approved" | "rejected" | "duplicate";

export type StatementImport = {
  id: string;
  entityId: string;
  accountId: string;
  filename: string;
  fileHash: string;
  format: ImportFormat;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  statementClosingBalance: Cents | null;
  status: ImportStatus;
  error: string | null;
  createdAt: string;
};

export type StagedTransaction = {
  id: string;
  importId: string;
  occurredOn: IsoDate;
  description: string;
  amount: Cents;
  direction: EntryDirection;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  suggestedCategoryId: string | null;
  suggestedClientId: string | null;
  suggestedPersonId: string | null;
  suggestionSource: "rule" | "ai" | "none";
  /** 0 to 1. Below 0,8 the review screen shows it without pre-selecting it (SPEC §8). */
  confidence: number | null;
  dedupHash: string;
  status: StagedStatus;
};

const IMPORT_COLUMNS =
  "id, entity_id, account_id, filename, file_hash, format, period_start, period_end, statement_closing_balance, status, error, created_at";

const STAGED_COLUMNS =
  `id, import_id, occurred_on, description, amount, counterparty_name, counterparty_tax_id,
   installment_current, installment_total, suggested_category_id, suggested_client_id,
   suggested_person_id, suggestion_source, confidence, dedup_hash, status, raw_json`;

type ImportRow = {
  id: string;
  entity_id: string;
  account_id: string;
  filename: string;
  file_hash: string;
  format: ImportFormat;
  period_start: string | null;
  period_end: string | null;
  statement_closing_balance: string | null;
  status: ImportStatus;
  error: string | null;
  created_at: string;
};

type StagedRow = {
  id: string;
  import_id: string;
  occurred_on: string;
  description: string;
  amount: string;
  counterparty_name: string | null;
  counterparty_tax_id: string | null;
  installment_current: number | null;
  installment_total: number | null;
  suggested_category_id: string | null;
  suggested_client_id: string | null;
  suggested_person_id: string | null;
  suggestion_source: "rule" | "ai" | "none";
  confidence: string | null;
  dedup_hash: string;
  status: StagedStatus;
  raw_json: Record<string, unknown> | null;
};

function toImport(row: ImportRow): StatementImport {
  return {
    id: row.id,
    entityId: row.entity_id,
    accountId: row.account_id,
    filename: row.filename,
    fileHash: row.file_hash,
    format: row.format,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    statementClosingBalance:
      row.statement_closing_balance === null ? null : fromNumeric(row.statement_closing_balance),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

function toStaged(row: StagedRow): StagedTransaction {
  const amount = fromNumeric(row.amount);
  return {
    id: row.id,
    importId: row.import_id,
    occurredOn: row.occurred_on,
    description: row.description,
    // `staged_transactions.amount` is signed, unlike the ledger's magnitude + direction.
    amount: amount < 0n ? -amount : amount,
    direction: amount < 0n ? "out" : "in",
    counterpartyName: row.counterparty_name,
    counterpartyTaxId: row.counterparty_tax_id,
    installmentCurrent: row.installment_current,
    installmentTotal: row.installment_total,
    suggestedCategoryId: row.suggested_category_id,
    suggestedClientId: row.suggested_client_id,
    suggestedPersonId: row.suggested_person_id,
    suggestionSource: row.suggestion_source ?? "none",
    confidence: row.confidence === null ? null : Number(row.confidence),
    dedupHash: row.dedup_hash,
    status: row.status,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listImports(entityIds: string[]): Promise<StatementImport[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("statement_imports")
    .select(IMPORT_COLUMNS)
    .in("entity_id", entityIds)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`não foi possível carregar as importações: ${error.message}`);
  return (data as ImportRow[]).map(toImport);
}

export async function getImport(id: string): Promise<StatementImport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("statement_imports")
    .select(IMPORT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar a importação: ${error.message}`);
  return data ? toImport(data as ImportRow) : null;
}

export async function listStaged(importId: string): Promise<StagedTransaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staged_transactions")
    .select(STAGED_COLUMNS)
    .eq("import_id", importId)
    .order("occurred_on")
    .limit(5000);

  if (error) throw new Error(`não foi possível carregar as linhas: ${error.message}`);
  return (data as StagedRow[]).map(toStaged);
}

/** Has this exact file been imported before? The hash is of the bytes, not the name. */
export async function findImportByHash(
  entityId: string,
  fileHash: string,
): Promise<StatementImport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("statement_imports")
    .select(IMPORT_COLUMNS)
    .eq("entity_id", entityId)
    .eq("file_hash", fileHash)
    .neq("status", "discarded")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`não foi possível conferir o arquivo: ${error.message}`);
  return data ? toImport(data as ImportRow) : null;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export type StageInput = {
  entityId: string;
  accountId: string;
  filename: string;
  fileHash: string;
  format: ImportFormat;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  statementClosingBalance: Cents | null;
  transactions: readonly ParsedTransaction[];
  userId: string;
};

export async function stageImport(input: StageInput): Promise<{ id: string; duplicates: number }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("statement_imports")
    .insert({
      entity_id: input.entityId,
      account_id: input.accountId,
      filename: input.filename,
      file_hash: input.fileHash,
      format: input.format,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      statement_closing_balance:
        input.statementClosingBalance === null ? null : toNumeric(input.statementClosingBalance),
      status: "reviewing",
      imported_by: input.userId,
    })
    .select("id")
    .single();

  if (error) throw new Error(`não foi possível registrar a importação: ${error.message}`);
  const importId = (data as { id: string }).id;

  // Anything already in the ledger under the same hash is marked before a human sees it,
  // so re-importing an overlapping period is a non-event (SPEC §11.5).
  const hashes = input.transactions.map((transaction) =>
    dedupHash({
      accountId: input.accountId,
      occurredOn: transaction.occurredOn,
      amount: transaction.amount,
      direction: transaction.direction,
      description: transaction.description,
    }),
  );

  const existing = await existingHashes(input.entityId, hashes);
  const seen = new Set<string>();
  let duplicates = 0;

  const rows = input.transactions.map((transaction, index) => {
    const hash = hashes[index] as string;
    // A hash repeated inside the same file is also a duplicate — the second occurrence
    // could never be inserted anyway, because the unique index would refuse it.
    const isDuplicate = existing.has(hash) || seen.has(hash);
    seen.add(hash);
    if (isDuplicate) duplicates += 1;

    return {
      entity_id: input.entityId,
      import_id: importId,
      occurred_on: transaction.occurredOn,
      description: transaction.description,
      amount: toNumeric(
        transaction.direction === "out" ? -transaction.amount : transaction.amount,
      ),
      counterparty_name: transaction.counterpartyName,
      counterparty_tax_id: transaction.counterpartyTaxId,
      installment_current: transaction.installmentCurrent,
      installment_total: transaction.installmentTotal,
      external_id: transaction.externalId,
      dedup_hash: hash,
      status: isDuplicate ? ("duplicate" as const) : ("pending" as const),
      raw_json: transaction.raw,
    };
  });

  // Batched: a year of statement is a few hundred rows, and one insert of 500 is fine,
  // but a 5.000-row file would exceed the request limit.
  for (let start = 0; start < rows.length; start += 500) {
    const { error: insertError } = await supabase
      .from("staged_transactions")
      .insert(rows.slice(start, start + 500));
    if (insertError) {
      await supabase.from("statement_imports").update({ status: "failed", error: insertError.message }).eq("id", importId);
      throw new Error(`não foi possível gravar as linhas: ${insertError.message}`);
    }
  }

  return { id: importId, duplicates };
}

async function existingHashes(entityId: string, hashes: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (hashes.length === 0) return found;

  const supabase = await createClient();
  for (let start = 0; start < hashes.length; start += 300) {
    const { data, error } = await supabase
      .from("cash_entries")
      .select("dedup_hash")
      .eq("entity_id", entityId)
      .in("dedup_hash", hashes.slice(start, start + 300));

    if (error) throw new Error(`não foi possível conferir duplicatas: ${error.message}`);
    for (const row of data as { dedup_hash: string }[]) found.add(row.dedup_hash);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export type ApprovalResult = {
  approved: number;
  duplicates: number;
  failures: { description: string; reason: string }[];
};

/**
 * Turns staged rows into ledger entries, one by one, through the ordinary write path.
 *
 * A row that collides with something already in the ledger is marked `duplicate` rather
 * than failing the batch — that is the whole point of re-importing an overlapping period.
 */
export async function approveStaged(
  entityId: string,
  accountId: string,
  importId: string,
  stagedIds: string[],
  categoryByStagedId: Map<string, string | null>,
  categories: readonly Category[],
  userId: string,
): Promise<ApprovalResult> {
  const supabase = await createClient();
  const staged = (await listStaged(importId)).filter((row) => stagedIds.includes(row.id));

  const result: ApprovalResult = { approved: 0, duplicates: 0, failures: [] };

  for (const row of staged) {
    const input: CashEntryInput = {
      accountId,
      occurredOn: row.occurredOn,
      competencePeriod: null,
      amount: row.amount,
      direction: row.direction,
      description: row.description,
      categoryId: categoryByStagedId.get(row.id) ?? row.suggestedCategoryId,
      clientId: null,
      personId: null,
      vendor: null,
      isIntercompany: false,
      counterpartAccountId: null,
      allowDuplicate: false,
      importId,
      counterpartyName: row.counterpartyName,
      counterpartyTaxId: row.counterpartyTaxId,
      installmentCurrent: row.installmentCurrent,
      installmentTotal: row.installmentTotal,
    };

    try {
      await createCashEntry(entityId, input, categories, userId);
      await supabase.from("staged_transactions").update({ status: "approved" }).eq("id", row.id);
      result.approved += 1;
    } catch (cause) {
      if (cause instanceof DuplicateEntryError) {
        await supabase.from("staged_transactions").update({ status: "duplicate" }).eq("id", row.id);
        result.duplicates += 1;
        continue;
      }
      result.failures.push({
        description: row.description,
        reason: cause instanceof Error ? cause.message : "erro desconhecido",
      });
    }
  }

  await refreshImportStatus(importId);
  return result;
}

export async function rejectStaged(importId: string, stagedIds: string[]): Promise<number> {
  if (stagedIds.length === 0) return 0;
  const supabase = await createClient();
  const { error } = await supabase
    .from("staged_transactions")
    .update({ status: "rejected" })
    .in("id", stagedIds);

  if (error) throw new Error(`não foi possível rejeitar as linhas: ${error.message}`);
  await refreshImportStatus(importId);
  return stagedIds.length;
}

/** An import is done once nothing in it is still waiting for a decision. */
async function refreshImportStatus(importId: string): Promise<void> {
  const supabase = await createClient();
  const pending = (await listStaged(importId)).some((row) => row.status === "pending");
  await supabase
    .from("statement_imports")
    .update({ status: pending ? "reviewing" : "approved" })
    .eq("id", importId);
}

export async function discardImport(importId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("statement_imports")
    .update({ status: "discarded" })
    .eq("id", importId);
  if (error) throw new Error(`não foi possível descartar a importação: ${error.message}`);
}
