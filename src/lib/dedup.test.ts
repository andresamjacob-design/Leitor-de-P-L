import { describe, expect, it } from "vitest";
import { dedupHash, normalizeDescription } from "@/lib/dedup";
import { parseMoney } from "@/lib/money";

const base = {
  accountId: "acc-1",
  occurredOn: "2026-01-15",
  amount: parseMoney("1.234,56"),
  direction: "out" as const,
  description: "PAG BOLETO 123",
};

describe("normalizeDescription", () => {
  it("tira acento, caixa e espaço repetido", () => {
    expect(normalizeDescription("  Serviços   de  Contabilidade ")).toBe(
      "SERVICOS DE CONTABILIDADE",
    );
  });

  it("descrições que só diferem em ruído normalizam igual", () => {
    expect(normalizeDescription("TED  João")).toBe(normalizeDescription("ted joão"));
  });
});

describe("dedupHash", () => {
  it("é estável para o mesmo movimento", () => {
    expect(dedupHash(base)).toBe(dedupHash({ ...base }));
  });

  it("ignora ruído de descrição", () => {
    expect(dedupHash({ ...base, description: "pag  boleto 123" })).toBe(dedupHash(base));
  });

  it("muda quando o valor muda em um centavo", () => {
    expect(dedupHash({ ...base, amount: base.amount + 1n })).not.toBe(dedupHash(base));
  });

  it("muda quando a direção inverte", () => {
    expect(dedupHash({ ...base, direction: "in" })).not.toBe(dedupHash(base));
  });

  it("muda quando a conta muda", () => {
    expect(dedupHash({ ...base, accountId: "acc-2" })).not.toBe(dedupHash(base));
  });

  it("o sufixo é o que deixa passar uma segunda ocorrência idêntica", () => {
    expect(dedupHash({ ...base, suffix: 1 })).not.toBe(dedupHash(base));
    expect(dedupHash({ ...base, suffix: 0 })).toBe(dedupHash(base));
  });
});
