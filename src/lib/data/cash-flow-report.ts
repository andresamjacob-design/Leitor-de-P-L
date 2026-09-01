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

import {
  buildCashFlow,
  periodRange,
  type CashFlowReport,
  type CashFlowRow,
  type FlowCategory,
} from "@/lib/cash-flow";
import { quebrarFaturas, type Fatura, type Pagamento } from "@/lib/card-bills";
import { listAccounts, type Account } from "@/lib/data/accounts";
import { listCategories, type Category } from "@/lib/data/categories";
import { listCashEntries } from "@/lib/data/cash-entries";
import { isCashAccount } from "@/lib/ledger-types";
import type { IsoDate } from "@/lib/dates";
import { sum, type Cents } from "@/lib/money";

/** `99.02` — Pagamento de fatura de cartão. O cartão fica fora do relatório (D-C). */
const CARD_BILL_CODE = "99.02";
/**
 * Pró-labore e distribuição de lucro, que no fluxo de caixa são **uma linha só** (D112).
 * A DRE tem de separá-las — uma é despesa e a outra não —, mas do lado do caixa as duas
 * são a mesma coisa: dinheiro que saiu do banco e foi para os sócios. É como a planilha
 * do Andre já lança, dentro do bloco `Pessoas`.
 */
const SOCIOS_CODES = ["6.11", "99.04"];
export const SOCIOS_LABEL = "Sócios — pró-labore e distribuição";

/**
 * Código de conta → grupo do fluxo, lido da coluna B da aba `Expenses` da
 * `Fluxo de Caixa - 2026.xlsx` do Andre, linha por linha. Isto não soma conta nenhuma —
 * é agrupamento visual, e o total de cada grupo é a soma das linhas que já existiam
 * (`groupCashFlowRows`, abaixo).
 *
 * Duas entradas não vêm direto da leitura da planilha:
 *
 *   - **`8.03` (Agência Ciclo) → `Pessoas`.** A aba `Colaboradores`, de onde a `Expenses`
 *     é gerada, não lista a Ciclo — mas medido contra a `Expenses`, pô-la dentro de
 *     `Pessoas` fecha o bloco em 6 dos 7 meses ao centavo. É decisão, não leitura direta.
 *   - **`9.03` (Alimentação) → `Cost of Goods/Cost of Services`, nunca `Travel`.** A
 *     planilha tem as duas linhas — `Alimentação` num grupo, `Travel Meals` no outro —,
 *     mas o razão tem uma conta só para as duas: confirmado pelo Andre em 25/08/2026,
 *     restaurante em viagem entra em `Alimentação` (D106). Só um grupo pode ficar com ela.
 *
 * `6.02`–`6.09` (Salários, Férias, 13º, Ticket, VT) nunca aparecem em `cash_entries` — o
 * pagamento de folha sai como um lote só, em `6.10` — mas entram aqui do mesmo jeito: se um
 * dia uma reclassificação manual usar um deles, a linha não deve cair fora de `Pessoas`.
 *
 * Um código que não aparece aqui não desaparece do relatório — vira "Sem grupo", visível
 * como qualquer outra linha, nunca escondido.
 */
export const GROUP_OF_CODE: Record<string, string> = {
  // Pessoas
  "6.02": "Pessoas",
  "6.03": "Pessoas",
  "6.04": "Pessoas",
  "6.08": "Pessoas",
  "6.09": "Pessoas",
  "6.10": "Pessoas",
  "6.11": "Pessoas",
  "8.03": "Pessoas",
  "99.04": "Pessoas",
  // Miscellaneous Cost of Service
  "6.12": "Miscellaneous Cost of Service",
  "11.01": "Miscellaneous Cost of Service",
  // Gerais e Admnistrativos
  "7.00": "Gerais e Admnistrativos",
  "7.01": "Gerais e Admnistrativos",
  "7.02": "Gerais e Admnistrativos",
  "7.03": "Gerais e Admnistrativos",
  "7.04": "Gerais e Admnistrativos",
  "7.05": "Gerais e Admnistrativos",
  "7.06": "Gerais e Admnistrativos",
  "7.07": "Gerais e Admnistrativos",
  "7.08": "Gerais e Admnistrativos",
  "7.09": "Gerais e Admnistrativos",
  "7.10": "Gerais e Admnistrativos",
  "7.11": "Gerais e Admnistrativos",
  "7.12": "Gerais e Admnistrativos",
  "7.13": "Gerais e Admnistrativos",
  "7.14": "Gerais e Admnistrativos",
  "7.15": "Gerais e Admnistrativos",
  "7.16": "Gerais e Admnistrativos",
  "7.17": "Gerais e Admnistrativos",
  "7.18": "Gerais e Admnistrativos",
  "7.19": "Gerais e Admnistrativos",
  "8.01": "Gerais e Admnistrativos",
  // Cost of Goods/Cost of Services
  "5.01": "Cost of Goods/Cost of Services",
  "7.20": "Cost of Goods/Cost of Services",
  "9.03": "Cost of Goods/Cost of Services",
  "9.04": "Cost of Goods/Cost of Services",
  "10.01": "Cost of Goods/Cost of Services",
  // Travel
  "9.01": "Travel",
  "9.02": "Travel",
  "9.05": "Travel",
  // Legal
  "8.02": "Legal",
  // Insurance
  "6.06": "Insurance",
  "6.07": "Insurance",
  // Other Expenses
  "10.02": "Other Expenses",
  "11.02": "Other Expenses",
  "11.03": "Other Expenses",
  // Imposto
  "4.01": "Imposto",
};

/** De cima para baixo, na mesma ordem da aba `Expenses`. */
const GROUP_SORT_ORDER: readonly string[] = [
  "Pessoas",
  "Miscellaneous Cost of Service",
  "Gerais e Admnistrativos",
  "Cost of Goods/Cost of Services",
  "Travel",
  "Legal",
  "Insurance",
  "Other Expenses",
  "Imposto",
];

export type CashFlowGroup = {
  label: string;
  rows: CashFlowRow[];
  totals: Cents[];
  total: Cents;
};

/**
 * Agrupa as linhas de uma seção como a aba `Expenses` do Andre agrupa as dela.
 *
 * Não soma conta nenhuma — os membros continuam sendo as mesmas linhas que
 * `buildCashFlow` já produziu, só reunidas visualmente; o total do grupo é a soma delas,
 * não um novo número. A linha de sócios (D112, `mergedRows`) não tem `code` — é
 * reconhecida pelo rótulo, porque já é ela mesma o resultado de uma soma anterior.
 */
export function groupCashFlowRows(
  rows: readonly CashFlowRow[],
  periodCount: number,
): { groups: CashFlowGroup[]; ungrouped: CashFlowRow[] } {
  const byGroup = new Map<string, CashFlowRow[]>();
  const ungrouped: CashFlowRow[] = [];

  for (const row of rows) {
    const label =
      row.label === SOCIOS_LABEL ? "Pessoas" : row.code ? GROUP_OF_CODE[row.code] : undefined;
    if (!label) {
      ungrouped.push(row);
      continue;
    }
    byGroup.set(label, [...(byGroup.get(label) ?? []), row]);
  }

  const groups = [...byGroup]
    .map(([label, groupRows]): CashFlowGroup => {
      const totals = Array.from({ length: periodCount }, (_, index) =>
        sum(groupRows.map((row) => row.values[index] as Cents)),
      );
      return { label, rows: groupRows, totals, total: sum(totals) };
    })
    .sort((a, b) => GROUP_SORT_ORDER.indexOf(a.label) - GROUP_SORT_ORDER.indexOf(b.label));

  return { groups, ungrouped };
}

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
  const [entries, cardEntries] = await Promise.all([
    listCashEntries({
      entityIds,
      to,
      accountIds: cashAccounts.map((account) => account.id),
      limit: 20000,
    }),
    // As compras do cartão não entram no relatório (D-C), mas são o conteúdo do pagamento
    // da fatura — é delas que sai a quebra (D116).
    listCashEntries({
      entityIds,
      to,
      accountIds: cardAccounts.map((account) => account.id),
      limit: 20000,
    }),
  ]);

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

  // ---- A quebra da fatura (D116) --------------------------------------------
  // Cada arquivo de fatura importado virou uma `statement_imports`, então **cada importação
  // é uma fatura**. O pagamento que tem exatamente o valor de uma delas é trocado pelas
  // compras dentro dela, na data do pagamento; o que não casa fica como estava.
  const billCategoryIds = new Set(
    categories.filter((category) => category.code === CARD_BILL_CODE).map((c) => c.id),
  );
  const porImport = new Map<string, Fatura["compras"][number][]>();
  for (const entry of cardEntries) {
    if (entry.importId === null) continue;
    porImport.set(entry.importId, [
      ...(porImport.get(entry.importId) ?? []),
      { categoryId: entry.categoryId, amount: entry.amount, direction: entry.direction },
    ]);
  }
  const faturas: Fatura[] = [...porImport].map(([importId, compras]) => ({ importId, compras }));
  const pagamentos: Pagamento[] = entries
    .filter((entry) => entry.categoryId !== null && billCategoryIds.has(entry.categoryId))
    .filter((entry) => entry.direction === "out")
    .map((entry) => ({
      id: entry.id,
      accountId: entry.accountId,
      occurredOn: entry.occurredOn,
      amount: entry.amount,
    }));
  const quebra = quebrarFaturas(pagamentos, faturas);

  const paraOFluxo = [
    ...entries
      .filter((entry) => !quebra.substituidos.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        occurredOn: entry.occurredOn,
        amount: entry.amount,
        direction: entry.direction,
        categoryId: entry.categoryId ? (categoryKey.get(entry.categoryId) ?? null) : null,
        // Só serve para casar pagamento com devolução — ver `refundedEntryIds`.
        counterpartyTaxId: entry.counterpartyTaxId ?? null,
      })),
    ...quebra.partes.map((parte) => ({
      id: parte.id,
      accountId: parte.accountId,
      occurredOn: parte.occurredOn,
      amount: parte.amount,
      direction: parte.direction,
      categoryId: parte.categoryId ? (categoryKey.get(parte.categoryId) ?? null) : null,
      // Uma parte não tem contraparte: ela é a soma de dezenas de compras.
      counterpartyTaxId: null,
      ...(parte.abatesSection === true ? { abatesSection: true } : {}),
    })),
  ];

  const report = buildCashFlow({
    periods: periodRange(from, to),
    accounts: cashAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      openingBalance: account.openingBalance,
      openingDate: account.openingDate,
    })),
    entries: paraOFluxo,
    categories: flowCategories,
    oneLeggedTransferCategoryIds,
    mergedRows,
  });

  return { report, cashAccounts, cardAccounts, categories, rowCategoryIds };
}
