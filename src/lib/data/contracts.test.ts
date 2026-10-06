import { describe, expect, it } from "vitest";
import { REVENUE_CODE, revenueAccountOf } from "@/lib/data/contracts";

describe("revenueAccountOf", () => {
  it("usa a conta do tipo quando o contrato não declara a sua", () => {
    expect(revenueAccountOf(null, "id-3.01")).toBe("id-3.01");
  });

  it("deixa o contrato mandar quando ele declara a conta", () => {
    // Referral e parceria: existem no plano de contas e o tipo não alcança nenhuma das
    // duas, porque `contract_type` tem dois valores e o plano tem quatro receitas.
    expect(revenueAccountOf("id-3.03", "id-3.01")).toBe("id-3.03");
  });

  it("não confunde conta vazia com conta ausente", () => {
    // A entidade cuja conta do tipo não existe recebe "", e `applyRecognition` recusa
    // gravar e explica. Um override vazio nunca é gravado — o form manda null.
    expect(revenueAccountOf(null, "")).toBe("");
    expect(revenueAccountOf("id-3.04", "")).toBe("id-3.04");
  });
});

describe("REVENUE_CODE", () => {
  it("cobre os dois tipos de contrato e só eles", () => {
    expect(REVENUE_CODE).toEqual({ retainer: "3.01", project: "3.02" });
  });
});
