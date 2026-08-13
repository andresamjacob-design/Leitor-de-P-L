/**
 * The scenarios the SPEC actually argues about, run through both ledgers at once.
 *
 * These are not unit tests of a function — they take a set of cash entries, push them
 * through `planCashMirror` to get the competência side and through `buildCashFlow` to get
 * the cash side, and assert on both. That is the only way to catch the failure the whole
 * design exists to prevent: the same expense counted twice, once when it was bought and
 * again when it was paid.
 */

import { describe, expect, it } from "vitest";
import { buildCashFlow, periodRange, type FlowCategory, type FlowEntry } from "@/lib/cash-flow";
import { planCashMirror } from "@/lib/recognition/mirror";
import { formatMoney, parseMoney, sum, type Cents } from "@/lib/money";
import { periodOf, type Period } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";

const CATEGORIES: FlowCategory[] = [
  { id: "rev", code: "3.01", name: "Receita", kind: "revenue", sortOrder: 0 },
  { id: "sal", code: "6.02", name: "Salários", kind: "expense", sortOrder: 10 },
  { id: "tool", code: "7.01", name: "Ferramentas", kind: "expense", sortOrder: 20 },
  { id: "bill", code: "99.02", name: "Pagamento de fatura", kind: "transfer", sortOrder: 90 },
];

const BANK = {
  id: "bank",
  name: "Itaú",
  openingBalance: parseMoney("100.000,00"),
  openingDate: "2026-01-01",
};
const CARD = "card";

type Entry = FlowEntry & { competencePeriod: Period | null };

let seq = 0;
function entry(
  accountId: string,
  occurredOn: string,
  amount: string,
  direction: EntryDirection,
  categoryId: string,
  competencePeriod: Period | null = null,
): Entry {
  seq += 1;
  return {
    id: `e${seq}`,
    accountId,
    occurredOn,
    amount: parseMoney(amount),
    direction,
    categoryId,
    competencePeriod,
  };
}

/** The competência ledger these entries would produce, month by month. */
function recognitionByPeriod(entries: Entry[]): Map<Period, Cents> {
  const totals = new Map<Period, Cents>();

  for (const item of entries) {
    const category = CATEGORIES.find((candidate) => candidate.id === item.categoryId);
    const plan = planCashMirror({
      categoryId: item.categoryId,
      categoryKind: category?.kind ?? null,
      direction: item.direction,
      occurredOn: item.occurredOn,
      competencePeriod: item.competencePeriod,
      amount: item.amount,
    });
    if (!plan) continue;
    totals.set(plan.period, (totals.get(plan.period) ?? 0n) + plan.amount);
  }

  return totals;
}

function cashFlow(entries: Entry[], from: string, to: string) {
  return buildCashFlow({
    periods: periodRange(from, to),
    accounts: [BANK],
    entries,
    categories: CATEGORIES,
  });
}

describe("cartão de crédito (§11 teste 4, reescrito pela D-C)", () => {
  // Três compras de fevereiro somando R$ 1.200 e a fatura debitada em 10/03.
  const entries = [
    entry(CARD, "2026-02-03", "500,00", "out", "tool"),
    entry(CARD, "2026-02-11", "400,00", "out", "tool"),
    entry(CARD, "2026-02-20", "300,00", "out", "tool"),
    entry("bank", "2026-03-10", "1.200,00", "out", "bill"),
  ];

  const recognition = recognitionByPeriod(entries);
  const flow = cashFlow(entries, "2026-02-01", "2026-03-31");

  it("o DRE vê os R$ 1.200 em fevereiro, quando as compras aconteceram", () => {
    expect(recognition.get("2026-02-01")).toBe(parseMoney("1.200,00"));
  });

  it("o DRE de março é zero — pagar a fatura não é uma despesa nova", () => {
    expect(recognition.get("2026-03-01") ?? 0n).toBe(0n);
  });

  it("o caixa de fevereiro é zero — nada saiu do banco", () => {
    expect(flow.net[0]).toBe(0n);
  });

  it("o caixa de março perde os R$ 1.200 do débito da fatura", () => {
    expect(flow.net[1]).toBe(parseMoney("-1.200,00"));
    expect(flow.closing[1]).toBe(parseMoney("98.800,00"));
  });

  it("a despesa total é R$ 1.200 nos dois razões, nunca R$ 2.400", () => {
    const totalRecognised = sum([...recognition.values()]);
    const totalCash = (flow.sections[1]?.total as Cents) - (flow.sections[2]?.total as Cents);

    expect(formatMoney(totalRecognised)).toBe("1.200,00");
    expect(formatMoney(totalCash)).toBe("1.200,00");
  });
});

describe("salário de janeiro pago em fevereiro (D2b, D14h)", () => {
  const entries = [entry("bank", "2026-02-05", "60.000,00", "out", "sal", "2026-01-01")];
  const recognition = recognitionByPeriod(entries);
  const flow = cashFlow(entries, "2026-01-01", "2026-02-28");

  it("o DRE lança em janeiro, a competência do trabalho", () => {
    expect(recognition.get("2026-01-01")).toBe(parseMoney("60.000,00"));
    expect(recognition.get("2026-02-01") ?? 0n).toBe(0n);
  });

  it("o caixa lança em fevereiro, quando o dinheiro saiu", () => {
    expect(flow.net[0]).toBe(0n);
    expect(flow.net[1]).toBe(parseMoney("-60.000,00"));
  });

  it("os dois razões não fecham no mês — e é assim que tem que ser (SPEC §5)", () => {
    const januaryCash = flow.net[0] as Cents;
    const januaryRecognised = -(recognition.get("2026-01-01") as Cents);
    expect(januaryCash).not.toBe(januaryRecognised);
  });
});

describe("salário de janeiro adiantado para dezembro", () => {
  it("sai do caixa em dezembro e do DRE em janeiro", () => {
    const entries = [entry("bank", "2025-12-19", "60.000,00", "out", "sal", "2026-01-01")];

    expect(recognitionByPeriod(entries).get("2026-01-01")).toBe(parseMoney("60.000,00"));

    // Em janeiro o caixa não vê nada: o dinheiro saiu no ano anterior, e por isso o
    // pagamento entra no saldo de abertura, não num mês do relatório.
    const flow = cashFlow(entries, "2026-01-01", "2026-01-31");
    expect(flow.net[0]).toBe(0n);
    expect(flow.opening[0]).toBe(parseMoney("40.000,00"));
  });
});

describe("receita recebida não vira competência sozinha (SPEC §5)", () => {
  it("o dinheiro entra no caixa e o DRE fica vazio até o contrato existir", () => {
    const entries = [entry("bank", "2026-01-15", "398.891,56", "in", "rev")];

    expect(recognitionByPeriod(entries).size).toBe(0);

    const flow = cashFlow(entries, "2026-01-01", "2026-01-31");
    expect(flow.sections[0]?.total).toBe(parseMoney("398.891,56"));
  });
});

describe("transferência entre contas próprias", () => {
  it("não é receita nem despesa, e o par se anula no saldo consolidado das contas", () => {
    const out = entry("bank", "2026-04-10", "50.000,00", "out", "bill");
    const back = entry("bank", "2026-04-20", "50.000,00", "in", "bill");
    const flow = cashFlow([out, back], "2026-04-01", "2026-04-30");

    expect(flow.sections[0]?.total).toBe(0n);
    expect(flow.sections[1]?.total).toBe(0n);
    expect(flow.sections[2]?.total).toBe(0n);
    expect(flow.closing[0]).toBe(flow.opening[0]);
    expect(periodOf(out.occurredOn)).toBe("2026-04-01");
  });
});
