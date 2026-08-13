import { describe, expect, it } from "vitest";
import { buildCashFlow, periodRange, type FlowCategory, type FlowEntry } from "@/lib/cash-flow";
import { parseMoney, sum } from "@/lib/money";

const CATEGORIES: FlowCategory[] = [
  { id: "rev", code: "3.01", name: "Receita — Suporte contínuo", kind: "revenue", sortOrder: 0 },
  { id: "sal", code: "6.02", name: "Salários", kind: "expense", sortOrder: 10 },
  { id: "tool", code: "7.01", name: "Google Workspace", kind: "expense", sortOrder: 20 },
  { id: "card", code: "99.02", name: "Pagamento de fatura", kind: "transfer", sortOrder: 90 },
  { id: "appl", code: "99.03", name: "Aplicação automática", kind: "transfer", sortOrder: 91 },
];

const BANK = {
  id: "bank",
  name: "Itaú — conta corrente",
  openingBalance: parseMoney("10.000,00"),
  openingDate: "2026-01-01",
};

let nextId = 0;
function entry(
  occurredOn: string,
  amount: string,
  direction: "in" | "out",
  categoryId: string | null,
  accountId = "bank",
): FlowEntry {
  nextId += 1;
  return {
    id: `e${nextId}`,
    accountId,
    occurredOn,
    amount: parseMoney(amount),
    direction,
    categoryId,
  };
}

function report(entries: FlowEntry[], from = "2026-01-01", to = "2026-03-31") {
  return buildCashFlow({
    periods: periodRange(from, to),
    accounts: [BANK],
    entries,
    categories: CATEGORIES,
  });
}

describe("buildCashFlow", () => {
  it("fecha um mês à mão: abertura + entradas − saídas", () => {
    const result = report(
      [
        entry("2026-01-10", "100.000,00", "in", "rev"),
        entry("2026-01-20", "60.000,00", "out", "sal"),
        entry("2026-01-25", "1.234,56", "out", "tool"),
      ],
      "2026-01-01",
      "2026-01-31",
    );

    const [inflow, outflow] = result.sections;
    expect(inflow?.totals[0]).toBe(parseMoney("100.000,00"));
    expect(outflow?.totals[0]).toBe(parseMoney("61.234,56"));

    expect(result.opening[0]).toBe(parseMoney("10.000,00"));
    expect(result.closing[0]).toBe(parseMoney("48.765,44"));
    // The identity the whole report rests on.
    expect(result.closing[0]).toBe(
      (result.opening[0] as bigint) +
        (inflow?.totals[0] as bigint) -
        (outflow?.totals[0] as bigint),
    );
  });

  it("carrega o saldo de um mês para o seguinte", () => {
    const result = report([
      entry("2026-01-10", "5.000,00", "in", "rev"),
      entry("2026-02-10", "2.000,00", "out", "sal"),
      entry("2026-03-10", "1.000,00", "in", "rev"),
    ]);

    expect(result.periods).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(result.opening[0]).toBe(parseMoney("10.000,00"));
    expect(result.closing[0]).toBe(parseMoney("15.000,00"));
    expect(result.opening[1]).toBe(result.closing[0]);
    expect(result.closing[1]).toBe(parseMoney("13.000,00"));
    expect(result.opening[2]).toBe(result.closing[1]);
    expect(result.closing[2]).toBe(parseMoney("14.000,00"));
  });

  it("lançamento anterior ao intervalo entra no saldo de abertura, não no relatório", () => {
    const result = report(
      [
        entry("2025-12-20", "7.000,00", "in", "rev"),
        entry("2026-01-05", "1.000,00", "in", "rev"),
      ],
      "2026-01-01",
      "2026-01-31",
    );

    expect(result.opening[0]).toBe(parseMoney("17.000,00"));
    expect(result.sections[0]?.totals[0]).toBe(parseMoney("1.000,00"));
  });

  it("transferência não soma em entrada nem em saída, mas move o saldo", () => {
    const result = report(
      [
        entry("2026-01-10", "10.000,00", "in", "rev"),
        entry("2026-01-15", "4.000,00", "out", "card"),
        entry("2026-01-16", "3.000,00", "out", "appl"),
        entry("2026-01-28", "3.000,00", "in", "appl"),
      ],
      "2026-01-01",
      "2026-01-31",
    );

    const [inflow, outflow, transfer] = result.sections;
    expect(inflow?.total).toBe(parseMoney("10.000,00"));
    expect(outflow?.total).toBe(0n);
    // −4.000 da fatura, −3.000 aplicados e +3.000 resgatados.
    expect(transfer?.total).toBe(parseMoney("-4.000,00"));

    expect(result.operating[0]).toBe(parseMoney("10.000,00"));
    expect(result.net[0]).toBe(parseMoney("6.000,00"));
    expect(result.closing[0]).toBe(parseMoney("16.000,00"));
  });

  it("compra no cartão não é caixa: a fatura de R$ 1.200 aparece uma vez só (D-C)", () => {
    // As três compras vivem na conta do cartão, que não entra no relatório de caixa.
    const purchases = [
      entry("2026-02-03", "500,00", "out", "tool", "card-account"),
      entry("2026-02-11", "400,00", "out", "tool", "card-account"),
      entry("2026-02-20", "300,00", "out", "tool", "card-account"),
    ];
    const payment = entry("2026-03-10", "1.200,00", "out", "card");

    const result = buildCashFlow({
      periods: periodRange("2026-02-01", "2026-03-31"),
      accounts: [BANK], // só a conta corrente
      entries: [...purchases, payment],
      categories: CATEGORIES,
    });

    const [inflow, outflow, transfer] = result.sections;
    expect(inflow?.total).toBe(0n);
    expect(outflow?.total).toBe(0n);
    expect(transfer?.total).toBe(parseMoney("-1.200,00"));
    // Fevereiro não teve caixa nenhum; março teve os R$ 1.200, e nunca R$ 2.400.
    expect(result.net[0]).toBe(0n);
    expect(result.net[1]).toBe(parseMoney("-1.200,00"));
    expect(result.warnings.some((text) => text.includes("fora do relatório"))).toBe(true);
  });

  it("lançamento sem categoria continua no relatório, numa linha própria", () => {
    const result = report(
      [entry("2026-01-10", "999,99", "out", null)],
      "2026-01-01",
      "2026-01-31",
    );

    const outflow = result.sections[1];
    expect(outflow?.rows).toHaveLength(1);
    expect(outflow?.rows[0]?.label).toBe("Sem categoria");
    expect(outflow?.rows[0]?.categoryId).toBeNull();
    expect(result.closing[0]).toBe(parseMoney("9.000,01"));
  });

  it("linhas saem na ordem do plano de contas e somam por categoria", () => {
    const result = report(
      [
        entry("2026-01-05", "10,00", "out", "tool"),
        entry("2026-01-06", "20,00", "out", "sal"),
        entry("2026-01-07", "30,00", "out", "tool"),
      ],
      "2026-01-01",
      "2026-01-31",
    );

    const outflow = result.sections[1];
    expect(outflow?.rows.map((row) => row.code)).toEqual(["6.02", "7.01"]);
    expect(outflow?.rows[1]?.total).toBe(parseMoney("40,00"));
  });

  it("mil lançamentos de R$ 0,01 dão exatamente R$ 10,00 (§11.8)", () => {
    const entries = Array.from({ length: 1000 }, (_, index) =>
      entry(`2026-01-${String((index % 28) + 1).padStart(2, "0")}`, "0,01", "in", "rev"),
    );
    const result = report(entries, "2026-01-01", "2026-01-31");

    expect(result.sections[0]?.total).toBe(1000n);
    expect(result.closing[0]).toBe(parseMoney("10.010,00"));
  });

  it("o total de uma linha é a soma dos meses dela", () => {
    const result = report([
      entry("2026-01-10", "1.000,00", "out", "sal"),
      entry("2026-02-10", "1.100,00", "out", "sal"),
      entry("2026-03-10", "1.200,00", "out", "sal"),
    ]);

    const row = result.sections[1]?.rows[0];
    expect(row?.total).toBe(sum(row?.values ?? []));
    expect(row?.total).toBe(parseMoney("3.300,00"));
  });

  it("avisa quando uma conta abre depois do início do relatório", () => {
    const result = buildCashFlow({
      periods: periodRange("2026-01-01", "2026-01-31"),
      accounts: [{ ...BANK, openingDate: "2026-06-01" }],
      entries: [],
      categories: CATEGORIES,
    });

    expect(result.warnings[0]).toContain("saldo de abertura");
  });

  it("intervalo vazio devolve um relatório vazio, não um erro", () => {
    const result = buildCashFlow({
      periods: [],
      accounts: [BANK],
      entries: [],
      categories: CATEGORIES,
    });

    expect(result.closing).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
