import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJson, getAiProvider, isAiConfigured } from "@/lib/ai/provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuração", () => {
  it("sem chave, não há provedor — e isso é um estado válido (SPEC §2)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(getAiProvider()).toBeNull();
    expect(isAiConfigured()).toBe(false);
  });

  it("com chave, o provedor existe e usa o modelo padrão", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("ANTHROPIC_MODEL", "");
    const provider = getAiProvider();
    expect(provider?.name).toBe("anthropic");
    expect(provider?.model).toBe("claude-sonnet-5");
  });

  it("o modelo é trocável por variável de ambiente", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001");
    expect(getAiProvider()?.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("extractJson", () => {
  it("lê JSON puro", () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it("lê JSON dentro de bloco de código", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("lê JSON cercado de prosa", () => {
    expect(extractJson('Claro! Aqui vai:\n[{"a":1}]\nEspero ter ajudado.')).toEqual([{ a: 1 }]);
  });

  it("recusa resposta sem JSON", () => {
    expect(() => extractJson("não posso ajudar")).toThrow(/não contém JSON/);
  });

  it("recusa JSON incompleto em vez de adivinhar o resto", () => {
    expect(() => extractJson('[{"a":1}')).toThrow(/incompleto/);
  });

  it("recusa JSON malformado", () => {
    expect(() => extractJson("[{a:1}]")).toThrow(/não é um JSON válido/);
  });
});
