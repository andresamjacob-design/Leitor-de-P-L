import { describe, expect, it } from "vitest";
import { conferirPrint, lerRespostaDoPrint, type RespostaDoPrint } from "@/lib/import/print-extrato";

function movimento(over: Partial<RespostaDoPrint["movimentos"][number]> = {}) {
  return {
    data: "05/10/2026",
    descricao: "Pix recebido",
    valor: "1.000,00",
    sentido: "entrada" as const,
    contraparte: "ACME LTDA",
    documento: "12.345.678/0001-90",
    saldo_apos: null,
    print: 1,
    ...over,
  };
}

function resposta(over: Partial<RespostaDoPrint> = {}): RespostaDoPrint {
  return {
    banco: "Banco BS2",
    agencia: null,
    conta: null,
    titular: "GSJACOB",
    saldo_inicial: { data: "01/10/2026", valor: "3,39" },
    saldo_final: { data: "31/10/2026", valor: "803,39" },
    movimentos: [movimento(), movimento({ descricao: "Pix enviado", valor: "200,00", sentido: "saida", documento: null })],
    ilegiveis: [],
    ...over,
  };
}

describe("lerRespostaDoPrint", () => {
  it("a IA transcreve o texto; o valor em centavos sai do parseMoney", () => {
    const parse = lerRespostaDoPrint(resposta());
    expect(parse.transactions).toHaveLength(2);
    expect(parse.transactions[0]).toMatchObject({
      occurredOn: "2026-10-05",
      amount: 100000n,
      direction: "in",
      counterpartyTaxId: "12345678000190",
    });
    expect(parse.transactions[1]).toMatchObject({ amount: 20000n, direction: "out" });
    expect(parse.source.institution).toBe("Banco BS2");
  });

  it("o saldo inicial é saldo, não movimento — os R$ 3,39 nunca viram receita", () => {
    const parse = lerRespostaDoPrint(resposta());
    expect(parse.openingBalance).toBe(339n);
    expect(parse.transactions.every((t) => t.amount !== 339n)).toBe(true);
    expect(parse.periodStart).toBe("2026-10-01");
    expect(parse.periodEnd).toBe("2026-10-31");
  });

  it("o sentido decide o sinal, mesmo se a tela imprimiu um menos no valor", () => {
    const parse = lerRespostaDoPrint(resposta({ movimentos: [movimento({ valor: "- 200,00", sentido: "saida" })] }));
    expect(parse.transactions[0]).toMatchObject({ amount: 20000n, direction: "out" });
  });

  it("valor ou data ilegíveis vão para o descarte com o motivo, não para o razão", () => {
    const parse = lerRespostaDoPrint(
      resposta({
        movimentos: [movimento({ valor: "1.0?0,00" }), movimento({ data: null }), movimento()],
        ilegiveis: [{ print: 2, trecho: "TED ...", motivo: "cortado na borda" }],
      }),
    );
    expect(parse.transactions).toHaveLength(1);
    expect(parse.discarded.map((d) => d.reason)).toEqual([
      "valor ilegível (“1.0?0,00”)",
      "data ilegível (“”)",
      "cortado na borda",
    ]);
  });

  it("CPF mascarado não vira documento", () => {
    const parse = lerRespostaDoPrint(resposta({ movimentos: [movimento({ documento: "709.***.***-26" })] }));
    expect(parse.transactions[0]?.counterpartyTaxId).toBeNull();
  });

  it("sem saldo inicial, avisa que não há como conferir", () => {
    const parse = lerRespostaDoPrint(resposta({ saldo_inicial: null }));
    expect(parse.openingBalance).toBeNull();
    expect(parse.warnings[0]?.message).toMatch(/não mostra saldo inicial/);
  });

  it("recusa o que não é um extrato", () => {
    expect(() => lerRespostaDoPrint({ texto: "não sei" })).toThrow(/extrato reconhecível/);
  });
});

describe("conferirPrint", () => {
  it("fecha quando saldo inicial + movimentos = saldo final", () => {
    const resultado = conferirPrint(lerRespostaDoPrint(resposta()));
    expect(resultado.ok).toBe(true);
    expect(resultado.message).toMatch(/fecham com o saldo do print \(3,39 → 803,39\)/);
  });

  it("uma linha repetida na emenda entre dois prints quebra a conta", () => {
    const duplicada = resposta();
    duplicada.movimentos.push(movimento({ print: 2 }));
    const resultado = conferirPrint(lerRespostaDoPrint(duplicada));
    expect(resultado.ok).toBe(false);
    expect(resultado.difference).toBe(100000n);
    expect(resultado.message).toMatch(/duas vezes na emenda/);
  });

  it("sem saldo final, não finge conferência", () => {
    const resultado = conferirPrint(lerRespostaDoPrint(resposta({ saldo_final: null })));
    expect(resultado.ok).toBe(false);
    expect(resultado.expected).toBeNull();
  });
});
