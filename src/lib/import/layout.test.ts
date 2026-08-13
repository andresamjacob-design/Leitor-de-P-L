import { describe, expect, it } from "vitest";
import { detectColumns, toDocumentLines, toLines } from "@/lib/import/layout";
import type { PdfPage, PositionedItem } from "@/lib/import/layout";

function item(x: number, y: number, text: string, width = 40): PositionedItem {
  return { x, y, text, width };
}

/** Enough items at a position to clear the 4% share a column has to carry. */
function filler(x: number, count: number, from = 900): PositionedItem[] {
  return Array.from({ length: count }, (_, index) => item(x, from + index * 10, `t${index}`));
}

describe("detectColumns", () => {
  it("encontra as duas colunas de uma fatura", () => {
    const items = [...filler(148, 30), ...filler(364, 20, 2000)];
    expect(detectColumns(items)).toEqual([148, 364]);
  });

  it("não confunde a coluna de valores com uma segunda coluna", () => {
    // Os valores ficam 172pt à direita das datas — perto demais para ser coluna.
    const items = [...filler(148, 30), ...filler(320, 25, 2000)];
    expect(detectColumns(items)).toEqual([148]);
  });

  it("ignora posições com pouco texto", () => {
    const items = [...filler(148, 60), ...filler(400, 2, 2000)];
    expect(detectColumns(items)).toEqual([148]);
  });

  it("uma página sem nada devolve uma coluna só", () => {
    expect(detectColumns([])).toEqual([0]);
  });
});

describe("toLines", () => {
  it("agrupa itens da mesma altura numa linha, da esquerda para a direita", () => {
    const page: PdfPage = {
      number: 1,
      items: [item(300, 500, "10,00"), item(148, 500, "05/01"), item(175, 500, "PADARIA")],
    };
    const [line] = toLines(page, [148]);
    expect(line?.text).toBe("05/01 PADARIA 10,00");
  });

  it("tolera diferença mínima de altura na mesma linha", () => {
    const page: PdfPage = {
      number: 1,
      items: [item(148, 500, "05/01"), item(300, 501.5, "10,00")],
    };
    expect(toLines(page, [148])).toHaveLength(1);
  });

  it("separa linhas diferentes", () => {
    const page: PdfPage = {
      number: 1,
      items: [item(148, 500, "05/01"), item(148, 480, "06/01")],
    };
    expect(toLines(page, [148])).toHaveLength(2);
  });

  it("lê a coluna 1 inteira antes da coluna 2, como um jornal", () => {
    const page: PdfPage = {
      number: 1,
      items: [
        item(148, 500, "esquerda-topo"),
        item(364, 500, "direita-topo"),
        item(148, 480, "esquerda-baixo"),
        item(364, 480, "direita-baixo"),
      ],
    };
    expect(toLines(page, [148, 364]).map((line) => line.text)).toEqual([
      "esquerda-topo",
      "esquerda-baixo",
      "direita-topo",
      "direita-baixo",
    ]);
  });
});

describe("toDocumentLines", () => {
  it("usa as mesmas colunas em todas as páginas", () => {
    // A página 2 não tem nada na coluna da direita. Se as colunas fossem detectadas por
    // página, ela viraria uma coluna só e as duas metades se misturariam.
    const pages: PdfPage[] = [
      { number: 1, items: [...filler(148, 30), ...filler(364, 20, 2000)] },
      { number: 2, items: [item(148, 500, "05/01"), item(364, 500, "texto ao lado")] },
    ];

    const lines = toDocumentLines(pages).filter((line) => line.text.includes("05/01"));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("05/01");
  });
});
