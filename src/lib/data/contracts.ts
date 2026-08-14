/**
 * Contracts, POC reports, and the runner that turns the engine's plan into rows.
 *
 * The engine itself is pure (`lib/recognition/engine.ts`). This is the part that decides
 * what to do with its output, and the rule that matters is in `applyPlan`: a row a human
 * has touched is never overwritten (D-A).
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, toNumeric, type Cents } from "@/lib/money";
import { fromNumericPercent, toNumericPercent, type Percent } from "@/lib/recognition/percent";
import type { IsoDate, Period } from "@/lib/dates";
import {
  planContract,
  type ContractStatus,
  type ContractType,
  type PocReport,
  type RecognitionContract,
  type RecognitionMethod,
} from "@/lib/recognition/engine";

export type Contract = RecognitionContract & {
  entityId: string;
  name: string;
  billingTerms: string | null;
  paymentTerms: string | null;
  parentContractId: string | null;
  version: number;
  supersededAt: string | null;
};

const COLUMNS = `id, entity_id, client_id, name, type, status, total_value, monthly_value,
  start_date, end_date, billing_terms, payment_terms, recognition_method,
  prorate_first_last_month, parent_contract_id, version, superseded_at, is_intercompany`;

type ContractRow = {
  id: string;
  entity_id: string;
  client_id: string;
  name: string;
  type: ContractType;
  status: ContractStatus;
  total_value: string | null;
  monthly_value: string | null;
  start_date: string | null;
  end_date: string | null;
  billing_terms: string | null;
  payment_terms: string | null;
  recognition_method: RecognitionMethod;
  prorate_first_last_month: boolean;
  parent_contract_id: string | null;
  version: number;
  superseded_at: string | null;
  is_intercompany: boolean;
};

/**
 * Which chart-of-accounts line a contract's revenue lands on.
 *
 * `contracts` has no category column, and adding one is a migration for a value that is
 * the same for every contract of a type today. Resolved by code instead: `3.01` for a
 * retainer, `3.02` for a project — both seeded from the `DRE Geral` sheet.
 */
export const REVENUE_CODE: Record<ContractType, string> = {
  retainer: "3.01",
  project: "3.02",
};

function toContract(row: ContractRow, categoryId: string): Contract {
  return {
    id: row.id,
    entityId: row.entity_id,
    clientId: row.client_id,
    categoryId,
    name: row.name,
    type: row.type,
    status: row.status,
    totalValue: row.total_value === null ? null : fromNumeric(row.total_value),
    monthlyValue: row.monthly_value === null ? null : fromNumeric(row.monthly_value),
    startDate: row.start_date,
    endDate: row.end_date,
    billingTerms: row.billing_terms,
    paymentTerms: row.payment_terms,
    recognitionMethod: row.recognition_method,
    prorateFirstLastMonth: row.prorate_first_last_month,
    parentContractId: row.parent_contract_id,
    version: row.version,
    supersededAt: row.superseded_at,
    isIntercompany: row.is_intercompany,
  };
}

async function revenueCategories(entityIds: string[]): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, code, entity_id")
    .in("entity_id", entityIds)
    .in("code", Object.values(REVENUE_CODE));

  if (error) throw new Error(`não foi possível resolver as contas de receita: ${error.message}`);

  const byKey = new Map<string, string>();
  for (const row of data as { id: string; code: string; entity_id: string }[]) {
    byKey.set(`${row.entity_id}|${row.code}`, row.id);
  }
  return byKey;
}

export async function listContracts(
  entityIds: string[],
  { includeSuperseded = false }: { includeSuperseded?: boolean } = {},
): Promise<Contract[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  let query = supabase.from("contracts").select(COLUMNS).in("entity_id", entityIds);
  if (!includeSuperseded) query = query.is("superseded_at", null);

  const { data, error } = await query.order("name");
  if (error) throw new Error(`não foi possível carregar os contratos: ${error.message}`);

  const categories = await revenueCategories(entityIds);
  return (data as ContractRow[]).map((row) =>
    toContract(row, categories.get(`${row.entity_id}|${REVENUE_CODE[row.type]}`) ?? ""),
  );
}

export async function getContract(id: string): Promise<Contract | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contracts").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`não foi possível carregar o contrato: ${error.message}`);
  if (!data) return null;

  const row = data as ContractRow;
  const categories = await revenueCategories([row.entity_id]);
  return toContract(row, categories.get(`${row.entity_id}|${REVENUE_CODE[row.type]}`) ?? "");
}

export type ContractInput = {
  clientId: string;
  name: string;
  type: ContractType;
  status: ContractStatus;
  totalValue: Cents | null;
  monthlyValue: Cents | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  billingTerms: string | null;
  paymentTerms: string | null;
  recognitionMethod: RecognitionMethod;
  prorateFirstLastMonth: boolean;
  isIntercompany: boolean;
};

function contractRow(input: ContractInput) {
  return {
    client_id: input.clientId,
    name: input.name,
    type: input.type,
    status: input.status,
    total_value: input.totalValue === null ? null : toNumeric(input.totalValue),
    monthly_value: input.monthlyValue === null ? null : toNumeric(input.monthlyValue),
    start_date: input.startDate,
    end_date: input.endDate,
    billing_terms: input.billingTerms,
    payment_terms: input.paymentTerms,
    recognition_method: input.recognitionMethod,
    prorate_first_last_month: input.prorateFirstLastMonth,
    is_intercompany: input.isIntercompany,
  };
}

export async function createContract(entityId: string, input: ContractInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contracts")
    .insert({ entity_id: entityId, ...contractRow(input) })
    .select("id")
    .single();

  if (error) throw new Error(`não foi possível criar o contrato: ${error.message}`);
  return (data as { id: string }).id;
}

export async function updateContract(id: string, input: ContractInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("contracts").update(contractRow(input)).eq("id", id);
  if (error) throw new Error(`não foi possível salvar o contrato: ${error.message}`);
}

/**
 * An amendment: a new version of the contract, with the old one kept and marked
 * superseded (D13). History is never edited — already-recognised months stay exactly as
 * they were, and the new terms apply from here on.
 */
export async function amendContract(
  entityId: string,
  original: Contract,
  input: ContractInput,
): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contracts")
    .insert({
      entity_id: entityId,
      ...contractRow(input),
      parent_contract_id: original.parentContractId ?? original.id,
      version: original.version + 1,
    })
    .select("id")
    .single();

  if (error) throw new Error(`não foi possível criar o aditivo: ${error.message}`);

  const { error: supersedeError } = await supabase
    .from("contracts")
    .update({ superseded_at: new Date().toISOString() })
    .eq("id", original.id);

  if (supersedeError) {
    throw new Error(`o aditivo foi criado mas a versão anterior não foi encerrada: ${supersedeError.message}`);
  }

  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// POC reports
// ---------------------------------------------------------------------------

export type StoredPocReport = PocReport & { id: string; notes: string | null };

export async function listPocReports(contractId: string): Promise<StoredPocReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("poc_reports")
    .select("id, period, percent_complete_cumulative, is_correction, notes")
    .eq("contract_id", contractId)
    .order("period");

  if (error) throw new Error(`não foi possível carregar os reportes: ${error.message}`);

  return (
    data as {
      id: string;
      period: string;
      percent_complete_cumulative: string;
      is_correction: boolean;
      notes: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    period: row.period,
    cumulative: fromNumericPercent(row.percent_complete_cumulative),
    isCorrection: row.is_correction,
    notes: row.notes,
  }));
}

export async function savePocReport(
  entityId: string,
  contractId: string,
  period: Period,
  cumulative: Percent,
  isCorrection: boolean,
  userId: string,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("poc_reports").upsert(
    {
      entity_id: entityId,
      contract_id: contractId,
      period,
      percent_complete_cumulative: toNumericPercent(cumulative),
      is_correction: isCorrection,
      reported_by: userId,
      reported_at: new Date().toISOString(),
    },
    { onConflict: "contract_id,period" },
  );

  if (error) throw new Error(`não foi possível gravar o reporte: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Running the engine
// ---------------------------------------------------------------------------

export type ApplyResult = {
  written: number;
  skipped: number;
  removed: number;
  missingReports: Period[];
  warnings: string[];
};

/**
 * Writes a contract's plan into `recognition_entries`.
 *
 * Idempotent by construction: the engine's output is a pure function of the contract and
 * its reports, and every row is keyed on `(contract, period, source, kind)`. Running it
 * twice changes nothing.
 *
 * The one thing it will not do is overwrite a row somebody edited by hand — those are
 * counted as skipped and reported, never silently replaced (D-A).
 */
export async function applyRecognition(
  contract: Contract,
  through: Period,
  userId: string,
): Promise<ApplyResult> {
  const supabase = await createClient();
  const reports = await listPocReports(contract.id);
  const plan = planContract(contract, { through, pocReports: reports });

  if (contract.categoryId === "") {
    return {
      written: 0,
      skipped: 0,
      removed: 0,
      missingReports: plan.missingReports,
      warnings: [
        `não existe a conta de receita ${REVENUE_CODE[contract.type]} no plano de contas ` +
          "desta entidade. Crie-a antes de reconhecer.",
      ],
    };
  }

  const { data, error } = await supabase
    .from("recognition_entries")
    .select("id, period, amount, manually_edited")
    .eq("contract_id", contract.id)
    .eq("source", "engine")
    .eq("kind", "revenue");

  if (error) throw new Error(`não foi possível ler o reconhecimento: ${error.message}`);

  const existing = new Map(
    (data as { id: string; period: string; amount: string; manually_edited: boolean }[]).map(
      (row) => [row.period, row],
    ),
  );

  const result: ApplyResult = {
    written: 0,
    skipped: 0,
    removed: 0,
    missingReports: plan.missingReports,
    warnings: [...plan.warnings],
  };

  for (const row of plan.rows) {
    const current = existing.get(row.period);
    existing.delete(row.period);

    if (current?.manually_edited) {
      result.skipped += 1;
      continue;
    }

    const payload = {
      entity_id: contract.entityId,
      contract_id: contract.id,
      client_id: row.clientId,
      category_id: row.categoryId,
      period: row.period,
      kind: row.kind,
      amount: toNumeric(row.amount),
      method: row.method,
      source: "engine" as const,
      is_intercompany: row.isIntercompany,
      notes: row.basis,
    };

    const { error: writeError } = current
      ? await supabase
          .from("recognition_entries")
          .update({ ...payload, updated_by: userId })
          .eq("id", current.id)
      : await supabase
          .from("recognition_entries")
          .insert({ ...payload, created_by: userId });

    if (writeError) {
      result.warnings.push(`${row.period}: ${writeError.message}`);
      continue;
    }
    result.written += 1;
  }

  // Months the plan no longer covers — a shortened term, a POC report deleted. A row the
  // engine wrote and no longer stands behind should not linger in the P&L.
  for (const [period, row] of existing) {
    if (row.manually_edited) {
      result.skipped += 1;
      continue;
    }
    const { error: deleteError } = await supabase
      .from("recognition_entries")
      .delete()
      .eq("id", row.id);
    if (deleteError) {
      result.warnings.push(`não consegui remover a linha de ${period}: ${deleteError.message}`);
      continue;
    }
    result.removed += 1;
  }

  return result;
}

/** Everything the engine has recognised for a contract, for the deferred revenue report. */
export async function listRecognitionForContract(
  contractId: string,
): Promise<{ period: Period; amount: Cents; source: string; manuallyEdited: boolean }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recognition_entries")
    .select("period, amount, source, manually_edited")
    .eq("contract_id", contractId)
    .eq("kind", "revenue")
    .order("period");

  if (error) throw new Error(`não foi possível carregar o reconhecimento: ${error.message}`);

  return (
    data as { period: string; amount: string; source: string; manually_edited: boolean }[]
  ).map((row) => ({
    period: row.period,
    amount: fromNumeric(row.amount),
    source: row.source,
    manuallyEdited: row.manually_edited,
  }));
}
