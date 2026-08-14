/**
 * Notas fiscais.
 *
 * The system **records** NFs issued elsewhere and reconciles them; it never issues one
 * (D6, and SPEC §13 stays intact).
 *
 * An NF does not create revenue. Recognition comes from the contract, through the engine
 * — if the NF also wrote a recognition row, the same revenue would land twice (D45). What
 * the NF gives is the third column of the reconciliation: **reconhecido** (what was
 * earned), **faturado** (what was billed), **recebido** (what arrived). Three numbers that
 * should converge, and whose gaps are the questions worth asking.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, sum, toNumeric, type Cents } from "@/lib/money";
import { periodOf, type IsoDate, type Period } from "@/lib/dates";

export type InvoiceStatus = "issued" | "partially_paid" | "paid" | "cancelled";

export type Invoice = {
  id: string;
  entityId: string;
  clientId: string;
  contractId: string | null;
  number: string;
  series: string | null;
  issueDate: IsoDate;
  /** What drives competência — not the issue date (D6). */
  servicePeriod: Period;
  dueDate: IsoDate | null;
  status: InvoiceStatus;
  grossAmount: Cents;
  netAmount: Cents | null;
  isIntercompany: boolean;
  notes: string | null;
};

const COLUMNS = `id, entity_id, client_id, contract_id, number, series, issue_date,
  service_period, due_date, status, gross_amount, net_amount, is_intercompany, notes`;

type InvoiceRow = {
  id: string;
  entity_id: string;
  client_id: string;
  contract_id: string | null;
  number: string;
  series: string | null;
  issue_date: string;
  service_period: string;
  due_date: string | null;
  status: InvoiceStatus;
  gross_amount: string;
  net_amount: string | null;
  is_intercompany: boolean;
  notes: string | null;
};

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    entityId: row.entity_id,
    clientId: row.client_id,
    contractId: row.contract_id,
    number: row.number,
    series: row.series,
    issueDate: row.issue_date,
    servicePeriod: row.service_period,
    dueDate: row.due_date,
    status: row.status,
    grossAmount: fromNumeric(row.gross_amount),
    netAmount: row.net_amount === null ? null : fromNumeric(row.net_amount),
    isIntercompany: row.is_intercompany,
    notes: row.notes,
  };
}

export async function listInvoices(
  entityIds: string[],
  { contractId, clientId }: { contractId?: string; clientId?: string } = {},
): Promise<Invoice[]> {
  if (entityIds.length === 0) return [];
  const supabase = await createClient();
  let query = supabase.from("invoices").select(COLUMNS).in("entity_id", entityIds);
  if (contractId) query = query.eq("contract_id", contractId);
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query.order("issue_date", { ascending: false }).limit(2000);
  if (error) throw new Error(`não foi possível carregar as notas fiscais: ${error.message}`);
  return (data as InvoiceRow[]).map(toInvoice);
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`não foi possível carregar a nota fiscal: ${error.message}`);
  return data ? toInvoice(data as InvoiceRow) : null;
}

export type InvoiceInput = {
  clientId: string;
  contractId: string | null;
  number: string;
  series: string | null;
  issueDate: IsoDate;
  servicePeriod: Period;
  dueDate: IsoDate | null;
  status: InvoiceStatus;
  grossAmount: Cents;
  netAmount: Cents | null;
  isIntercompany: boolean;
  notes: string | null;
};

function invoiceRow(input: InvoiceInput) {
  return {
    client_id: input.clientId,
    contract_id: input.contractId,
    number: input.number,
    series: input.series,
    issue_date: input.issueDate,
    service_period: input.servicePeriod,
    due_date: input.dueDate,
    status: input.status,
    gross_amount: toNumeric(input.grossAmount),
    net_amount: input.netAmount === null ? null : toNumeric(input.netAmount),
    is_intercompany: input.isIntercompany,
    notes: input.notes,
  };
}

function translate(message: string): string {
  if (message.includes("invoices_entity_number_key")) {
    return "já existe uma nota fiscal com este número e série nesta entidade.";
  }
  if (message.includes("service_period_is_month_start")) {
    return "a competência tem que ser um mês, e é gravada como o primeiro dia dele.";
  }
  return `não foi possível salvar a nota fiscal: ${message}`;
}

export async function createInvoice(entityId: string, input: InvoiceInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .insert({ entity_id: entityId, ...invoiceRow(input) })
    .select("id")
    .single();

  if (error) throw new Error(translate(error.message));
  return (data as { id: string }).id;
}

export async function updateInvoice(id: string, input: InvoiceInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update(invoiceRow(input)).eq("id", id);
  if (error) throw new Error(translate(error.message));
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type ReconciliationRow = {
  period: Period;
  recognized: Cents;
  invoiced: Cents;
  received: Cents;
};

export type ContractReconciliation = {
  rows: ReconciliationRow[];
  totals: { recognized: Cents; invoiced: Cents; received: Cents };
};

/**
 * Recognised, invoiced and received, month by month.
 *
 * The three are placed on the same competência month on purpose, even though the money
 * arrives on its own date: comparing them by the month the work belongs to is what makes
 * "we earned it in March, billed it in April and got paid in May" legible instead of
 * looking like three unrelated numbers.
 */
export function reconcileContract({
  recognition,
  invoices,
  receipts,
}: {
  recognition: readonly { period: Period; amount: Cents }[];
  invoices: readonly Invoice[];
  /** Cash entries linked to this contract. Placed by the month the money arrived. */
  receipts: readonly { occurredOn: IsoDate; amount: Cents; direction: "in" | "out" }[];
}): ContractReconciliation {
  const byPeriod = new Map<Period, ReconciliationRow>();

  const touch = (period: Period): ReconciliationRow => {
    const current = byPeriod.get(period) ?? {
      period,
      recognized: 0n,
      invoiced: 0n,
      received: 0n,
    };
    byPeriod.set(period, current);
    return current;
  };

  for (const row of recognition) touch(row.period).recognized += row.amount;

  for (const invoice of invoices) {
    if (invoice.status === "cancelled") continue;
    touch(invoice.servicePeriod).invoiced += invoice.grossAmount;
  }

  for (const receipt of receipts) {
    const signed = receipt.direction === "in" ? receipt.amount : -receipt.amount;
    touch(periodOf(receipt.occurredOn)).received += signed;
  }

  const rows = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));

  return {
    rows,
    totals: {
      recognized: sum(rows.map((row) => row.recognized)),
      invoiced: sum(rows.map((row) => row.invoiced)),
      received: sum(rows.map((row) => row.received)),
    },
  };
}
