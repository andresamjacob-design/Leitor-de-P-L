/**
 * The cash ledger, and the two things that have to happen alongside every write to it:
 *
 *   - the **cash mirror** into `recognition_entries`, so a cost that exists in the bank
 *     also exists in the P&L, in its competência month (DECISIONS D2a/D2b);
 *   - the **transfer counterpart**, so moving money between your own accounts writes both
 *     legs and pairs them, instead of leaving a hole on one side (D14b).
 *
 * Nothing here is locked after saving (D-A). What makes that safe is the audit trigger in
 * `0001_rls_and_audit.sql`, which records `before`/`after` for every mutation.
 *
 * On atomicity: Supabase's REST interface has no multi-statement transaction, so an entry
 * and its mirror are two round trips. The mirror write is therefore **idempotent** — it
 * is derived entirely from the entry, so re-saving repairs any drift — and a failed
 * mirror on a fresh insert rolls the entry back rather than leaving an orphan.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import type { IsoDate, Period } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";
import { planCashMirror } from "@/lib/recognition/mirror";
import { dedupHash } from "@/lib/dedup";
import type { Category } from "@/lib/data/categories";

export type CashEntry = {
  id: string;
  entityId: string;
  accountId: string;
  occurredOn: IsoDate;
  competencePeriod: Period | null;
  amount: Cents;
  direction: EntryDirection;
  description: string;
  categoryId: string | null;
  clientId: string | null;
  personId: string | null;
  vendor: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  isIntercompany: boolean;
  importId: string | null;
  createdAt: string;
  updatedAt: string | null;
};

type CashEntryRow = {
  id: string;
  entity_id: string;
  account_id: string;
  occurred_on: string;
  competence_period: string | null;
  amount: string;
  direction: EntryDirection;
  description: string;
  category_id: string | null;
  client_id: string | null;
  person_id: string | null;
  vendor: string | null;
  counterparty_name: string | null;
  counterparty_tax_id: string | null;
  is_intercompany: boolean;
  import_id: string | null;
  created_at: string;
  updated_at: string | null;
};

const COLUMNS = `id, entity_id, account_id, occurred_on, competence_period, amount, direction,
  description, category_id, client_id, person_id, vendor, counterparty_name,
  counterparty_tax_id, is_intercompany, import_id, created_at, updated_at`;

function toEntry(row: CashEntryRow): CashEntry {
  return {
    id: row.id,
    entityId: row.entity_id,
    accountId: row.account_id,
    occurredOn: row.occurred_on,
    competencePeriod: row.competence_period,
    amount: fromNumeric(row.amount),
    direction: row.direction,
    description: row.description,
    categoryId: row.category_id,
    clientId: row.client_id,
    personId: row.person_id,
    vendor: row.vendor,
    counterpartyName: row.counterparty_name,
    counterpartyTaxId: row.counterparty_tax_id,
    isIntercompany: row.is_intercompany,
    importId: row.import_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type CashEntryFilter = {
  entityIds: string[];
  from?: IsoDate;
  to?: IsoDate;
  accountIds?: string[];
  /** `"none"` means uncategorised. Several ids happen in consolidated scope, where the
   *  same chart-of-accounts line exists once per entity. */
  categoryId?: string | "none";
  categoryIds?: string[];
  direction?: EntryDirection;
  search?: string;
  limit?: number;
};

export async function listCashEntries(filter: CashEntryFilter): Promise<CashEntry[]> {
  if (filter.entityIds.length === 0) return [];

  const supabase = await createClient();
  let query = supabase.from("cash_entries").select(COLUMNS).in("entity_id", filter.entityIds);

  if (filter.from) query = query.gte("occurred_on", filter.from);
  if (filter.to) query = query.lte("occurred_on", filter.to);
  if (filter.accountIds && filter.accountIds.length > 0) {
    query = query.in("account_id", filter.accountIds);
  }
  if (filter.categoryId === "none") query = query.is("category_id", null);
  else if (filter.categoryId) query = query.eq("category_id", filter.categoryId);
  else if (filter.categoryIds && filter.categoryIds.length > 0) {
    query = query.in("category_id", filter.categoryIds);
  }
  if (filter.direction) query = query.eq("direction", filter.direction);
  if (filter.search) {
    const term = filter.search.replace(/[%,]/g, " ").trim();
    if (term) query = query.ilike("description", `%${term}%`);
  }

  const { data, error } = await query
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 500);

  if (error) throw new Error(`não foi possível carregar os lançamentos: ${error.message}`);
  return (data as CashEntryRow[]).map(toEntry);
}

export async function getCashEntry(id: string): Promise<CashEntry | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_entries")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar o lançamento: ${error.message}`);
  return data ? toEntry(data as CashEntryRow) : null;
}

/** The other leg of a transfer, when this entry has one. */
export async function getTransferPair(
  cashEntryId: string,
): Promise<{ id: string; toCashEntryId: string | null; toAccountId: string | null } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transfer_pairs")
    .select("id, to_cash_entry_id, to_account_id")
    .eq("from_cash_entry_id", cashEntryId)
    .maybeSingle();

  if (error) throw new Error(`não foi possível carregar o pareamento: ${error.message}`);
  if (!data) return null;

  const row = data as { id: string; to_cash_entry_id: string | null; to_account_id: string | null };
  return { id: row.id, toCashEntryId: row.to_cash_entry_id, toAccountId: row.to_account_id };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CashEntryInput = {
  accountId: string;
  occurredOn: IsoDate;
  competencePeriod: Period | null;
  amount: Cents;
  direction: EntryDirection;
  description: string;
  categoryId: string | null;
  clientId: string | null;
  personId: string | null;
  vendor: string | null;
  isIntercompany: boolean;
  /** Only meaningful for a transfer category: the account the money lands in (D14b). */
  counterpartAccountId: string | null;
  /** Set by the user to confirm a deliberate repeat of an identical movement. */
  allowDuplicate: boolean;
};

export class DuplicateEntryError extends Error {
  constructor() {
    super(
      "já existe um lançamento idêntico nesta conta, nesta data e com este valor. " +
        "Marque “gravar mesmo assim” se for uma segunda ocorrência de verdade.",
    );
    this.name = "DuplicateEntryError";
  }
}

function isUniqueViolation(message: string): boolean {
  return message.includes("cash_entries_entity_dedup_key") || message.includes("duplicate key");
}

async function hashFor(input: CashEntryInput, existingId: string | null): Promise<string> {
  const base = {
    accountId: input.accountId,
    occurredOn: input.occurredOn,
    amount: input.amount,
    direction: input.direction,
    description: input.description,
  };
  if (!input.allowDuplicate) return dedupHash(base);

  // A deliberate repeat: walk the suffix until the hash is free. Bounded, because a
  // hundred identical movements on one day in one account is not a real scenario.
  const supabase = await createClient();
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = dedupHash({ ...base, suffix });
    const { data } = await supabase
      .from("cash_entries")
      .select("id")
      .eq("dedup_hash", candidate)
      .maybeSingle();
    const taken = data as { id: string } | null;
    if (!taken || taken.id === existingId) return candidate;
  }
  throw new Error("lançamentos idênticos demais nesta conta e data — revise antes de gravar.");
}

function toRow(input: CashEntryInput, dedup: string) {
  return {
    account_id: input.accountId,
    occurred_on: input.occurredOn,
    competence_period: input.competencePeriod,
    amount: toNumeric(input.amount),
    direction: input.direction,
    description: input.description.trim(),
    category_id: input.categoryId,
    client_id: input.clientId,
    person_id: input.personId,
    vendor: input.vendor,
    is_intercompany: input.isIntercompany,
    dedup_hash: dedup,
  };
}

export type SaveResult = {
  id: string;
  /** Anything the user has to know about what the save did or refused to do (SPEC §14). */
  notices: string[];
};

export async function createCashEntry(
  entityId: string,
  input: CashEntryInput,
  categories: readonly Category[],
  userId: string,
): Promise<SaveResult> {
  const supabase = await createClient();
  const dedup = await hashFor(input, null);

  const { data, error } = await supabase
    .from("cash_entries")
    .insert({ entity_id: entityId, created_by: userId, ...toRow(input, dedup) })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error.message)) throw new DuplicateEntryError();
    throw new Error(`não foi possível criar o lançamento: ${error.message}`);
  }

  const id = (data as { id: string }).id;

  try {
    const notices = await syncDerived(entityId, id, input, categories, userId);
    return { id, notices };
  } catch (cause) {
    // The entry exists but its mirror does not. Rather than leave a cost that the P&L
    // will never see, undo the insert and report the real reason.
    await supabase.from("cash_entries").delete().eq("id", id);
    throw cause;
  }
}

export async function updateCashEntry(
  entityId: string,
  id: string,
  input: CashEntryInput,
  categories: readonly Category[],
  userId: string,
): Promise<SaveResult> {
  const supabase = await createClient();
  const dedup = await hashFor(input, id);

  const { error } = await supabase
    .from("cash_entries")
    .update({ updated_by: userId, ...toRow(input, dedup) })
    .eq("id", id);

  if (error) {
    if (isUniqueViolation(error.message)) throw new DuplicateEntryError();
    throw new Error(`não foi possível salvar o lançamento: ${error.message}`);
  }

  const notices = await syncDerived(entityId, id, input, categories, userId);
  return { id, notices };
}

export async function deleteCashEntry(id: string): Promise<void> {
  const supabase = await createClient();

  // The counterpart of a transfer goes with it — half a transfer is worse than none.
  const pair = await getTransferPair(id);
  const { error } = await supabase.from("cash_entries").delete().eq("id", id);
  if (error) throw new Error(`não foi possível apagar o lançamento: ${error.message}`);

  if (pair?.toCashEntryId) {
    await supabase.from("cash_entries").delete().eq("id", pair.toCashEntryId);
  }
}

// ---------------------------------------------------------------------------
// Derived rows: the mirror and the transfer counterpart
// ---------------------------------------------------------------------------

async function syncDerived(
  entityId: string,
  id: string,
  input: CashEntryInput,
  categories: readonly Category[],
  userId: string,
): Promise<string[]> {
  const category = input.categoryId
    ? (categories.find((candidate) => candidate.id === input.categoryId) ?? null)
    : null;

  const notices = await syncCashMirror(entityId, id, input, category, userId);
  notices.push(...(await syncTransferCounterpart(entityId, id, input, category, userId)));
  return notices;
}

/** Idempotent: it derives the whole mirror row from the entry, every time. */
async function syncCashMirror(
  entityId: string,
  cashEntryId: string,
  input: CashEntryInput,
  category: Category | null,
  userId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const plan = planCashMirror({
    categoryId: input.categoryId,
    categoryKind: category?.kind ?? null,
    direction: input.direction,
    occurredOn: input.occurredOn,
    competencePeriod: input.competencePeriod,
    amount: input.amount,
  });

  const { data, error } = await supabase
    .from("recognition_entries")
    .select("id, manually_edited")
    .eq("cash_entry_id", cashEntryId)
    .eq("source", "cash_mirror")
    .maybeSingle();

  if (error) throw new Error(`não foi possível ler a competência: ${error.message}`);
  const existing = data as { id: string; manually_edited: boolean } | null;

  // D-A: the engine never overwrites a line a human touched. It says so instead.
  if (existing?.manually_edited) {
    return [
      "a linha de competência deste lançamento foi editada à mão e não foi recalculada.",
    ];
  }

  if (!plan) {
    if (existing) {
      const { error: deleteError } = await supabase
        .from("recognition_entries")
        .delete()
        .eq("id", existing.id);
      if (deleteError) {
        throw new Error(`não foi possível remover a competência: ${deleteError.message}`);
      }
    }
    return [];
  }

  const row = {
    entity_id: entityId,
    period: plan.period,
    category_id: plan.categoryId,
    kind: plan.kind,
    amount: toNumeric(plan.amount),
    source: "cash_mirror" as const,
    cash_entry_id: cashEntryId,
    client_id: input.clientId,
    person_id: input.personId,
    is_intercompany: input.isIntercompany,
  };

  const { error: writeError } = existing
    ? await supabase
        .from("recognition_entries")
        .update({ ...row, updated_by: userId })
        .eq("id", existing.id)
    : await supabase.from("recognition_entries").insert({ ...row, created_by: userId });

  if (writeError) {
    throw new Error(`não foi possível gravar a competência: ${writeError.message}`);
  }
  return [];
}

/**
 * A transfer with a destination writes the other leg itself. The card bill is the case
 * that matters: R$ 1.200 leaves the bank and R$ 1.200 of debt leaves the card, so the
 * card balance is right and the cash flow still shows the payment exactly once (D-C).
 */
async function syncTransferCounterpart(
  entityId: string,
  cashEntryId: string,
  input: CashEntryInput,
  category: Category | null,
  userId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const existing = await getTransferPair(cashEntryId);
  const wanted = category?.kind === "transfer" ? input.counterpartAccountId : null;

  if (!wanted) {
    if (existing) {
      await supabase.from("transfer_pairs").delete().eq("id", existing.id);
      if (existing.toCashEntryId) {
        await supabase.from("cash_entries").delete().eq("id", existing.toCashEntryId);
      }
      return ["o pareamento de transferência foi desfeito e a contrapartida, removida."];
    }
    return [];
  }

  if (wanted === input.accountId) {
    return ["a conta de destino é a mesma de origem — nenhuma contrapartida foi criada."];
  }

  const opposite: EntryDirection = input.direction === "out" ? "in" : "out";
  const counterpart = {
    account_id: wanted,
    occurred_on: input.occurredOn,
    competence_period: input.competencePeriod,
    amount: toNumeric(input.amount),
    direction: opposite,
    description: input.description.trim(),
    category_id: input.categoryId,
    is_intercompany: input.isIntercompany,
    dedup_hash: dedupHash({
      accountId: wanted,
      occurredOn: input.occurredOn,
      amount: input.amount,
      direction: opposite,
      description: `${input.description.trim()} (contrapartida de ${cashEntryId})`,
    }),
  };

  let counterpartId = existing?.toCashEntryId ?? null;

  if (counterpartId) {
    const { error } = await supabase
      .from("cash_entries")
      .update({ ...counterpart, updated_by: userId })
      .eq("id", counterpartId);
    if (error) throw new Error(`não foi possível atualizar a contrapartida: ${error.message}`);
  } else {
    const { data, error } = await supabase
      .from("cash_entries")
      .insert({ entity_id: entityId, created_by: userId, ...counterpart })
      .select("id")
      .single();
    if (error) throw new Error(`não foi possível criar a contrapartida: ${error.message}`);
    counterpartId = (data as { id: string }).id;
  }

  const kind =
    category?.code === "99.02"
      ? "card_payment"
      : category?.code === "99.03"
        ? "investment"
        : "internal";

  const pair = {
    entity_id: entityId,
    from_cash_entry_id: cashEntryId,
    to_cash_entry_id: counterpartId,
    to_account_id: wanted,
    kind,
  };

  const { error: pairError } = existing
    ? await supabase.from("transfer_pairs").update(pair).eq("id", existing.id)
    : await supabase.from("transfer_pairs").insert(pair);

  if (pairError) {
    throw new Error(`não foi possível parear a transferência: ${pairError.message}`);
  }
  return [];
}
