/**
 * Reads of the second ledger. Fase 2 only writes the `cash_mirror` rows (D2a); the
 * contract-driven engine that fills the rest arrives in Fase 5.
 */

import { createClient } from "@/lib/supabase/server";
import { fromNumeric, type Cents } from "@/lib/money";
import type { Period } from "@/lib/dates";

export type RecognitionEntry = {
  id: string;
  period: Period;
  categoryId: string;
  kind: "revenue" | "cost";
  amount: Cents;
  source: "engine" | "manual" | "cash_mirror" | "accrual";
  cashEntryId: string | null;
  manuallyEdited: boolean;
};

type Row = {
  id: string;
  period: string;
  category_id: string;
  kind: "revenue" | "cost";
  amount: string;
  source: RecognitionEntry["source"];
  cash_entry_id: string | null;
  manually_edited: boolean;
};

const COLUMNS = "id, period, category_id, kind, amount, source, cash_entry_id, manually_edited";

function toEntry(row: Row): RecognitionEntry {
  return {
    id: row.id,
    period: row.period,
    categoryId: row.category_id,
    kind: row.kind,
    amount: fromNumeric(row.amount),
    source: row.source,
    cashEntryId: row.cash_entry_id,
    manuallyEdited: row.manually_edited,
  };
}

/** The competência rows a given cash entry produced. */
export async function listRecognitionForCashEntry(
  cashEntryId: string,
): Promise<RecognitionEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recognition_entries")
    .select(COLUMNS)
    .eq("cash_entry_id", cashEntryId)
    .order("period");

  if (error) throw new Error(`não foi possível carregar a competência: ${error.message}`);
  return (data as Row[]).map(toEntry);
}
