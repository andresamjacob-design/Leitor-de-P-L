import { describe, expect, it } from "vitest";
import { judgeCostCredit, reverses } from "@/lib/recognition/cost-credits";
import type { CostCredit, Payment } from "@/lib/recognition/cost-credits";
import { parseMoney } from "@/lib/money";

function credit(overrides: Partial<CostCredit> = {}): CostCredit {
  return {
    accountType: "bank",
    categoryKind: "cost",
    direction: "in",
    occurredOn: "2026-01-09",
    amount: parseMoney("115.000,00"),
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    direction: "out",
    occurredOn: "2026-01-09",
    amount: parseMoney("115.000,00"),
    ...overrides,
  };
}

describe("judgeCostCredit", () => {
  it("deixa em paz o que não é crédito em conta de custo", () => {
    expect(judgeCostCredit(credit({ direction: "out" }), []).keep).toBe(true);
    expect(judgeCostCredit(credit({ categoryKind: "revenue" }), []).keep).toBe(true);
    expect(judgeCostCredit(credit({ categoryKind: null }), []).keep).toBe(true);
  });

  it("mantém estorno de cartão mesmo sem valor correspondente", () => {
    // Adobe devolveu R$ 11,43 de uma compra que não bate por valor; ninguém paga a
    // empresa na fatura do cartão dela, então só pode ser devolução de compra.
    const verdict = judgeCostCredit(
      credit({ accountType: "credit_card", amount: parseMoney("11,43") }),
      [],
    );
    expect(verdict).toEqual({ keep: true, reason: "estorno-de-cartao" });
  });

  it("mantém devolução bancária que tem o pagamento na mesma categoria", () => {
    // Inaldo: saiu R$ 1.000 e voltou R$ 1.000 no mesmo dia, ambos em 6.10.
    const verdict = judgeCostCredit(
      credit({ amount: parseMoney("1.000,00"), occurredOn: "2026-05-05" }),
      [payment({ amount: parseMoney("1.000,00"), occurredOn: "2026-05-05" })],
    );
    expect(verdict).toEqual({ keep: true, reason: "devolucao-casada" });
  });

  it("recusa a devolução do Ricardo: o PIX que saiu está dentro de um lote SISPAG", () => {
    // As saídas em 6.10 no período são as mensalidades dele, de outro valor.
    const mensalidades = [
      payment({ amount: parseMoney("12.472,00"), occurredOn: "2026-01-05" }),
      payment({ amount: parseMoney("2.000,00"), occurredOn: "2026-01-05" }),
      payment({ amount: parseMoney("1.300,00"), occurredOn: "2026-01-05" }),
    ];
    expect(judgeCostCredit(credit(), mensalidades)).toEqual({
      keep: false,
      reason: "sem-pagamento-correspondente",
    });
  });

  it("recusa recebimento de cliente arquivado em conta de custo", () => {
    // Hold Beauty paga a DD Group; a camada de identidade arquivou em 8.03 Agência,
    // que é o que a DD Group paga *a eles*. Receita virando despesa negativa.
    const verdict = judgeCostCredit(
      credit({ amount: parseMoney("17.200,00"), occurredOn: "2026-07-27" }),
      [payment({ amount: parseMoney("4.000,00"), occurredOn: "2026-03-02" })],
    );
    expect(verdict.keep).toBe(false);
  });
});

describe("reverses", () => {
  it("exige mesmo valor", () => {
    expect(reverses(credit(), payment({ amount: parseMoney("114.999,99") }))).toBe(false);
  });

  it("exige que seja uma saída", () => {
    expect(reverses(credit(), payment({ direction: "in" }))).toBe(false);
  });

  it("aceita o pagamento até 120 dias antes", () => {
    expect(reverses(credit(), payment({ occurredOn: "2025-09-11" }))).toBe(true);
    expect(reverses(credit(), payment({ occurredOn: "2025-09-10" }))).toBe(false);
  });

  it("aceita o pagamento até 30 dias depois, quando o crédito compensa antes do débito", () => {
    expect(reverses(credit(), payment({ occurredOn: "2026-02-08" }))).toBe(true);
    expect(reverses(credit(), payment({ occurredOn: "2026-02-09" }))).toBe(false);
  });
});
