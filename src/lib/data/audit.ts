/**
 * The audit trail. Nothing in this system is ever locked (DECISIONS D-A) — this is what
 * makes that safe, and it is written by the database trigger in `0001_rls_and_audit.sql`,
 * not by the application. The app can only read it.
 *
 * The full log screen is Fase 8; Fase 2 shows the trail of a single row where the editing
 * actually happens.
 */

import { createClient } from "@/lib/supabase/server";

export type AuditEvent = {
  id: string;
  actor: string;
  action: "insert" | "update" | "delete";
  createdAt: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
};

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
