import { describe, expect, it } from "vitest";
import { cnpjDaCelula, lerEmissaoDeNf, notasDaCopia } from "@/lib/nf-da-planilha";
import type { Sheet } from "@/lib/import/xlsx";

const ABA: Sheet = {
  name: "Clientes",
  rows: [
    ["Emissão de NF", null, null, null, null, null, "Dezembro 2025", "Janeiro", "Fevereiro"],
    ["Receita", "Data de Inclusão", "Dados (CNPJ e Email)", "Data de Emissão", "1 NF", "Projeto/Ongoing", "100", "200", "300"],
    ["CSO ", "19/05", "04.203.891/0001-34 - isis@csosa.com.br", "06/01", "Kickoff", "Projeto", "8000.0", null, "3000"],
    ["Enutri", null, null, null, "Kickoff", "Projeto", null, "11666.66667", "a combinar"],
    ["Vazia", null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
    ["Pagamento de NF", null, null, null, null, null, "Dezembro 2025", "Janeiro", "Fevereiro"],
    ["CSO ", null, null, null, null, null, null, "8000", null],
  ],
};

describe("lerEmissaoDeNf", () => {
  const leitura = lerEmissaoDeNf(ABA);

  it("o cabeçalho guarda o mês de cada coluna, virando o ano em janeiro", () => {
    expect(leitura.linhas[0]).toMatchObject({ tipo: "secao", valores: ["2025-12-01", "2026-01-01", "2026-02-01"] });
  });

  it("uma linha por cliente, até o bloco de pagamento, sem as vazias", () => {
    expect(leitura.linhas.slice(1).map((l) => l.rotulo)).toEqual(["CSO", "Enutri"]);
    expect(leitura.linhas[1]).toMatchObject({ detalhe: "Projeto · Kickoff · 04.203.891/0001-34", valores: ["8000.00", null, "3000.00"] });
  });

  it("texto em célula de mês não entra e é mostrado", () => {
    expect(leitura.ignoradas).toEqual(["Enutri, 2026-02: “a combinar”"]);
  });

  it("a cópia volta como notas, com o CNPJ do detalhe", () => {
    const { periodos, linhas } = notasDaCopia(leitura.linhas);
    expect(periodos).toHaveLength(3);
    expect(linhas[0]).toMatchObject({ rotulo: "CSO", cnpj: "04203891000134", escopo: "Projeto" });
    expect(linhas[0]!.notas).toEqual([
      { periodo: "2025-12-01", valor: 800_000n },
      { periodo: "2026-02-01", valor: 300_000n },
    ]);
    expect(linhas[1]!.notas).toEqual([{ periodo: "2026-01-01", valor: 1_166_667n }]);
  });
});

describe("cnpjDaCelula", () => {
  it("o primeiro CNPJ da célula, com ou sem pontuação", () => {
    expect(cnpjDaCelula("07.010.092/0001-30 ; cintia@windlog.com.br")).toBe("07010092000130");
    expect(cnpjDaCelula("Vamos enviar uma Invoice")).toBeNull();
    expect(cnpjDaCelula(null)).toBeNull();
  });
});
