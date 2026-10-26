import { describe, expect, it } from "vitest";
import { rowsFromPages } from "@/lib/import/itau-statement-pdf";
import { GLYPH_TABLE } from "@/lib/import/itau-pdf-glyphs";
import type { GlyphItem } from "@/lib/import/itau-pdf-cids";
import { parseMoney } from "@/lib/money";

const reverse = new Map<string, number>();
for (const [cid, ch] of GLYPH_TABLE) if (!reverse.has(ch)) reverse.set(ch, cid);

function item(x: number, y: number, text: string): GlyphItem {
  return { x, y, cids: [...text].map((ch) => reverse.get(ch) ?? 0xff) };
}

/** As colunas medidas nos arquivos reais. */
const DATA = 35;
const DESC = 89;
const NOME = 225;
const DOC = 361;
const VALOR = 468;

describe("rowsFromPages", () => {
  it("lê uma linha simples", () => {
    const rows = rowsFromPages([
      [
        item(DATA, 800, "20/03/2026"),
        item(DESC, 800, "PAGAMENTOS A FORNECEDORES"),
        item(NOME, 800, "WCOMMERCE LTDA"),
        item(DOC, 800, "43.207.759/0001-52"),
        item(VALOR, 800, "-4.805,12"),
      ],
    ]);

    expect(rows).toEqual([
      {
        occurredOn: "2026-03-20",
        description: "PAGAMENTOS A FORNECEDORES",
        counterpartyName: "WCOMMERCE LTDA",
        counterpartyTaxId: "43207759000152",
        amount: -parseMoney("4.805,12"),
      },
    ]);
  });

  it("junta o nome que quebra em duas linhas, metade acima e metade abaixo da data", () => {
    // É a regra que faltava: agrupar por `y` parte esta transação em dois pedaços.
    const rows = rowsFromPages([
      [
        item(NOME, 805, "RICARDO DE CARVALHO"),
        item(DATA, 800, "20/03/2026"),
        item(DESC, 800, "PAGAMENTOS A FORNECEDORES"),
        item(DOC, 800, "398.805.388-03"),
        item(VALOR, 800, "-13.000,00"),
        item(NOME, 794, "CUSTODIO JUNIOR"),
      ],
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.counterpartyName).toBe("RICARDO DE CARVALHO CUSTODIO JUNIOR");
    expect(rows[0]?.counterpartyTaxId).toBe("39880538803");
  });

  it("cada fragmento vai para a data mais próxima, não para a de mesmo y", () => {
    // Duas transações seguidas, cada uma com nome de duas linhas. O fragmento em y=776
    // está mais perto da segunda data (781) do que da primeira (805).
    const rows = rowsFromPages([
      [
        item(DATA, 805, "05/01/2026"),
        item(NOME, 805, "PRIMEIRA EMPRESA"),
        item(VALOR, 805, "-1.000,00"),
        item(NOME, 786, "SEGUNDA EMPRESA"),
        item(DATA, 781, "06/01/2026"),
        item(VALOR, 781, "-2.000,00"),
      ],
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.counterpartyName).toBe("PRIMEIRA EMPRESA");
    expect(rows[1]?.counterpartyName).toBe("SEGUNDA EMPRESA");
    expect(rows[1]?.amount).toBe(-parseMoney("2.000,00"));
  });

  it("uma linha sem valor não vira transação", () => {
    const rows = rowsFromPages([[item(DATA, 800, "20/03/2026"), item(DESC, 800, "SALDO")]]);
    expect(rows).toEqual([]);
  });

  it("entrada e saída mantêm o sinal do extrato", () => {
    const rows = rowsFromPages([
      [
        item(DATA, 800, "20/03/2026"),
        item(DESC, 800, "BOLETO RECEBIDO"),
        item(VALOR, 800, "5.000,00"),
      ],
    ]);
    expect(rows[0]?.amount).toBe(parseMoney("5.000,00"));
  });

  it("sem documento, a contraparte fica nula em vez de inventada", () => {
    const rows = rowsFromPages([
      [
        item(DATA, 800, "20/03/2026"),
        item(DESC, 800, "RES APLIC AUT MAIS"),
        item(VALOR, 800, "109.319,11"),
      ],
    ]);
    expect(rows[0]?.counterpartyTaxId).toBeNull();
    expect(rows[0]?.counterpartyName).toBeNull();
  });

  it("o valor mais à direita é o da transação, não o saldo", () => {
    const rows = rowsFromPages([
      [
        item(DATA, 800, "20/03/2026"),
        item(DESC, 800, "PAGAMENTOS A FORNECEDORES"),
        item(VALOR, 800, "-13.000,00"),
        item(VALOR + 60, 800, "343.870,07"),
      ],
    ]);
    expect(rows[0]?.amount).toBe(parseMoney("343.870,07"));
  });
});
