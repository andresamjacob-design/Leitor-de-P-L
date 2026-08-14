/**
 * The audit trail. Nothing in this system is ever locked (DECISIONS D-A) — this is what
 * makes that safe, and it is written by the database trigger in `0001_rls_and_audit.sql`,
 * not by the application. The app can only read it.
 *
 * The full log screen is Fase 8; Fase 2 shows the trail of a single row where the editing
 * actually happens.
 */

import { createClient } from "@/lib/supabase/server";
import { formatMoney, fromNumeric } from "@/lib/money";

export type AuditEvent = {
  id: string;
  actor: string;
  action: "insert" | "update" | "delete";
  tableName?: string;
  rowId?: string | null;
  createdAt: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
};

export type AuditFilter = {
  entityIds: string[];
  tableName?: string;
  actor?: string;
  from?: string;
  to?: string;
  limit?: number;
};

/** The whole log, filtered. The per-row trail is `listAuditFor`. */
export async function listAudit(filter: AuditFilter): Promise<AuditEvent[]> {
  if (filter.entityIds.length === 0) return [];
  const supabase = await createClient();

  let query = supabase
    .from("audit_log")
    .select("id, actor, action, table_name, row_id, created_at, before_json, after_json")
    .in("entity_id", filter.entityIds);

  if (filter.tableName) query = query.eq("table_name", filter.tableName);
  if (filter.actor) query = query.eq("actor", filter.actor);
  if (filter.from) query = query.gte("created_at", `${filter.from}T00:00:00Z`);
  if (filter.to) query = query.lte("created_at", `${filter.to}T23:59:59Z`);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 500);

  if (error) throw new Error(`não foi possível carregar a auditoria: ${error.message}`);

  return (
    data as {
      id: string;
      actor: string;
      action: AuditEvent["action"];
      table_name: string;
      row_id: string | null;
      created_at: string;
      before_json: Record<string, unknown> | null;
      after_json: Record<string, unknown> | null;
    }[]
  ).map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    tableName: row.table_name,
    rowId: row.row_id,
    createdAt: row.created_at,
    beforeJson: row.before_json,
    afterJson: row.after_json,
  }));
}

export async function listAuditFor(
  tableName: string,
  rowId: string,
): Promise<AuditEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor, action, created_at, before_json, after_json")
    .eq("table_name", tableName)
    .eq("row_id", rowId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`não foi possível carregar a auditoria: ${error.message}`);

  return (
    data as {
      id: string;
      actor: string;
      action: AuditEvent["action"];
      created_at: string;
      before_json: Record<string, unknown> | null;
      after_json: Record<string, unknown> | null;
    }[]
  ).map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    createdAt: row.created_at,
    beforeJson: row.before_json,
    afterJson: row.after_json,
  }));
}

/** Which columns actually changed between two snapshots, ignoring bookkeeping noise. */
const IGNORED = new Set(["updated_at", "updated_by", "created_at", "created_by", "dedup_hash"]);

export function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { field: string; from: unknown; to: unknown }[] {
  if (!before || !after) return [];

  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: { field: string; from: unknown; to: unknown }[] = [];

  for (const field of fields) {
    if (IGNORED.has(field)) continue;
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    changes.push({ field, from: before[field], to: after[field] });
  }
  return changes;
}

/**
 * A field, rendered for a person.
 *
 * The log stores raw column values, so `amount` arrives as `"60000.00"` and a foreign key
 * as a uuid. Showing those verbatim would make the trail technically complete and
 * practically unreadable, which is the same as not having it.
 */
export function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";

  if (MONEY_FIELDS.has(field)) {
    try {
      return formatMoney(fromNumeric(String(value)));
    } catch {
      return String(value);
    }
  }

  if (typeof value === "boolean") return value ? "sim" : "não";

  // A uuid says nothing on its own; the row it points at is one click away in the UI.
  const text = String(value);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text)) return `${text.slice(0, 8)}…`;
  return text;
}

const MONEY_FIELDS = new Set([
  "amount",
  "opening_balance",
  "total_value",
  "monthly_value",
  "gross_amount",
  "net_amount",
  "amount_min",
  "amount_max",
]);

export const TABLE_LABEL: Record<string, string> = {
  cash_entries: "Lançamentos",
  recognition_entries: "Competência",
  contracts: "Contratos",
  categorization_rules: "Regras",
};

export const ACTION_LABEL: Record<string, string> = {
  insert: "criou",
  update: "editou",
  delete: "apagou",
};
