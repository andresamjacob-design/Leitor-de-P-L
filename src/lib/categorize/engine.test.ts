import { describe, expect, it } from "vitest";
import {
  matchPerson,
  matchRules,
  proposeRuleFrom,
  suggestCategory,
  type EngineInput,
} from "@/lib/categorize/engine";
import { parseMoney } from "@/lib/money";
import type { Rule, Subject } from "@/lib/categorize/types";

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    priority: 100,
    matchType: "contains",
    pattern: "uber",
    counterpartyTaxId: null,
    amountMin: null,
    amountMax: null,
    accountId: null,
    categoryId: "uber-cat",
    clientId: null,
    personId: null,
    active: true,
    hitCount: 0,
    ...overrides,
  };
}

function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    description: "Uber UBER *TRIP HELP.U",
    amount: parseMoney("55,52"),
    direction: "out",
    accountId: "card",
    counterpartyTaxId: null,
    counterpartyName: null,
    ...overrides,
  };
}

const EMPTY: EngineInput = { rules: [], history: [], people: [] };

describe("matchRules", () => {
  it("casa por trecho da descrição, ignorando caixa e acento dos dois lados", () => {
    expect(matchRules([rule({ pattern: "uber" })], subject())).toHaveLength(1);
    // O padrão também é normalizado: quem escreve "serviços" acha "SERVICOS".
    expect(matchRules([rule({ pattern: "serviços" })], subject({ description: "SERVICOS X" }))).toHaveLength(1);
    expect(matchRules([rule({ pattern: "netflix" })], subject())).toHaveLength(0);
  });

  it("casa exato só quando a descrição inteira bate", () => {
    const exact = rule({ matchType: "exact", pattern: "WIX*1217485431" });
    expect(matchRules([exact], subject({ description: "wix*1217485431" }))).toHaveLength(1);
    expect(matchRules([exact], subject({ description: "WIX*1217485431 EXTRA" }))).toHaveLength(0);
  });

  it("regex inválida não derruba o lote, só não casa", () => {
    const broken = rule({ matchType: "regex", pattern: "([" });
    expect(matchRules([broken], subject())).toHaveLength(0);
  });

  it("respeita faixa de valor", () => {
    const ranged = rule({ amountMin: parseMoney("100,00"), amountMax: parseMoney("200,00") });
    expect(matchRules([ranged], subject({ amount: parseMoney("150,00") }))).toHaveLength(1);
    expect(matchRules([ranged], subject({ amount: parseMoney("50,00") }))).toHaveLength(0);
  });

  it("regra presa a uma conta não vale para outra", () => {
    const scoped = rule({ accountId: "banco" });
    expect(matchRules([scoped], subject({ accountId: "card" }))).toHaveLength(0);
    expect(matchRules([scoped], subject({ accountId: "banco" }))).toHaveLength(1);
  });

  it("regra inativa nunca casa", () => {
    expect(matchRules([rule({ active: false })], subject())).toHaveLength(0);
  });

  it("ordena por prioridade, e desempata de forma estável", () => {
    const rules = [
      rule({ id: "b", priority: 50 }),
      rule({ id: "a", priority: 50 }),
      rule({ id: "c", priority: 10 }),
    ];
    expect(matchRules(rules, subject()).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("regra por CNPJ com padrão “*” casa por identidade, qualquer que seja a descrição", () => {
    const byTaxId = rule({
      pattern: "*",
      counterpartyTaxId: "50.050.390/0001-82",
      categoryId: "cliente",
    });
    expect(
      matchRules([byTaxId], subject({ description: "QUALQUER COISA", counterpartyTaxId: "50050390000182" })),
    ).toHaveLength(1);
    expect(matchRules([byTaxId], subject({ counterpartyTaxId: "99999999999999" }))).toHaveLength(0);
    expect(matchRules([byTaxId], subject({ counterpartyTaxId: null }))).toHaveLength(0);
  });
});

describe("suggestCategory", () => {
  it("sem nada para se apoiar, não inventa sugestão", () => {
    expect(suggestCategory(subject(), EMPTY)).toBeNull();
  });

  it("a regra por CNPJ ganha da regra por texto", () => {
    const suggestion = suggestCategory(subject({ counterpartyTaxId: "50050390000182" }), {
      ...EMPTY,
      rules: [
        rule({ id: "texto", priority: 1, categoryId: "por-texto" }),
        rule({ id: "cnpj", priority: 900, pattern: "*", counterpartyTaxId: "50050390000182", categoryId: "por-cnpj" }),
      ],
    });

    expect(suggestion).toMatchObject({ categoryId: "por-cnpj", source: "rule_tax_id", confidence: 1 });
  });

  it("a regra ganha do histórico — é assim que se corrige um erro (D40)", () => {
    const suggestion = suggestCategory(subject(), {
      ...EMPTY,
      rules: [rule({ categoryId: "certo" })],
      history: [
        {
          description: "Uber UBER *TRIP HELP.U",
          counterpartyTaxId: null,
          categoryId: "errado",
          clientId: null,
          personId: null,
          occurredOn: "2026-06-01",
        },
      ],
    });

    expect(suggestion?.categoryId).toBe("certo");
    expect(suggestion?.source).toBe("rule_text");
  });

  it("o CNPJ ganha do texto: Salesforce é cliente e fornecedor ao mesmo tempo", () => {
    const history = [
      {
        description: "SALESFORCE TECNOLOGIA",
        counterpartyTaxId: null,
        categoryId: "custo-ferramenta",
        clientId: null,
        personId: null,
        occurredOn: "2026-05-01",
      },
      {
        description: "RECEBIMENTOS SALESFORCE",
        counterpartyTaxId: "11222333000144",
        categoryId: "receita",
        clientId: "salesforce",
        personId: null,
        occurredOn: "2026-06-01",
      },
    ];

    const suggestion = suggestCategory(
      subject({ description: "SALESFORCE TECNOLOGIA", counterpartyTaxId: "11222333000144" }),
      { ...EMPTY, history },
    );

    expect(suggestion).toMatchObject({
      categoryId: "receita",
      clientId: "salesforce",
      source: "history_tax_id",
    });
  });

  it("reusa a categorização da mesma descrição quando não há CNPJ", () => {
    const suggestion = suggestCategory(subject(), {
      ...EMPTY,
      history: [
        {
          description: "uber uber *trip help.u",
          counterpartyTaxId: null,
          categoryId: "transporte",
          clientId: null,
          personId: null,
          occurredOn: "2026-06-01",
        },
      ],
    });

    expect(suggestion).toMatchObject({ categoryId: "transporte", source: "history_description" });
    expect(suggestion?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("entre duas categorizações da mesma descrição, vale a mais recente", () => {
    const suggestion = suggestCategory(subject(), {
      ...EMPTY,
      history: [
        { description: "Uber UBER *TRIP HELP.U", counterpartyTaxId: null, categoryId: "antiga", clientId: null, personId: null, occurredOn: "2026-01-01" },
        { description: "Uber UBER *TRIP HELP.U", counterpartyTaxId: null, categoryId: "nova", clientId: null, personId: null, occurredOn: "2026-07-01" },
      ],
    });
    expect(suggestion?.categoryId).toBe("nova");
  });

  it("reconhece salário pelo nome, com confiança baixa de propósito", () => {
    const suggestion = suggestCategory(
      subject({ description: "PIX ENVIADO GABRIEL SAMPAIO JACOB" }),
      {
        ...EMPTY,
        people: [{ id: "p1", name: "Gabriel Sampaio Jacob" }],
        payrollCategoryId: "salarios",
      },
    );

    expect(suggestion).toMatchObject({ categoryId: "salarios", personId: "p1", source: "person" });
    expect(suggestion?.confidence).toBeLessThan(0.8);
  });

  it("sem conta de salário configurada, o nome sozinho não sugere nada", () => {
    const suggestion = suggestCategory(subject({ description: "PIX GABRIEL SAMPAIO JACOB" }), {
      ...EMPTY,
      people: [{ id: "p1", name: "Gabriel Sampaio Jacob" }],
    });
    expect(suggestion).toBeNull();
  });
});

describe("matchPerson", () => {
  it("exige dois pedaços do nome — um sobrenome comum casaria com meio mundo", () => {
    const people = [{ id: "p1", name: "Maria da Silva Santos" }];
    expect(matchPerson(people, "PIX SILVA")).toBeNull();
    expect(matchPerson(people, "PIX MARIA SILVA")).toMatchObject({ id: "p1" });
  });

  it("ignora acento e caixa", () => {
    expect(matchPerson([{ id: "p1", name: "João Antônio" }], "pix joao antonio")).toMatchObject({
      id: "p1",
    });
  });

  it("escolhe quem casa mais pedaços do nome", () => {
    const people = [
      { id: "curto", name: "Ana Paula" },
      { id: "longo", name: "Ana Paula Ribeiro" },
    ];
    expect(matchPerson(people, "PIX ANA PAULA RIBEIRO")?.id).toBe("longo");
  });
});

describe("proposeRuleFrom", () => {
  it("com CNPJ, a regra é por identidade e ignora a descrição", () => {
    expect(
      proposeRuleFrom(subject({ description: "RECEBIMENTOS MARY KAY", counterpartyTaxId: "50.050.390/0001-82" })),
    ).toEqual({ matchType: "contains", pattern: "*", counterpartyTaxId: "50050390000182" });
  });

  it("sem CNPJ, tira do padrão o que muda todo mês", () => {
    // A referência muda todo mês; o separador que sobra no fim também não ajuda.
    expect(proposeRuleFrom(subject({ description: "WIX*1217485431" })).pattern).toBe("WIX");
    expect(proposeRuleFrom(subject({ description: "PIX RECEBIDO CICLO -06/01" })).pattern).toBe(
      "PIX RECEBIDO CICLO",
    );
  });

  it("uma descrição só de números não vira padrão vazio", () => {
    expect(proposeRuleFrom(subject({ description: "12345678" })).pattern).toBe("12345678");
  });
});
