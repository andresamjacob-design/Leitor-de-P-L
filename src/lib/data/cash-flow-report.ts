/**
 * Assembles the cash flow report from the database and hands it to the pure builder in
 * `lib/cash-flow.ts`. Everything that needs deciding is decided here; everything that
 * needs testing is decided there.
 *
 * Two shaping decisions live in this file:
 *
 *   1. **Credit cards are left out.** They are not cash (D-C). They are returned
 *      separately so the screen can say so rather than silently omitting them.
 *   2. **Consolidated merges by code.** The same chart-of-accounts line exists once per
 *      entity, with a different id each time. Keying the consolidated report by `code`
 *      is what keeps "Salários" one row instead of two.
 */

import { buildCashFlow, periodRange, type CashFlowReport, type FlowCategory } from "@/lib/cash-flow";
import { listAccounts, type Account } from "@/lib/data/accounts";
import { listCategories, type Category } from "@/lib/data/categories";
import { listCashEntries } from "@/lib/data/cash-entries";
import { isCashAccount } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";

export type CashFlowView = {
  report: CashFlowReport;
  cashAccounts: Account[];
  cardAccounts: Account[];
  categories: Category[];
  /** Row id → the category ids it stands for, so a drill-down can filter by them. */
  rowCategoryIds: Map<string, string[]>;
};

export async function loadCashFlow({
  entityIds,
  from,
  to,
}: {
  entityIds: string[];
  from: IsoDate;
  to: IsoDate;
}): Promise<CashFlowView> {
  const [accounts, categories] = await Promise.all([
    listAccounts(entityIds, { includeInactive: true }),
    listCategories(entityIds, { includeInactive: true }),
  ]);

  const cashAccounts = accounts.filter((account) => isCashAccount(account.type));
  const cardAccounts = accounts.filter((account) => !isCashAccount(account.type));

  // Everything up to the end of the range: what came before sets the opening balance.
  const entries = await listCashEntries({
    entityIds,
    to,
    accountIds: cashAccounts.map((account) => account.id),
    limit: 20000,
  });

  const consolidated = entityIds.length > 1;
  const rowCategoryIds = new Map<string, string[]>();
  const flowCategories: FlowCategory[] = [];
  const categoryKey = new Map<string, string>();

  for (const category of categories) {
    const key = consolidated ? category.code : category.id;
    categoryKey.set(category.id, key);
    rowCategoryIds.set(key, [...(rowCategoryIds.get(key) ?? []), category.id]);

    if (!flowCategories.some((candidate) => candidate.id === key)) {
      flowCategories.push({
        id: key,
        code: category.code,
        name: category.name,
        kind: category.kind,
        sortOrder: category.sortOrder,
      });
    }
  }

  const report = buildCashFlow({
    periods: periodRange(from, to),
    accounts: cashAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      openingBalance: account.openingBalance,
      openingDate: account.openingDate,
    })),
    entries: entries.map((entry) => ({
      id: entry.id,
      accountId: entry.accountId,
      occurredOn: entry.occurredOn,
      amount: entry.amount,
      direction: entry.direction,
      categoryId: entry.categoryId ? (categoryKey.get(entry.categoryId) ?? null) : null,
      // Só serve para casar pagamento com devolução — ver `refundedEntryIds`.
      counterpartyTaxId: entry.counterpartyTaxId ?? null,
    })),
    categories: flowCategories,
  });

  return { report, cashAccounts, cardAccounts, categories, rowCategoryIds };
}
