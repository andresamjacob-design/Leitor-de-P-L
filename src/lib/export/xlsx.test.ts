import { describe, expect, it } from "vitest";
import { writeCsv, writeXlsx } from "@/lib/export/xlsx";
import { readXlsx } from "@/lib/import/xlsx";
import { parseMoney } from "@/lib/money";

/**
 * The strongest test available: write a file, then read it back with the same reader that
 * handles the bank's own exports. If a number survives that round trip, it survives Excel.
 */
function roundTrip(rows: Parameters<typeof writeXlsx>[0][number]["rows"]) {
  return readXlsx(writeXlsx([{ name: "Dados", rows }]));
}

describe("writeXlsx", () => {
  it("volta pelo leitor com o mesmo conteúdo", () => {
    const sheets = roundTrip([
      ["Mês", "Categoria", "Valor"],
      ["jan/26", "Salários", parseMoney("60.000,00")],
    ]);

    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe("Dados");
    expect(sheets[0]?.rows[0]).toEqual(["Mês", "Categoria", "Valor"]);
    expect(sheets[0]?.rows[1]?.[2]).toBe("60000.00");
  });

  it("dinheiro sai como número, para a planilha conseguir somar", () => {
    const sheets = roundTrip([["a"], [parseMoney("1.234,56")]]);
    expect(Number(sheets[0]?.rows[1]?.[0])).toBeCloseTo(1234.56, 2);
  });

  it("valor negativo mantém o sinal", () => {
    const sheets = roundTrip([["a"], [parseMoney("-2.500,00")]]);
    expect(sheets[0]?.rows[1]?.[0]).toBe("-2500.00");
  });

  it("zero centavos não vira texto vazio", () => {
    const sheets = roundTrip([["a"], [0n]]);
    expect(sheets[0]?.rows[1]?.[0]).toBe("0.00");
  });

  it("escapa o que quebraria o XML", () => {
    const sheets = roundTrip([["a"], ['M&A <LTDA> "x"']]);
    expect(sheets[0]?.rows[1]?.[0]).toBe('M&A <LTDA> "x"');
  });

  it("preserva acento", () => {
    const sheets = roundTrip([["Competência"], ["Serviços de contabilidade"]]);
    expect(sheets[0]?.rows[1]?.[0]).toBe("Serviços de contabilidade");
  });

  it("célula vazia continua vazia, e não vira zero", () => {
    const sheets = roundTrip([
      ["a", "b", "c"],
      ["x", null, "z"],
    ]);
    expect(sheets[0]?.rows[1]).toEqual(["x", null, "z"]);
  });

  it("aguenta mais de 26 colunas", () => {
    const header = Array.from({ length: 30 }, (_, index) => `c${index}`);
    const sheets = roundTrip([header]);
    expect(sheets[0]?.rows[0]).toHaveLength(30);
    expect(sheets[0]?.rows[0]?.[29]).toBe("c29");
  });

  it("várias abas, cada uma com o seu nome", () => {
    const sheets = readXlsx(
      writeXlsx([
        { name: "Fluxo", rows: [["a"]] },
        { name: "DRE", rows: [["b"]] },
      ]),
    );
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Fluxo", "DRE"]);
  });

  it("limpa caractere que o Excel recusa em nome de aba", () => {
    const sheets = readXlsx(writeXlsx([{ name: "Fluxo/Caixa[2026]", rows: [["a"]] }]));
    expect(sheets[0]?.name).toBe("Fluxo Caixa 2026");
  });

  it("corta nome de aba longo demais", () => {
    const sheets = readXlsx(writeXlsx([{ name: "x".repeat(50), rows: [["a"]] }]));
    expect((sheets[0]?.name ?? "").length).toBe(31);
  });

  it("recusa um arquivo sem aba nenhuma", () => {
    expect(() => writeXlsx([])).toThrow(/pelo menos uma aba/);
  });
});

describe("writeCsv", () => {
  it("usa ponto e vírgula e vírgula decimal, que é o que o Excel brasileiro espera", () => {
    const csv = writeCsv([
      ["Mês", "Valor"],
      ["jan/26", parseMoney("1.234,56")],
    ]);
    expect(csv).toContain("Mês;Valor");
    expect(csv).toContain("jan/26;1234,56");
  });

  it("começa com BOM, senão o acento chega quebrado", () => {
    expect(writeCsv([["ç"]]).charCodeAt(0)).toBe(0xfeff);
  });

  it("protege o campo que tem ponto e vírgula ou aspas", () => {
    const csv = writeCsv([["a;b", 'diz "oi"']]);
    expect(csv).toContain('"a;b"');
    expect(csv).toContain('"diz ""oi"""');
  });

  it("negativo mantém o sinal", () => {
    expect(writeCsv([[parseMoney("-10,00")]])).toContain("-10,00");
  });

  it("célula nula vira campo vazio", () => {
    expect(writeCsv([["a", null, "c"]])).toContain("a;;c");
  });
});
