import { describe, expect, it } from "vitest";
import { decodeGlyphs, glyphCoverage, GLYPH_TABLE } from "@/lib/import/itau-pdf-glyphs";

/** Escreve uma palavra em CIDs, do jeito que o arquivo faz. */
function cids(text: string): number[] {
  const reverse = new Map<string, number>();
  for (const [cid, ch] of GLYPH_TABLE) if (!reverse.has(ch)) reverse.set(ch, cid);
  return [...text].map((ch) => reverse.get(ch) ?? 0xff);
}

describe("a tabela de glifos", () => {
  it("põe as letras em 0x16 e os dígitos em 0x06, contíguos", () => {
    expect(GLYPH_TABLE.get(0x16)).toBe("A");
    expect(GLYPH_TABLE.get(0x2f)).toBe("Z");
    expect(GLYPH_TABLE.get(0x06)).toBe("0");
    expect(GLYPH_TABLE.get(0x0f)).toBe("9");
  });

  it("contraria o /ToUnicode do próprio arquivo, e é esse o ponto", () => {
    // O PDF declara <001c><0025><0030>: que 0x1c..0x25 são os dígitos 0..9.
    // Texto conhecido prova que são G..P. Confiar no mapa do arquivo é o erro.
    expect(GLYPH_TABLE.get(0x1c)).toBe("G");
    expect(GLYPH_TABLE.get(0x25)).toBe("P");
  });
});

describe("decodeGlyphs", () => {
  it("lê o texto que serviu de crib para derivar a tabela", () => {
    const cru = [
      0x25, 0x16, 0x1c, 0x16, 0x22, 0x1a, 0x23, 0x29, 0x24, 0x28, 0x01, 0x16, 0x01, 0x1b,
      0x24, 0x27, 0x23, 0x1a, 0x18, 0x1a, 0x19, 0x24, 0x27, 0x1a, 0x28,
    ];
    expect(decodeGlyphs(cru)).toBe("PAGAMENTOS A FORNECEDORES");
  });

  it("lê o nome que fechou as letras restantes", () => {
    expect(decodeGlyphs(cids("RICARDO DE CARVALHO"))).toBe("RICARDO DE CARVALHO");
    expect(decodeGlyphs(cids("CUSTODIO JUNIOR"))).toBe("CUSTODIO JUNIOR");
  });

  it("formata documento sozinho — a prova independente de que a tabela está certa", () => {
    // Nenhuma tabela errada produz pontos e traço nos lugares de um CPF por acaso.
    const cpf = [0x09, 0x0f, 0x0e, 0x02, 0x0e, 0x06, 0x0b, 0x02, 0x09, 0x0e, 0x0e, 0x12, 0x06, 0x09];
    expect(decodeGlyphs(cpf)).toBe("398.805.388-03");
  });

  it("um glifo desconhecido aparece como tal, em vez de virar letra plausível", () => {
    expect(decodeGlyphs([0x16, 0xfe, 0x17])).toBe("A<fe>B");
  });
});

describe("glyphCoverage", () => {
  it("mede o quanto a tabela explica, para recusar PDF de outro produtor", () => {
    expect(glyphCoverage(cids("ABC"))).toBe(1);
    expect(glyphCoverage([0x16, 0xfe])).toBe(0.5);
    expect(glyphCoverage([])).toBe(0);
  });
});
