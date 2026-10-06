/**
 * The engine against the shapes the real files actually contain.
 *
 * The descriptions here are supplier strings off a card invoice — Uber, Wix, Google — and
 * carry nothing about a client. Anything that identifies a counterparty stays out of git;
 * `npm run verify:import` is where the engine meets the real files.
 */

import { describe, expect, it } from "vitest";
import { suggestCategory, type EngineInput } from "@/lib/categorize/engine";
import { detectRecurring } from "@/lib/categorize/recurrence";
import { parseMoney } from "@/lib/money";
import type { Rule, Subject } from "@/lib/categorize/types";

const CATEGORIES = {
  ferramentas: "cat-ferramentas",
  transporte: "cat-transporte",
  alimentacao: "cat-alimentacao",
  salarios: "cat-salarios",
  fatura: "cat-fatura",
};

function rule(pattern: string, categoryId: string, extra: Partial<Rule> = {}): Rule {
  return {
    id: `r-${pattern}`,
    priority: 100,
    matchType: "contains",
    pattern,
    counterpartyTaxId: null,
    direction: null,
    amountMin: null,
    amountMax: null,
    accountId: null,
    categoryId,
    clientId: null,
    personId: null,
    active: true,
    hitCount: 0,
    ...extra,
  };
}

function movement(description: string, amount: string): Subject {
  return {
    description,
    amount: parseMoney(amount),
    direction: "out",
    accountId: "card",
    counterpartyTaxId: null,
    counterpartyName: null,
  };
}

const INPUT: EngineInput = {
  rules: [
    rule("uber", CATEGORIES.transporte),
    rule("wix", CATEGORIES.ferramentas),
    rule("google workspace", CATEGORIES.ferramentas),
    rule("salesforce", CATEGORIES.ferramentas),
    rule("clicksign", CATEGORIES.ferramentas),
    rule("openai", CATEGORIES.ferramentas),
    // Presa à conta corrente: senão pegaria "Uber UBER *BUSINESS HE" na fatura.
    rule("business", CATEGORIES.fatura, { priority: 10, accountId: "banco" }),
  ],
  history: [],
  people: [{ id: "p-maria", name: "Maria Aparecida Souza" }],
  payrollCategoryId: CATEGORIES.salarios,
};

describe("descrições reais de fatura", () => {
  const cases: [string, string, string][] = [
    ["Uber UBER *TRIP HELP.U", "55,52", CATEGORIES.transporte],
    ["Uber UBER *BUSINESS HE", "10,39", CATEGORIES.transporte],
    ["WIX*1217485431", "30,00", CATEGORIES.ferramentas],
    ["WIX*1218609797", "30,00", CATEGORIES.ferramentas],
    ["DL *GOOGLE Workspacedd", "4.090,89", CATEGORIES.ferramentas],
    ["SALESFORCE TECNOLOGIA", "591,92", CATEGORIES.ferramentas],
    ["CLICKSIGN*Clicksign", "59,00", CATEGORIES.ferramentas],
    ["OPENAI *CHATGPT SUBSCR", "105,74", CATEGORIES.ferramentas],
  ];

  for (const [description, amount, expected] of cases) {
    it(`categoriza “${description}”`, () => {
      expect(suggestCategory(movement(description, amount), INPUT)?.categoryId).toBe(expected);
    });
  }

  it("prender a regra a uma conta é o que separa “BUSINESS” de “Uber BUSINESS”", () => {
    // Na conta corrente, `BUSINESS 7502-5632` é o débito da fatura do cartão.
    const naCorrente = suggestCategory(
      { ...movement("BUSINESS 7502-5632", "13.067,87"), accountId: "banco" },
      INPUT,
    );
    expect(naCorrente?.categoryId).toBe(CATEGORIES.fatura);

    // O mesmo texto dentro da fatura continua sendo corrida de Uber.
    const noCartao = suggestCategory(movement("Uber UBER *BUSINESS HE", "10,39"), INPUT);
    expect(noCartao?.categoryId).toBe(CATEGORIES.transporte);
  });

  it("o que o motor não conhece fica sem sugestão, e não com um chute", () => {
    expect(suggestCategory(movement("FIDELE CHURRASCARJA", "7,00"), INPUT)).toBeNull();
  });

  it("um PIX com nome de colaborador vira folha, mas sem pré-seleção", () => {
    const suggestion = suggestCategory(
      { ...movement("PIX ENVIADO MARIA APARECIDA SOUZA", "6.800,00"), direction: "out" },
      INPUT,
    );
    expect(suggestion?.categoryId).toBe(CATEGORIES.salarios);
    expect(suggestion?.confidence).toBeLessThan(0.8);
  });
});

describe("assinaturas reconstruídas de meses de fatura", () => {
  it("acha as recorrências e ignora a compra avulsa", () => {
    const charges = [
      // Wix, todo mês, com referência diferente a cada cobrança.
      ...[1, 2, 3, 4, 5].map((month) => ({
        id: `wix-${month}`,
        description: `WIX*12${month}0000000`,
        occurredOn: `2026-0${month}-05`,
        amount: parseMoney("30,00"),
        categoryId: CATEGORIES.ferramentas,
        accountId: "card",
      })),
      // Google, todo mês, com reajuste.
      ...[1, 2, 3, 4].map((month) => ({
        id: `google-${month}`,
        description: "DL *GOOGLE Workspacedd",
        occurredOn: `2026-0${month}-01`,
        amount: parseMoney(month > 2 ? "4.090,89" : "4.000,00"),
        categoryId: CATEGORIES.ferramentas,
        accountId: "card",
      })),
      // Uma passagem aérea. Não é assinatura.
      {
        id: "azul",
        description: "AZUL LINHAS JLU1TW",
        occurredOn: "2026-01-18",
        amount: parseMoney("157,00"),
        categoryId: null,
        accountId: "card",
      },
    ];

    const found = detectRecurring(charges);
    expect(found).toHaveLength(2);
    // Mediana de quatro cobranças: a menor das duas do meio, um valor que existiu.
    expect(found[0]?.monthlyCost).toBe(parseMoney("4.000,00"));
    expect(found[1]?.monthlyCost).toBe(parseMoney("30,00"));
    expect(found.some((item) => item.label.includes("AZUL"))).toBe(false);
  });
});
