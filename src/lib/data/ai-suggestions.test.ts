/**
 * The constraint this file exists to prove: **no LLM call writes to a ledger table**
 * (SPEC §3).
 *
 * Everything is mocked, including the model, and every table the code touches is
 * recorded. If a future change ever points an AI path at `cash_entries` or
 * `recognition_entries`, this test fails.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const LEDGER_TABLES = ["cash_entries", "recognition_entries", "contracts", "invoices"];

/** Records every table and operation, so the assertions can be about the whole run. */
const touched: { table: string; operation: string }[] = [];

function recorder(table: string) {
  const chain = {
    update(values: unknown) {
      touched.push({ table, operation: "update" });
      void values;
      return chain;
    },
    insert(values: unknown) {
      touched.push({ table, operation: "insert" });
      void values;
      return chain;
    },
    delete() {
      touched.push({ table, operation: "delete" });
      return chain;
    },
    select() {
      touched.push({ table, operation: "select" });
      return chain;
    },
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => recorder(table) }),
}));

const complete = vi.fn();

vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/provider")>();
  return {
    ...original,
    getAiProvider: () => ({ name: "fake", model: "fake-1", complete }),
  };
});

vi.mock("@/lib/data/categories", () => ({
  listCategories: async () => [
    { id: "cat-uber", code: "9.04", name: "Uber", kind: "expense" },
  ],
}));

vi.mock("@/lib/data/clients", () => ({ listClients: async () => [] }));
vi.mock("@/lib/data/rules", () => ({ listPeople: async () => [] }));

const staged = vi.fn();
vi.mock("@/lib/data/imports", () => ({ listStaged: () => staged() }));

const { suggestWithAi } = await import("@/lib/data/ai-suggestions");

function pending(id: string, description: string) {
  return {
    id,
    importId: "imp-1",
    occurredOn: "2026-01-05",
    description,
    amount: 5552n,
    direction: "out" as const,
    counterpartyName: null,
    counterpartyTaxId: null,
    installmentCurrent: null,
    installmentTotal: null,
    suggestedCategoryId: null,
    suggestedClientId: null,
    suggestedPersonId: null,
    suggestionSource: "none" as const,
    confidence: null,
    dedupHash: `h-${id}`,
    status: "pending" as const,
  };
}

beforeEach(() => {
  touched.length = 0;
  complete.mockReset();
  staged.mockReset();
});

describe("suggestWithAi", () => {
  it("nenhuma tabela de ledger é tocada — nem para escrever, nem para ler", async () => {
    staged.mockResolvedValue([pending("s1", "Uber UBER *TRIP")]);
    complete.mockResolvedValue({
      text: JSON.stringify([
        { ref: "s1", category_code: "9.04", confidence: 0.95, reasoning: "corrida" },
      ]),
      model: "fake-1",
    });

    await suggestWithAi("ent-1", "imp-1");

    const writes = touched.filter((item) => item.operation !== "select");
    expect(writes.every((item) => item.table === "staged_transactions")).toBe(true);
    for (const table of LEDGER_TABLES) {
      expect(touched.some((item) => item.table === table)).toBe(false);
    }
  });

  it("grava a sugestão em staged_transactions e conta o que passou", async () => {
    staged.mockResolvedValue([pending("s1", "Uber"), pending("s2", "Wix")]);
    complete.mockResolvedValue({
      text: JSON.stringify([
        { ref: "s1", category_code: "9.04", confidence: 0.95, reasoning: "x" },
        { ref: "s2", category_code: "9.04", confidence: 0.4, reasoning: "y" },
      ]),
      model: "fake-1",
    });

    const result = await suggestWithAi("ent-1", "imp-1");

    expect(result.considered).toBe(2);
    expect(result.suggested).toBe(2);
    expect(touched.filter((item) => item.operation === "update")).toHaveLength(2);
  });

  it("um código inventado é descartado e não vira update", async () => {
    staged.mockResolvedValue([pending("s1", "Uber")]);
    complete.mockResolvedValue({
      text: JSON.stringify([
        { ref: "s1", category_code: "99.99", confidence: 1, reasoning: "inventei" },
      ]),
      model: "fake-1",
    });

    const result = await suggestWithAi("ent-1", "imp-1");

    expect(result.suggested).toBe(0);
    expect(result.discarded[0]?.reason).toContain("não existe");
    expect(touched.some((item) => item.operation === "update")).toBe(false);
  });

  it("não pergunta sobre o que as regras já decidiram", async () => {
    staged.mockResolvedValue([
      { ...pending("s1", "Uber"), suggestedCategoryId: "cat-uber" },
      pending("s2", "Wix"),
    ]);
    complete.mockResolvedValue({ text: "[]", model: "fake-1" });

    const result = await suggestWithAi("ent-1", "imp-1");

    expect(result.considered).toBe(1);
    const prompt = complete.mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).toContain("Wix");
    expect(prompt).not.toContain("Uber UBER");
  });

  it("não chama o modelo quando não sobrou nada indeciso", async () => {
    staged.mockResolvedValue([{ ...pending("s1", "Uber"), suggestedCategoryId: "cat-uber" }]);

    const result = await suggestWithAi("ent-1", "imp-1");

    expect(complete).not.toHaveBeenCalled();
    expect(result.considered).toBe(0);
    expect(result.warnings[0]).toContain("não foi chamada");
  });

  it("uma falha do modelo vira aviso, não exceção", async () => {
    staged.mockResolvedValue([pending("s1", "Uber")]);
    complete.mockRejectedValue(new Error("503 do provedor"));

    const result = await suggestWithAi("ent-1", "imp-1");

    expect(result.suggested).toBe(0);
    expect(result.warnings[0]).toContain("503");
  });

  it("o prompt não leva valor nenhum (SPEC §8)", async () => {
    staged.mockResolvedValue([pending("s1", "BOLETO PAGO TAREFY")]);
    complete.mockResolvedValue({ text: "[]", model: "fake-1" });

    await suggestWithAi("ent-1", "imp-1");

    const prompt = complete.mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).not.toMatch(/55,52|5552|R\$/);
  });
});
