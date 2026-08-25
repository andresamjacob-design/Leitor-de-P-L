/**
 * The cash flow report (regime de caixa). A pure function: entries in, matrix out.
 *
 * It reads `cash_entries` and nothing else. It never touches `recognition_entries` —
 * the two ledgers are separate and are not meant to tie out month to month (SPEC §5).
 *
 * Three things this file gets right on purpose:
 *
 *   1. **Only cash accounts.** A credit card purchase is not cash. The card bill is.
 *      Mixing them double-counts every expense (DECISIONS D-C).
 *   2. **Transfers stand alone.** Moving money between your own accounts is neither
 *      income nor spending, so it gets its own section — but it still moves the balance,
 *      so it still lands in the closing figure (D14b).
 *   3. **Every cent is a `bigint`.** No float ever touches a total.
 */

import type { Cents } from "@/lib/money";
import { sum } from "@/lib/money";
import { compareDates, eachPeriod, periodOf, type IsoDate, type Period } from "@/lib/dates";
import type { CategoryKind, EntryDirection } from "@/lib/ledger-types";

export type FlowAccount = {
  id: string;
  name: string;
  openingBalance: Cents;
  openingDate: IsoDate;
};

export type FlowCategory = {
  id: string;
  code: string;
  name: string;
  kind: CategoryKind;
  sortOrder: number;
};

export type FlowEntry = {
  id: string;
  accountId: string;
  occurredOn: IsoDate;
  /** Magnitude, never negative — the sign lives in `direction` (see the CHECK in 0001). */
  amount: Cents;
  direction: EntryDirection;
  categoryId: string | null;
  /** Só para casar pagamento com devolução; a identidade é o que torna o par confiável. */
  counterpartyTaxId?: string | null;
};

export type CashFlowSectionKey = "in" | "out" | "transfer";

export type CashFlowRow = {
  categoryId: string | null;
  code: string | null;
  label: string;
  /** One value per reported period, in the same order as `periods`. */
  values: Cents[];
  total: Cents;
};

export type CashFlowSection = {
  key: CashFlowSectionKey;
  label: string;
  rows: CashFlowRow[];
  totals: Cents[];
  total: Cents;
};

export type CashFlowReport = {
  periods: Period[];
  /** Balance at the first instant of each period. `opening[i+1] === closing[i]`. */
  opening: Cents[];
  sections: CashFlowSection[];
  /** entradas − saídas, ignoring transfers. What the operation actually generated. */
  operating: Cents[];
  /** entradas − saídas + transferências líquidas. What actually moved the balance. */
  net: Cents[];
  closing: Cents[];
  /** Things the reader has to know to trust the numbers (SPEC §14). */
  warnings: string[];
};

const UNCATEGORISED = "Sem categoria";

const SECTION_LABEL: Record<CashFlowSectionKey, string> = {
  in: "Entradas",
  out: "Saídas",
  transfer: "Transferências",
};

function zeros(length: number): Cents[] {
  return Array.from({ length }, () => 0n);
}

/** Every month from `from` to `to`, inclusive. Both are `YYYY-MM-DD`. */
export function periodRange(from: IsoDate, to: IsoDate): Period[] {
  return eachPeriod(from, to);
}

/**
 * Which section an entry belongs to.
 *
 * A transfer is a transfer whichever way it points. Everything else follows its
 * direction, including an uncategorised entry — money that moved is money that moved,
 * and hiding it until someone categorises it would make the balance wrong.
 *
 * `oneLegged` is the exception, and it exists because **uma transferência só é
 * transferência quando as duas pernas estão no relatório** (D108). A aplicação no CDB
 * tem as duas — conta de aplicação é conta de caixa —, então ela se cancela e mostrar as
 * duas pernas seria inflar as colunas. O pagamento da fatura tem uma só, porque o cartão
 * fica fora deste relatório de propósito (D-C): daquele lado o dinheiro sai do banco e
 * não volta, que é o critério da D107.
 */
function sectionOf(
  entry: FlowEntry,
  categories: Map<string, FlowCategory>,
  oneLegged: ReadonlySet<string>,
): CashFlowSectionKey {
  const kind = entry.categoryId ? categories.get(entry.categoryId)?.kind : undefined;
  if (kind === "transfer" && !(entry.categoryId && oneLegged.has(entry.categoryId))) {
    return "transfer";
  }
  return entry.direction;
}

/** Signed contribution to the account balance. */
function signed(entry: FlowEntry): Cents {
  return entry.direction === "in" ? entry.amount : -entry.amount;
}

/** Quanto tempo depois do pagamento uma devolução ainda é daquele pagamento. */
const REFUND_WINDOW_DAYS = 90;

/**
 * Dias entre duas datas `YYYY-MM-DD`, sem `Date` — data aqui é string (regra do projeto), e
 * converter para `Date` é como fuso horário entra e move um lançamento de mês.
 */
function daysApart(from: IsoDate, to: IsoDate): number {
  return Math.abs(Math.round((Date.UTC(
    Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)),
  ) - Date.UTC(
    Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)),
  )) / 86_400_000));
}

/**
 * Pagamentos que voltaram, e as devoluções que os desfizeram.
 *
 * Decisão do Andre em 25/08/2026: **o fluxo mostra o que saiu da conta e não voltou.** Um
 * pagamento estornado não é gasto, e a devolução dele não é entrada — juntos, os dois são
 * dinheiro que deu meia-volta, e mostrá-los infla as duas colunas sem mudar saldo nenhum.
 * Era o caso dos R$ 115.000 e R$ 50.000 do Ricardo, que sozinhos respondiam por quase toda
 * a diferença entre esta tela e a planilha em janeiro e fevereiro.
 *
 * O par exige **identidade, valor e categoria iguais**, e essa terceira condição não é
 * zelo: é a regra que a D83 já tinha escrito — *é devolução só se o pagamento que ela
 * reverte estiver na mesma categoria*. Sem ela, uma contraparte que está dos dois lados do
 * balcão anularia um recebimento contra um pagamento legítimo, que é exatamente o defeito
 * da D82 e da D99 voltando por uma terceira porta.
 *
 * O casamento é **um para um** e pela devolução mais próxima, porque foi assim que o caso
 * real se apresentou: o Ricardo recebeu **dois** pagamentos de R$ 115.000 e devolveu **um**.
 * Anular os dois esconderia um gasto verdadeiro; anular um deixa de pé exatamente o que a
 * empresa pagou e não recuperou.
 *
 * Devolver os ids em vez de somar mantém isto testável e deixa o saldo intacto: as duas
 * pernas se cancelam, então tirar as duas do relatório não move o fechamento um centavo.
 */
export function refundedEntryIds(entries: readonly FlowEntry[]): Set<string> {
  const dropped = new Set<string>();

  const key = (entry: FlowEntry) =>
    [
      (entry.counterpartyTaxId ?? "").replace(/\D/g, ""),
      entry.amount.toString(),
      entry.categoryId ?? "",
    ].join("|");

  const refundsByKey = new Map<string, FlowEntry[]>();
  for (const entry of entries) {
    if (entry.direction !== "in") continue;
    if (!entry.counterpartyTaxId) continue;
    const list = refundsByKey.get(key(entry)) ?? [];
    list.push(entry);
    refundsByKey.set(key(entry), list);
  }
  for (const list of refundsByKey.values()) {
    list.sort((a, b) => compareDates(a.occurredOn, b.occurredOn));
  }

  const payments = entries
    .filter((entry) => entry.direction === "out" && entry.counterpartyTaxId)
    .sort((a, b) => compareDates(a.occurredOn, b.occurredOn));

  for (const payment of payments) {
    const candidates = refundsByKey.get(key(payment));
    if (!candidates) continue;

    const refund = candidates.find(
      (candidate) =>
        !dropped.has(candidate.id) &&
        compareDates(candidate.occurredOn, payment.occurredOn) >= 0 &&
        daysApart(payment.occurredOn, candidate.occurredOn) <= REFUND_WINDOW_DAYS,
    );
    if (!refund) continue;

    dropped.add(payment.id);
    dropped.add(refund.id);
  }

  return dropped;
}

export type BuildCashFlowInput = {
  periods: Period[];
  /** Only cash-bearing accounts. The caller filters out credit cards. */
  accounts: readonly FlowAccount[];
  /** Every entry of those accounts, including ones before the range — they set the opening. */
  entries: readonly FlowEntry[];
  categories: readonly FlowCategory[];
  /**
   * Contas de transferência cuja contrapartida **não** está neste relatório, e que por
   * isso contam como entrada ou saída de verdade (D108). Quem decide é o carregador, que
   * é quem sabe quais contas ficaram de fora; vazio por omissão, para que o
   * comportamento antigo continue sendo o padrão.
   */
  oneLeggedTransferCategoryIds?: ReadonlySet<string>;
};

export function buildCashFlow({
  periods,
  accounts,
  entries,
  categories,
  oneLeggedTransferCategoryIds = new Set<string>(),
}: BuildCashFlowInput): CashFlowReport {
  if (periods.length === 0) {
    return {
      periods: [],
      opening: [],
      sections: [],
      operating: [],
      net: [],
      closing: [],
      warnings: ["Nenhum mês selecionado."],
    };
  }

  const warnings: string[] = [];
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountIds = new Set(accounts.map((account) => account.id));
  const rangeStart = periods[0] as Period;
  const indexOfPeriod = new Map(periods.map((period, index) => [period, index]));

  // ---- Opening balance ----------------------------------------------------
  // An account's opening balance is money that was already there before the first
  // reported month. If the account claims to open inside the range, saying so is the
  // only honest option — inventing a placement for it would corrupt a month (SPEC §14).
  let opening = 0n;
  for (const account of accounts) {
    opening += account.openingBalance;
    if (compareDates(account.openingDate, rangeStart) > 0) {
      warnings.push(
        `A conta "${account.name}" tem saldo de abertura em ${account.openingDate}, ` +
          `depois do início do relatório — o saldo inicial abaixo o considera como se ` +
          `já existisse no primeiro mês.`,
      );
    }
  }

  const cashEntries = entries.filter((entry) => accountIds.has(entry.accountId));
  if (cashEntries.length !== entries.length) {
    warnings.push(
      "Alguns lançamentos são de contas fora do relatório e foram ignorados.",
    );
  }

  for (const entry of cashEntries) {
    if (compareDates(entry.occurredOn, rangeStart) < 0) opening += signed(entry);
  }

  // ---- Rows ---------------------------------------------------------------
  const buckets = new Map<CashFlowSectionKey, Map<string, Cents[]>>([
    ["in", new Map()],
    ["out", new Map()],
    ["transfer", new Map()],
  ]);

  // O que saiu e voltou não é gasto nem entrada. As duas pernas se cancelam, então tirar as
  // duas daqui não move saldo nenhum — só para de inflar as duas colunas.
  const refunded = refundedEntryIds(cashEntries);
  if (refunded.size > 0) {
    warnings.push(
      `${refunded.size / 2} pagamento(s) devolvido(s) não aparecem em entradas nem em ` +
        `saídas — o fluxo mostra o que saiu da conta e não voltou. O saldo já os considera.`,
    );
  }

  const oneLeggedSeen = new Set<string>();

  for (const entry of cashEntries) {
    if (refunded.has(entry.id)) continue;

    const index = indexOfPeriod.get(periodOf(entry.occurredOn));
    if (index === undefined) continue; // before the range (already in opening) or after it

    const section = sectionOf(entry, categoryById, oneLeggedTransferCategoryIds);
    if (entry.categoryId && oneLeggedTransferCategoryIds.has(entry.categoryId)) {
      oneLeggedSeen.add(entry.categoryId);
    }
    const key = entry.categoryId ?? "";
    const rows = buckets.get(section) as Map<string, Cents[]>;
    const values = rows.get(key) ?? zeros(periods.length);
    // A transfer row keeps its own sign so an inflow and an outflow can cancel out;
    // the in/out sections are magnitudes, because their sign is the section itself.
    values[index] =
      (values[index] as Cents) + (section === "transfer" ? signed(entry) : entry.amount);
    rows.set(key, values);
  }

  if (oneLeggedSeen.size > 0) {
    const nomes = [...oneLeggedSeen]
      .map((id) => categoryById.get(id)?.name ?? id)
      .sort()
      .join(", ");
    warnings.push(
      `${nomes} aparece como saída, e não como transferência: a conta de destino está ` +
        `fora deste relatório, então daqui o dinheiro sai e não volta. Na DRE o custo ` +
        `continua sendo a compra, não a fatura — o gasto não é contado duas vezes.`,
    );
  }

  const sections: CashFlowSection[] = (["in", "out", "transfer"] as const).map((key) => {
    const rows = [...(buckets.get(key) as Map<string, Cents[]>)]
      .map(([categoryId, values]) => {
        const category = categoryId ? categoryById.get(categoryId) : undefined;
        return {
          categoryId: categoryId === "" ? null : categoryId,
          code: category?.code ?? null,
          label: category ? category.name : UNCATEGORISED,
          sortOrder: category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
          values,
          total: sum(values),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "pt-BR"))
      .map((row): CashFlowRow => ({
        categoryId: row.categoryId,
        code: row.code,
        label: row.label,
        values: row.values,
        total: row.total,
      }));

    const totals = periods.map((_, index) =>
      sum(rows.map((row) => row.values[index] as Cents)),
    );

    return { key, label: SECTION_LABEL[key], rows, totals, total: sum(totals) };
  });

  // ---- Balances -----------------------------------------------------------
  const [inflow, outflow, transfers] = sections as [
    CashFlowSection,
    CashFlowSection,
    CashFlowSection,
  ];

  const operating = periods.map(
    (_, index) => (inflow.totals[index] as Cents) - (outflow.totals[index] as Cents),
  );
  const net = periods.map(
    (_, index) => (operating[index] as Cents) + (transfers.totals[index] as Cents),
  );

  const openings: Cents[] = [];
  const closings: Cents[] = [];
  let running = opening;
  for (const [index] of periods.entries()) {
    openings.push(running);
    running += net[index] as Cents;
    closings.push(running);
  }

  return {
    periods,
    opening: openings,
    sections,
    operating,
    net,
    closing: closings,
    warnings,
  };
}
