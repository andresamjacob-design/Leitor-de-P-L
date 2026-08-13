import { describe, expect, it } from "vitest";
import { competenceOf, hasCompetenceOverride, planCashMirror } from "@/lib/recognition/mirror";
import { parseMoney } from "@/lib/money";
import type { MirrorSubject } from "@/lib/recognition/mirror";

function subject(overrides: Partial<MirrorSubject> = {}): MirrorSubject {
  return {
    categoryId: "sal",
    categoryKind: "expense",
    direction: "out",
    occurredOn: "2026-02-05",
    competencePeriod: null,
    amount: parseMoney("60.000,00"),
    ...overrides,
  };
}

describe("planCashMirror", () => {
  it("espelha um custo no mês em que o dinheiro saiu", () => {
    expect(planCashMirror(subject())).toEqual({
      categoryId: "sal",
      period: "2026-02-01",
      kind: "cost",
      amount: parseMoney("60.000,00"),
    });
  });

  it("respeita o override de competência: salário de janeiro pago em fevereiro (D2b)", () => {
    const plan = planCashMirror(subject({ competencePeriod: "2026-01-01" }));
    expect(plan?.period).toBe("2026-01-01");
    expect(plan?.amount).toBe(parseMoney("60.000,00"));
  });

  it("salário de janeiro adiantado para dezembro também funciona (D14h)", () => {
    const plan = planCashMirror(
      subject({ occurredOn: "2025-12-20", competencePeriod: "2026-01-01" }),
    );
    expect(plan?.period).toBe("2026-01-01");
  });

  it("estorno numa categoria de despesa vira custo negativo, não some", () => {
    const plan = planCashMirror(subject({ direction: "in", amount: parseMoney("500,00") }));
    expect(plan?.amount).toBe(parseMoney("-500,00"));
  });

  it("imposto e custo direto também espelham", () => {
    expect(planCashMirror(subject({ categoryKind: "tax" }))?.kind).toBe("cost");
    expect(planCashMirror(subject({ categoryKind: "cost" }))?.kind).toBe("cost");
  });

  it("receita nunca espelha — ela vem do contrato, não do extrato (SPEC §5)", () => {
    expect(planCashMirror(subject({ categoryKind: "revenue", direction: "in" }))).toBeNull();
  });

  it("transferência e distribuição de lucros não espelham", () => {
    expect(planCashMirror(subject({ categoryKind: "transfer" }))).toBeNull();
    expect(planCashMirror(subject({ categoryKind: "owner_draw" }))).toBeNull();
  });

  it("sem categoria não há o que reconhecer", () => {
    expect(planCashMirror(subject({ categoryId: null, categoryKind: null }))).toBeNull();
  });

  it("valor zero não gera linha", () => {
    expect(planCashMirror(subject({ amount: 0n }))).toBeNull();
  });
});

describe("competenceOf", () => {
  it("cai no mês do pagamento quando não há override", () => {
    expect(competenceOf({ occurredOn: "2026-02-05", competencePeriod: null })).toBe(
      "2026-02-01",
    );
  });

  it("usa o override quando ele existe", () => {
    expect(competenceOf({ occurredOn: "2026-02-05", competencePeriod: "2026-01-01" })).toBe(
      "2026-01-01",
    );
  });
});

describe("hasCompetenceOverride", () => {
  it("um override igual ao mês do pagamento não conta como divergência", () => {
    expect(
      hasCompetenceOverride({ occurredOn: "2026-02-05", competencePeriod: "2026-02-01" }),
    ).toBe(false);
  });

  it("um override diferente conta", () => {
    expect(
      hasCompetenceOverride({ occurredOn: "2026-02-05", competencePeriod: "2026-01-01" }),
    ).toBe(true);
  });
});
