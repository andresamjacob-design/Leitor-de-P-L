/**
 * Running the categorisation engine against the database.
 *
 * Two entry points: suggestions for the staged lines of an import, and a batch pass over
 * ledger entries that are still uncategorised. Both write only `category_id` — never an
 * amount, never a date, never anything a parser produced.
 */

import { createClient } from "@/lib/supabase/server";
import { suggestCategory, type EngineInput } from "@/lib/categorize/engine";
import type { Suggestion } from "@/lib/categorize/types";
import { countRuleHits, listPeople, listRules, loadHistory } from "@/lib/data/rules";
import { listCashEntries, updateCashEntry, type CashEntry } from "@/lib/data/cash-entries";
import { listCategories } from "@/lib/data/categories";
import { listStaged, type StagedTransaction } from "@/lib/data/imports";

/** Where a recognised person's salary lands, by chart-of-accounts code. */
const PAYROLL_CODE = "6.02";

export async function loadEngineInput(entityIds: string[]): Promise<EngineInput> {
  const [rules, history, people, categories] = await Promise.all([
    listRules(entityIds),
    loadHistory(entityIds),
    listPeople(entityIds),
    listCategories(entityIds),
  ]);

  const payroll = categories.find((category) => category.code === PAYROLL_CODE);
  return { rules, history, people, payrollCategoryId: payroll?.id ?? null };
}

export type SuggestionResult = {
  suggestions: Map<string, Suggestion>;
  /** How many lines the engine could not decide — the honest number to show (SPEC §14). */
  undecided: number;
};

/**
 * Suggests categories for everything still pending in an import, and stores them on the
 * staged rows so the review screen can show them with their reason.
 */
export async function suggestForImport(
  entityId: string,
  accountId: string,
  importId: string,
): Promise<SuggestionResult> {
  const input = await loadEngineInput([entityId]);
  const staged = (await listStaged(importId)).filter((row) => row.status === "pending");

  const suggestions = new Map<string, Suggestion>();
  for (const row of staged) {
    const suggestion = suggestCategory(subjectOfStaged(row, accountId), input);
    if (suggestion) suggestions.set(row.id, suggestion);
  }

  const supabase = await createClient();
  for (const [stagedId, suggestion] of suggestions) {
    await supabase
      .from("staged_transactions")
      .update({
        suggested_category_id: suggestion.categoryId,
        suggested_client_id: suggestion.clientId,
        suggested_person_id: suggestion.personId,
        suggestion_source: suggestion.ruleId ? "rule" : "none",
        confidence: suggestion.confidence.toFixed(3),
      })
      .eq("id", stagedId);
  }

  return { suggestions, undecided: staged.length - suggestions.size };
}

function subjectOfStaged(row: StagedTransaction, accountId: string) {
  return {
    description: row.description,
    amount: row.amount,
    direction: row.direction,
    accountId,
    counterpartyTaxId: row.counterpartyTaxId,
    counterpartyName: row.counterpartyName,
  };
}

function subjectOfEntry(entry: CashEntry) {
  return {
    description: entry.description,
    amount: entry.amount,
    direction: entry.direction,
    accountId: entry.accountId,
    counterpartyTaxId: entry.counterpartyTaxId,
    counterpartyName: entry.counterpartyName,
  };
}

export type BatchResult = {
  considered: number;
  categorized: number;
  undecided: number;
  bySource: Record<string, number>;
};

/**
 * Categorises ledger entries that have no category yet.
 *
 * Only entries with **no** category are touched: re-deciding something a person already
 * decided is exactly the behaviour that makes an automatic system untrustworthy. A wrong
 * category is fixed by editing the entry or writing a rule, never by a sweep.
 */
export async function categorizeUncategorized(
  entityId: string,
  userId: string,
  { minimumConfidence = 0.8 }: { minimumConfidence?: number } = {},
): Promise<BatchResult> {
  const [input, categories, entries] = await Promise.all([
    loadEngineInput([entityId]),
    listCategories([entityId], { includeInactive: true }),
    listCashEntries({ entityIds: [entityId], categoryId: "none", limit: 5000 }),
  ]);

  const hits = new Map<string, number>();
  const bySource: Record<string, number> = {};
  let categorized = 0;

  for (const entry of entries) {
    const suggestion = suggestCategory(subjectOfEntry(entry), input);
    if (!suggestion || suggestion.confidence < minimumConfidence) continue;

    try {
      // Through the ordinary write path, never straight to the column: giving a cost a
      // category is what creates its competência row (D2a), and a direct UPDATE would
      // leave the P&L blind to every expense this pass touched.
      await updateCashEntry(
        entityId,
        entry.id,
        {
          accountId: entry.accountId,
          occurredOn: entry.occurredOn,
          competencePeriod: entry.competencePeriod,
          amount: entry.amount,
          direction: entry.direction,
          description: entry.description,
          categoryId: suggestion.categoryId,
          clientId: suggestion.clientId ?? entry.clientId,
          personId: suggestion.personId ?? entry.personId,
          vendor: entry.vendor,
          isIntercompany: entry.isIntercompany,
          counterpartAccountId: null,
          allowDuplicate: true,
          importId: entry.importId,
          counterpartyName: entry.counterpartyName,
          counterpartyTaxId: entry.counterpartyTaxId,
        },
        categories,
        userId,
      );
    } catch {
      // One entry that refuses to save must not abort the pass; it stays uncategorised
      // and shows up in the count of what was left undecided.
      continue;
    }

    categorized += 1;
    bySource[suggestion.source] = (bySource[suggestion.source] ?? 0) + 1;
    if (suggestion.ruleId) hits.set(suggestion.ruleId, (hits.get(suggestion.ruleId) ?? 0) + 1);
  }

  await countRuleHits(hits);

  return {
    considered: entries.length,
    categorized,
    undecided: entries.length - categorized,
    bySource,
  };
}
