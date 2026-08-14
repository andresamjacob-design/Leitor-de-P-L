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

describe("contraparte no hash", () => {
  // O caso que o primeiro import real revelou: a descrição do extrato é só
  // "PIX ENVIADO" e a pessoa vem noutra coluna. Sem a contraparte, uma folha de
  // pagamento inteira colidia num hash só.
  const folha = { ...base, description: "PIX ENVIADO", amount: parseMoney("4.000,00") };

  it("pagamentos iguais para pessoas diferentes têm hashes diferentes", () => {
    const a = dedupHash({ ...folha, counterparty: "GABRIEL SOARES DA SILVA" });
    const b = dedupHash({ ...folha, counterparty: "LUCAS DE OLIVEIRA FARIA" });
    expect(a).not.toBe(b);
  });

  it("a mesma contraparte escrita com ruído continua a mesma", () => {
    expect(dedupHash({ ...folha, counterparty: "  josé  da  silva " })).toBe(
      dedupHash({ ...folha, counterparty: "JOSE DA SILVA" }),
    );
  });

  it("sem contraparte, o hash é o de antes", () => {
    expect(dedupHash({ ...folha, counterparty: null })).toBe(dedupHash(folha));
    expect(dedupHash({ ...folha, counterparty: "" })).toBe(dedupHash(folha));
  });
});

describe("ocorrência dentro do mesmo arquivo", () => {
  it("duas linhas idênticas de verdade são movimentos diferentes", () => {
    expect(dedupHash({ ...base, suffix: 0 })).not.toBe(dedupHash({ ...base, suffix: 1 }));
  });

  it("a primeira ocorrência tem o mesmo hash de quem não passa índice", () => {
    expect(dedupHash({ ...base, suffix: 0 })).toBe(dedupHash(base));
  });

  it("reimportar o mesmo arquivo reproduz exatamente os mesmos hashes", () => {
    const arquivo = [
      { ...base, counterparty: "ACME" },
      { ...base, counterparty: "ACME" },
      { ...base, counterparty: "OUTRA" },
    ];

    const hashesDe = (linhas: typeof arquivo) => {
      const contagem = new Map<string, number>();
      return linhas.map((linha) => {
        const chave = dedupHash(linha);
        const indice = contagem.get(chave) ?? 0;
        contagem.set(chave, indice + 1);
        return dedupHash({ ...linha, suffix: indice });
      });
    };

    const primeira = hashesDe(arquivo);
    expect(hashesDe(arquivo)).toEqual(primeira);
    expect(new Set(primeira).size).toBe(3);
  });
});
