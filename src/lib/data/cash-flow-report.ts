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
 *
 * A primeira decisão tem uma consequência que ficou implícita por muito tempo e agora é
 * explícita (D108): tirar o cartão do relatório deixa o **pagamento da fatura** com uma
 * perna só. Aplicar no CDB tem as duas — conta de aplicação é conta de caixa —, então
 * continua sendo transferência e se cancela. A fatura, não: aqui o dinheiro sai do banco
 * e não volta.
 */

import { buildCashFlow, periodRange, type CashFlowReport, type FlowCategory } from "@/lib/cash-flow";
import { listAccounts, type Account } from "@/lib/data/accounts";
import { listCategories, type Category } from "@/lib/data/categories";
import { listCashEntries } from "@/lib/data/cash-entries";
import { isCashAccount } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";

/** `99.02` — Pagamento de fatura de cartão. O cartão fica fora do relatório (D-C). */
const CARD_BILL_CODE = "99.02";
/**
 * Pró-labore e distribuição de lucro, que no fluxo de caixa são **uma linha só** (D112).
 * A DRE tem de separá-las — uma é despesa e a outra não —, mas do lado do caixa as duas
 * são a mesma coisa: dinheiro que saiu do banco e foi para os sócios. É como a planilha
 * do Andre já lança, dentro do bloco `Pessoas`.
 */
const SOCIOS_CODES = ["6.11", "99.04"];
const SOCIOS_LABEL = "Sócios — pró-labore e distribuição";

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

  // As contas de transferência cuja contrapartida ficou de fora do relatório (D108). O
  // código é o critério porque é ele que diz **para onde** o dinheiro foi: `99.02` é o
  // pagamento da fatura, e o cartão é justamente o que `cashAccounts` acabou de excluir.
  const oneLeggedTransferCategoryIds = new Set(
    categories
      .filter((category) => category.code === CARD_BILL_CODE)
      .map((category) => categoryKey.get(category.id) ?? category.id),
  );

  const sociosIds = new Set(
    categories
      .filter((category) => SOCIOS_CODES.includes(category.code))
      .map((category) => categoryKey.get(category.id) ?? category.id),
  );
  // Uma linha de grupo com um membro só não é grupo — é a conta com o nome trocado. Se
  // uma das duas não existir na entidade, o agrupamento não se aplica.
  const mergedRows =
    sociosIds.size === SOCIOS_CODES.length
      ? [{ label: SOCIOS_LABEL, categoryIds: sociosIds }]
      : [];

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
    oneLeggedTransferCategoryIds,
    mergedRows,
  });

  return { report, cashAccounts, cardAccounts, categories, rowCategoryIds };
}
