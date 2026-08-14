import { describe, expect, it } from "vitest";
import { detectRecurring, supplierKey, totalMonthly } from "@/lib/categorize/recurrence";
import { parseMoney } from "@/lib/money";
import type { RecurrenceCandidate } from "@/lib/categorize/recurrence";

let counter = 0;
function charge(description: string, occurredOn: string, amount: string): RecurrenceCandidate {
  counter += 1;
  return {
    id: `c${counter}`,
    description,
    occurredOn,
    amount: parseMoney(amount),
    categoryId: "ferramentas",
    accountId: "card",
  };
}

/** `count` monthly charges of the same value, starting at `from`. */
function monthly(description: string, amount: string, count: number, startMonth = 1) {
  return Array.from({ length: count }, (_, index) =>
    charge(description, `2026-${String(startMonth + index).padStart(2, "0")}-05`, amount),
  );
}

describe("supplierKey", () => {
  it("tira a referência que muda todo mês", () => {
    expect(supplierKey("WIX*1217485431")).toBe(supplierKey("WIX*1218609797"));
    expect(supplierKey("EBN*Canva04748 36")).toBe(supplierKey("EBN*Canva99999 12"));
  });

  it("fornecedores diferentes continuam diferentes", () => {
    expect(supplierKey("DL *GOOGLE Workspacedd")).not.toBe(supplierKey("SALESFORCE TECNOLOGIA"));
  });

  it("ignora acento e caixa", () => {
    expect(supplierKey("Serviços Contábeis")).toBe(supplierKey("SERVICOS CONTABEIS"));
  });
});

describe("detectRecurring", () => {
  it("acha uma assinatura mensal e calcula o custo anualizado", () => {
    const [found] = detectRecurring(monthly("WIX*1217485431", "30,00", 6));

    expect(found).toMatchObject({
      occurrences: 6,
      cadence: "mensal",
      typicalAmount: parseMoney("30,00"),
      monthlyCost: parseMoney("30,00"),
      annualCost: parseMoney("360,00"),
      firstCharge: "2026-01-05",
      lastCharge: "2026-06-05",
    });
  });

  it("duas cobranças não são assinatura", () => {
    expect(detectRecurring(monthly("WIX", "30,00", 2))).toHaveLength(0);
  });

  it("três já são", () => {
    expect(detectRecurring(monthly("WIX", "30,00", 3))).toHaveLength(1);
  });

  it("aguenta o dia da cobrança variar alguns dias", () => {
    const charges = [
      charge("SALESFORCE", "2026-01-05", "591,92"),
      charge("SALESFORCE", "2026-02-08", "591,92"),
      charge("SALESFORCE", "2026-03-03", "591,92"),
      charge("SALESFORCE", "2026-04-06", "591,92"),
    ];
    expect(detectRecurring(charges)[0]?.cadence).toBe("mensal");
  });

  it("aguenta reajuste de preço dentro da tolerância", () => {
    const charges = [
      charge("GOOGLE Workspace", "2026-01-05", "4.000,00"),
      charge("GOOGLE Workspace", "2026-02-05", "4.090,89"),
      charge("GOOGLE Workspace", "2026-03-05", "4.100,00"),
    ];
    expect(detectRecurring(charges)).toHaveLength(1);
  });

  it("uma compra grande no meio não vira parte da assinatura", () => {
    const charges = [
      ...monthly("MERCADO", "50,00", 4),
      charge("MERCADO", "2026-03-15", "5.000,00"),
    ];
    const [found] = detectRecurring(charges);
    expect(found?.occurrences).toBe(4);
    expect(found?.typicalAmount).toBe(parseMoney("50,00"));
  });

  it("compras esporádicas do mesmo lugar não são assinatura", () => {
    const charges = [
      charge("UBER TRIP", "2026-01-05", "30,00"),
      charge("UBER TRIP", "2026-01-06", "31,00"),
      charge("UBER TRIP", "2026-01-07", "29,00"),
      charge("UBER TRIP", "2026-01-09", "30,00"),
    ];
    expect(detectRecurring(charges)).toHaveLength(0);
  });

  it("reconhece cobrança anual e normaliza para o mês", () => {
    const charges = [
      charge("ADOBE ANUAL", "2024-03-10", "1.200,00"),
      charge("ADOBE ANUAL", "2025-03-12", "1.200,00"),
      charge("ADOBE ANUAL", "2026-03-09", "1.200,00"),
    ];
    const [found] = detectRecurring(charges);

    expect(found?.cadence).toBe("anual");
    expect(found?.annualCost).toBe(parseMoney("1.200,00"));
    expect(found?.monthlyCost).toBe(parseMoney("100,00"));
  });

  it("ordena da assinatura mais cara para a mais barata", () => {
    const found = detectRecurring([
      ...monthly("BARATA", "10,00", 4),
      ...monthly("CARA", "500,00", 4),
    ]);
    expect(found.map((item) => item.key.split(" ")[0])).toEqual(["CARA", "BARATA"]);
  });

  it("soma o custo mensal de tudo que assinou", () => {
    const found = detectRecurring([
      ...monthly("WIX", "30,00", 4),
      ...monthly("SLACK", "1.001,58", 4),
    ]);
    expect(totalMonthly(found)).toBe(parseMoney("1.031,58"));
  });
});
