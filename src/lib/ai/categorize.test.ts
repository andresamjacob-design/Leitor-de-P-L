import { describe, expect, it } from "vitest";
import {
  buildCategorizationPrompt,
  parseCategorization,
  type AiCatalogue,
  type AiSubject,
} from "@/lib/ai/categorize";

const CATALOGUE: AiCatalogue = {
  categories: [
    { id: "cat-uber", code: "9.04", name: "Uber e transporte", kind: "expense" },
    { id: "cat-tool", code: "7.01", name: "Google Workspace", kind: "expense" },
    { id: "cat-rev", code: "3.01", name: "Receita — Suporte contínuo", kind: "revenue" },
  ],
  clients: [{ id: "cli-1", name: "Mary Kay" }],
  people: [{ id: "pes-1", name: "Maria Souza" }],
};

const SUBJECTS: AiSubject[] = [
  { ref: "a", description: "Uber UBER *TRIP HELP.U", counterpartyName: null, direction: "out" },
  { ref: "b", description: "RECEBIMENTOS MARY KAY", counterpartyName: "Mary Kay", direction: "in" },
];

function reply(items: unknown[]): string {
  return JSON.stringify(items);
}

describe("buildCategorizationPrompt", () => {
  const prompt = buildCategorizationPrompt(SUBJECTS, CATALOGUE);

  it("manda o plano de contas, os clientes e as pessoas", () => {
    expect(prompt).toContain("9.04 — Uber e transporte");
    expect(prompt).toContain("cli-1 — Mary Kay");
    expect(prompt).toContain("pes-1 — Maria Souza");
  });

  it("manda a descrição e o sentido de cada lançamento", () => {
    expect(prompt).toContain("a | saída | Uber UBER *TRIP HELP.U");
    expect(prompt).toContain("b | entrada | RECEBIMENTOS MARY KAY | contraparte: Mary Kay");
  });

  it("nunca manda valor — o LLM classifica texto, não faz conta (SPEC §8)", () => {
    const comValores = buildCategorizationPrompt(SUBJECTS, CATALOGUE);
    expect(comValores).not.toMatch(/R\$/);
    expect(comValores).not.toMatch(/\d+,\d{2}/);
  });

  it("aguenta uma entidade sem cliente nem pessoa cadastrados", () => {
    const vazio = buildCategorizationPrompt(SUBJECTS, {
      ...CATALOGUE,
      clients: [],
      people: [],
    });
    expect(vazio).toContain("(nenhum cliente cadastrado)");
    expect(vazio).toContain("(nenhuma pessoa cadastrada)");
  });
});

describe("parseCategorization — o caminho feliz", () => {
  it("resolve o código de conta para o id de verdade", () => {
    const { suggestions } = parseCategorization(
      reply([{ ref: "a", category_code: "9.04", confidence: 0.95, reasoning: "corrida" }]),
      SUBJECTS,
      CATALOGUE,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      ref: "a",
      categoryId: "cat-uber",
      categoryCode: "9.04",
      confidence: 0.95,
    });
  });

  it("aceita cliente e pessoa quando os ids existem", () => {
    const { suggestions } = parseCategorization(
      reply([
        { ref: "b", category_code: "3.01", client_id: "cli-1", confidence: 0.9, reasoning: "x" },
      ]),
      SUBJECTS,
      CATALOGUE,
    );
    expect(suggestions[0]?.clientId).toBe("cli-1");
  });

  it("aceita JSON dentro de bloco de código, que é o que o modelo costuma devolver", () => {
    const { suggestions } = parseCategorization(
      "Claro! Aqui está:\n```json\n" +
        reply([{ ref: "a", category_code: "9.04", confidence: 0.9, reasoning: "x" }]) +
        "\n```",
      SUBJECTS,
      CATALOGUE,
    );
    expect(suggestions).toHaveLength(1);
  });
});

describe("parseCategorization — nada é aceito sem conferir", () => {
  it("descarta um código de conta que não existe", () => {
    const { suggestions, discarded } = parseCategorization(
      reply([{ ref: "a", category_code: "99.99", confidence: 1, reasoning: "inventei" }]),
      SUBJECTS,
      CATALOGUE,
    );

    expect(suggestions).toHaveLength(0);
    expect(discarded[0]?.reason).toContain("não existe");
  });

  it("descarta resposta sobre lançamento que não foi perguntado", () => {
    const { suggestions, discarded } = parseCategorization(
      reply([{ ref: "z", category_code: "9.04", confidence: 1, reasoning: "x" }]),
      SUBJECTS,
      CATALOGUE,
    );

    expect(suggestions).toHaveLength(0);
    expect(discarded[0]?.reason).toContain("não foi perguntado");
  });

  it("descarta a segunda resposta sobre o mesmo lançamento", () => {
    const { suggestions, discarded } = parseCategorization(
      reply([
        { ref: "a", category_code: "9.04", confidence: 0.9, reasoning: "x" },
        { ref: "a", category_code: "7.01", confidence: 0.9, reasoning: "y" },
      ]),
      SUBJECTS,
      CATALOGUE,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.categoryCode).toBe("9.04");
    expect(discarded[0]?.reason).toContain("duas vezes");
  });

  it("descarta confiança que não é número entre 0 e 1", () => {
    for (const confidence of ["alta", 1.5, -0.1, null, undefined]) {
      const { suggestions } = parseCategorization(
        reply([{ ref: "a", category_code: "9.04", confidence, reasoning: "x" }]),
        SUBJECTS,
        CATALOGUE,
      );
      expect(suggestions).toHaveLength(0);
    }
  });

  it("um cliente inventado perde só o cliente, não a categoria", () => {
    const { suggestions, discarded } = parseCategorization(
      reply([
        { ref: "b", category_code: "3.01", client_id: "cli-inexistente", confidence: 0.9, reasoning: "x" },
      ]),
      SUBJECTS,
      CATALOGUE,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.clientId).toBeNull();
    expect(discarded[0]?.reason).toContain("a categoria foi mantida");
  });

  it("uma pessoa inventada perde só a pessoa", () => {
    const { suggestions } = parseCategorization(
      reply([
        { ref: "a", category_code: "9.04", person_id: "pes-fake", confidence: 0.9, reasoning: "x" },
      ]),
      SUBJECTS,
      CATALOGUE,
    );
    expect(suggestions[0]?.personId).toBeNull();
  });

  it("resposta que não é JSON não derruba nada, só é descartada", () => {
    const { suggestions, discarded } = parseCategorization(
      "Desculpe, não consigo ajudar com isso.",
      SUBJECTS,
      CATALOGUE,
    );

    expect(suggestions).toHaveLength(0);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.ref).toBeNull();
  });

  it("JSON que não é lista é descartado", () => {
    const { suggestions, discarded } = parseCategorization(
      JSON.stringify({ ref: "a", category_code: "9.04" }),
      SUBJECTS,
      CATALOGUE,
    );
    expect(suggestions).toHaveLength(0);
    expect(discarded[0]?.reason).toContain("não é uma lista");
  });

  it("uma lista com um item bom e um ruim aproveita o bom", () => {
    const { suggestions, discarded } = parseCategorization(
      reply([
        { ref: "a", category_code: "9.04", confidence: 0.9, reasoning: "x" },
        { ref: "b", category_code: "inventada", confidence: 0.9, reasoning: "y" },
      ]),
      SUBJECTS,
      CATALOGUE,
    );

    expect(suggestions).toHaveLength(1);
    expect(discarded).toHaveLength(1);
  });

  it("o modelo pode omitir o que não sabe, e isso não é erro", () => {
    const { suggestions, discarded } = parseCategorization(reply([]), SUBJECTS, CATALOGUE);
    expect(suggestions).toHaveLength(0);
    expect(discarded).toHaveLength(0);
  });
});
