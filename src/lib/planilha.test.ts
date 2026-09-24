import { describe, expect, it } from "vitest";
import type { Cell, Sheet } from "@/lib/import/xlsx";
import {
  celulaNumerica,
  cortarDepoisDe,
  deslocarDecimal,
  lerDre,
  lerFluxo,
  razaoEmPercentual,
} from "@/lib/planilha";

/** Uma linha de planilha com células nas colunas dadas; o resto fica vazio. */
function linha(celulas: Record<number, string>): Cell[] {
  const max = Math.max(0, ...Object.keys(celulas).map(Number));
  return Array.from({ length: max + 1 }, (_, i) => celulas[i] ?? null);
}

/** Doze meses a partir da coluna `primeira`. */
function meses(primeira: number, valores: string[]): Record<number, string> {
  return Object.fromEntries(valores.map((v, i) => [primeira + i, v]));
}

const MESES_DRE = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

describe("celulaNumerica", () => {
  it("devolve o número como está na célula, sem arredondar", () => {
    expect(celulaNumerica("30714.28571")).toBe("30714.28571");
    expect(celulaNumerica("-37.5")).toBe("-37.5");
    expect(celulaNumerica("800")).toBe("800");
  });

  it("expande notação científica sem passar por float", () => {
    // A linha `Diferença` da Summary guarda resto de fórmula assim.
    expect(celulaNumerica("1.164153218e-10")).toBe("0.0000000001164153218");
    expect(celulaNumerica("2.5E3")).toBe("2500");
  });

  it("vazio e texto viram nulo", () => {
    expect(celulaNumerica("")).toBeNull();
    expect(celulaNumerica(null)).toBeNull();
    expect(celulaNumerica("$0")).toBeNull();
    expect(celulaNumerica("Monthly totals:")).toBeNull();
  });
});

describe("deslocarDecimal e razaoEmPercentual", () => {
  it("anda com a vírgula em texto", () => {
    expect(deslocarDecimal("12.345", 2)).toBe("1234.5");
    expect(deslocarDecimal("1.5", -3)).toBe("0.0015");
    expect(deslocarDecimal("-0.5", 1)).toBe("-5");
  });

  it("transforma a razão do OPBB % em percentual", () => {
    expect(razaoEmPercentual("0.1331032629")).toBe("13.31032629");
    expect(razaoEmPercentual("1")).toBe("100");
  });
});

describe("lerDre", () => {
  const aba: Sheet = {
    name: "DRE Geral",
    rows: [
      linha({ 0: "DRE 2026", 2: "P&L 2026", ...meses(4, MESES_DRE), 16: "Receita" }),
      linha({ 1: "Escopo", 2: "Receita", 3: "1 NF", 4: "398891.5613", 16: "5033061.867" }),
      linha({ 1: "Ongoing", 2: "Gringo", 3: "Mensal", 4: "104000.0", 10: "40000.0" }),
      linha({ 0: "Aberto", 1: "Projeto", 2: "Medpej", 3: "Kickoff", 4: "5833.333333" }),
      linha({}),
      linha({ 2: "Receita Liquida", 4: "321223.9713" }),
      linha({ 2: "- Salários", 4: "212151.6667" }),
      linha({ 1: "cartão", 2: "- Gsuite (cartão de credito)", 4: "4090.89" }),
      linha({ 2: "OPBB (Oper Profit Before Bonus)", 4: "53093.76835" }),
      linha({ 2: "OPBB %", 4: "0.1331032629" }),
      linha({ 2: "Imposto Total", 4: "0.17" }),
    ],
  };
  const { linhas, ignoradas } = lerDre(aba);

  it("copia na ordem da planilha, pulando linha vazia", () => {
    expect(linhas.map((l) => l.rotulo)).toEqual([
      "DRE 2026",
      "Receita",
      "Gringo",
      "Medpej",
      "Receita Liquida",
      "Salários",
      "Gsuite (cartão de credito)",
      "OPBB (Oper Profit Before Bonus)",
      "OPBB %",
    ]);
    expect(linhas.map((l) => l.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("para no OPBB % — abaixo dele são premissas, não relatório", () => {
    expect(linhas.some((l) => l.rotulo === "Imposto Total")).toBe(false);
  });

  it("guarda o valor da célula sem arredondar, e o total que a planilha declara", () => {
    const medpej = linhas.find((l) => l.rotulo === "Medpej");
    expect(medpej?.valores[0]).toBe("5833.333333");
    const receita = linhas.find((l) => l.rotulo === "Receita");
    const gringo = linhas.find((l) => l.rotulo === "Gringo");
    expect(receita?.total).toBe("5033061.867");
    expect(gringo?.valores[6]).toBe("40000.0");
    expect(gringo?.valores[1]).toBeNull();
  });

  it("marca total e percentual pelo peso visual, sem mudar valor", () => {
    const tipo = (r: string) => linhas.find((l) => l.rotulo === r)?.tipo;
    expect(tipo("Receita")).toBe("total");
    expect(tipo("Receita Liquida")).toBe("total");
    expect(tipo("OPBB (Oper Profit Before Bonus)")).toBe("total");
    expect(tipo("OPBB %")).toBe("percentual");
    expect(tipo("Salários")).toBe("linha");
  });

  it("carrega o detalhe que a planilha põe ao lado do rótulo", () => {
    expect(linhas.find((l) => l.rotulo === "Gringo")?.detalhe).toBe("Ongoing · Mensal");
    expect(linhas.find((l) => l.rotulo === "Medpej")?.detalhe).toBe("Projeto · Kickoff · Aberto");
    expect(linhas.find((l) => l.rotulo.startsWith("Gsuite"))?.detalhe).toBe("cartão");
    // Total não tem detalhe, mesmo quando a planilha escreve algo ao lado.
    expect(linhas.find((l) => l.rotulo === "Receita")?.detalhe).toBeNull();
  });

  it("não perde célula nenhuma calado", () => {
    expect(ignoradas).toEqual([]);
    const comTexto: Sheet = {
      name: "DRE Geral",
      rows: [
        linha({ ...meses(4, MESES_DRE) }),
        linha({ 2: "Gringo", 4: "a confirmar" }),
      ],
    };
    expect(lerDre(comTexto).ignoradas).toEqual(['DRE Geral linha 2 (Gringo), mês 1: "a confirmar"']);
  });

  it("recusa uma planilha que mudou de forma, em vez de copiar colunas trocadas", () => {
    const torta: Sheet = { name: "DRE Geral", rows: [linha({ 4: "Janeiro", 15: "Novembro" })] };
    expect(() => lerDre(torta)).toThrow(/Dezembro/);
  });
});

describe("lerDre, versão de 01/09 com as duas empresas", () => {
  const cab = (empresa: string) =>
    linha({ 0: empresa, 2: "P&L 2026 Squads - PBI", ...meses(4, MESES_DRE), 16: "Receita" });
  const aba: Sheet = {
    name: "DRE Geral",
    rows: [
      cab("DDGROUP"),
      linha({ 1: "Escopo", 2: "Receita (dd+gsj)", 3: "DRE", 10: "508749.9787" }),
      linha({ 1: "Escopo", 2: "Receita", 3: "DRE", 10: "485621.4072" }),
      linha({ 1: "Ongoing", 2: "Gringo", 3: "Mensal", 10: "40000.0" }),
      linha({ 2: "Receita Liquida", 10: "403849.5772" }),
      linha({}),
      cab("GSJACOB"),
      linha({ 1: "Escopo", 2: "Receita", 3: "DRE", 10: "23128.57143" }),
      linha({ 1: "Ongoing", 2: "PDG IT", 3: "Kickoff", 11: "4000.0" }),
      linha({ 2: "Receita Liquida (dd+gsj)", 10: "425127.8629" }),
      linha({ 2: "Lucro Bruto (dd + gsj)", 10: "425127.8629" }),
      linha({ 2: "OPBB %", 10: "0.3548188748" }),
    ],
  };
  const { linhas, ignoradas } = lerDre(aba);

  it("cada cabeçalho de empresa vira título de seção, na posição dele", () => {
    expect(linhas.filter((l) => l.tipo === "secao").map((l) => [l.ordem, l.rotulo])).toEqual([
      [1, "DDGROUP"],
      [6, "GSJACOB"],
    ]);
  });

  it("o segundo cabeçalho não vira linha nem perde célula", () => {
    // Os nomes dos meses no cabeçalho seriam 12 células de texto ignoradas.
    expect(ignoradas).toEqual([]);
    expect(linhas.some((l) => l.rotulo === "P&L 2026 Squads - PBI")).toBe(false);
  });

  it("reconhece os totais com sufixo (dd+gsj)", () => {
    const tipo = (r: string) => linhas.find((l) => l.rotulo === r)?.tipo;
    expect(tipo("Receita (dd+gsj)")).toBe("total");
    expect(tipo("Receita Liquida (dd+gsj)")).toBe("total");
    expect(tipo("Lucro Bruto (dd + gsj)")).toBe("total");
    expect(tipo("Gringo")).toBe("linha");
  });
});

describe("cortarDepoisDe", () => {
  const base = (tipo: "linha" | "percentual", total: string | null) => ({
    ordem: 1,
    tipo,
    rotulo: "x",
    detalhe: null,
    valores: ["100", "200.555", null, "50", "1", "1", "1", "1", "999", "999", "999", "999"],
    total,
  });

  it("esvazia os meses depois do corte", () => {
    const [l] = cortarDepoisDe([base("linha", "5000")], 8);
    expect(l?.valores.slice(8)).toEqual([null, null, null, null]);
    expect(l?.valores.slice(0, 8)).toEqual(["100", "200.555", null, "50", "1", "1", "1", "1"]);
  });

  it("o total passa a ser a soma do que ficou, não o da planilha", () => {
    // 100 + 200,56 (arredondado uma vez) + 50 + 4 × 1 = 354,56
    expect(cortarDepoisDe([base("linha", "5000")], 8)[0]?.total).toBe("354.56");
  });

  it("linha sem total na planilha continua sem total, e percentual não se soma", () => {
    expect(cortarDepoisDe([base("linha", null)], 8)[0]?.total).toBeNull();
    expect(cortarDepoisDe([base("percentual", "0.2")], 8)[0]?.total).toBeNull();
  });

  it("recusa mês de corte fora do ano", () => {
    expect(() => cortarDepoisDe([], 0)).toThrow();
    expect(() => cortarDepoisDe([], 13)).toThrow();
  });
});

describe("lerFluxo", () => {
  const cabecalho = (nome: string) => linha({ 4: nome, ...meses(5, Array(12).fill("42370")) });
  const income: Sheet = {
    name: "Income",
    rows: [
      cabecalho("Income"),
      linha({ 1: "Sales", 4: "Monthly totals:", 5: "382295.75", 17: "5480588.307" }),
      linha({ 4: "Receita Ongoing", 5: "202400" }),
      linha({ 4: "-", 17: "0" }),
    ],
  };
  const expenses: Sheet = {
    name: "Expenses",
    rows: [
      cabecalho("Expenses"),
      linha({ 1: "Pessoas", 4: "Monthly totals:", 5: "273750" }),
      linha({ 4: "Time - Interno", 5: "4000" }),
      linha({ 20: "Leonardo", 21: "122500" }),
      linha({ 1: "Miscellaneous Cost of Service", 4: "Monthly totals:", 5: "159.52" }),
      linha({ 4: "Commissions & Fees", 17: "0", 18: "$0" }),
      linha({ 4: "Bank Charges", 5: "159.52", 8: "-37.5" }),
    ],
  };
  const summary: Sheet = {
    name: "Summary",
    rows: [
      linha({ 3: "Summary" }),
      linha({ 3: "Income", 4: "382295.75", 16: "5480588.307" }),
      linha({ 3: "Expenses", 4: "352801.12" }),
      linha({ 3: "Inadimplencia", 4: "0.0" }),
      linha({ 3: "Net savings", 4: "29494.63" }),
      linha({ 3: "Ending balance", 4: "539699.41" }),
      linha({ 3: "Valor Itaú", 4: "539699.41" }),
      linha({ 3: "Diferença", 4: "1.164153218e-10" }),
      // A aba repete os nomes como título de bloco, sem número — não pode ganhar do de cima.
      linha({ 3: "Income" }),
      linha({ 3: "Expenses" }),
    ],
  };
  const { linhas, ignoradas } = lerFluxo({ income, expenses, summary });

  it("segue a ordem da Summary: Income, Expenses, fechamento", () => {
    expect(linhas.map((l) => `${l.tipo}:${l.rotulo}`)).toEqual([
      "secao:Income",
      "grupo:Sales",
      "linha:Receita Ongoing",
      "total:Total Income",
      "secao:Expenses",
      "grupo:Pessoas",
      "linha:Time - Interno",
      "grupo:Miscellaneous Cost of Service",
      "linha:Commissions & Fees",
      "linha:Bank Charges",
      "total:Total Expenses",
      "secao:Summary",
      "linha:Inadimplencia",
      "total:Net savings",
      "total:Ending balance",
      "linha:Valor Itaú",
      "linha:Diferença",
    ]);
  });

  it("o grupo leva o subtotal que a própria aba declara", () => {
    expect(linhas.find((l) => l.rotulo === "Sales")?.valores[0]).toBe("382295.75");
    expect(linhas.find((l) => l.rotulo === "Sales")?.total).toBe("5480588.307");
  });

  it("o total da seção vem da Summary, não de uma soma nova", () => {
    expect(linhas.find((l) => l.rotulo === "Total Expenses")?.valores[0]).toBe("352801.12");
  });

  it("guarda valor negativo da planilha como está", () => {
    // `Bank Charges` vale −37,50 em abril na planilha dele: estorno dentro da despesa.
    expect(linhas.find((l) => l.rotulo === "Bank Charges")?.valores[3]).toBe("-37.5");
  });

  it("linha com nome e sem valor entra; espaço reservado `-` e anotação lateral não", () => {
    expect(linhas.some((l) => l.rotulo === "Commissions & Fees")).toBe(true);
    expect(linhas.some((l) => l.rotulo === "-")).toBe(false);
    expect(linhas.some((l) => l.rotulo === "Leonardo")).toBe(false);
  });

  it("numera de 1 em diante e não ignora nada", () => {
    expect(linhas.map((l) => l.ordem)).toEqual(linhas.map((_, i) => i + 1));
    expect(ignoradas).toEqual([]);
  });
});
