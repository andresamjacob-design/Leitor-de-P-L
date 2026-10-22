import { describe, expect, it } from "vitest";
import { montarDadosDaDre, preencherDreComApp, type LinhaDeCompetencia } from "@/lib/dre-da-planilha";
import type { LinhaPlanilha } from "@/lib/planilha";

const AGO = 7;
const SET = 8;
const l = (
  tipo: LinhaPlanilha["tipo"],
  rotulo: string,
  ago: string | null = null,
  detalhe: string | null = null,
): LinhaPlanilha => {
  const valores = Array.from({ length: 12 }, () => null as string | null);
  valores[AGO] = ago;
  return { ordem: 0, tipo, rotulo, detalhe, valores, total: ago };
};

// A DRE do Andre em miniatura, com agosto copiado.
const dre: LinhaPlanilha[] = [
  l("total", "Receita", "1100.00"),
  l("linha", "Gringo", "1000.00", "Ongoing · Mensal"),
  l("linha", "CSO", "100.00", "Projeto · Kickoff"),
  l("linha", "Impostos", "110.00"),
  l("total", "Receita Liquida", "990.00"),
  l("total", "Custos Operacionais Diretos", "0.00"),
  l("linha", "Maquinas", null),
  l("total", "Lucro Bruto", "990.00"),
  l("total", "Custos Operacionais", "600.00"),
  l("linha", "Salários", "500.00"),
  l("linha", "Contabilidade (Boleto)", "100.00", "boleto"),
  l("linha", "Alimentação (cartão de credito)", null, "cartão"),
  l("linha", "Travel Meals", null, "cartão"),
  l("total", "OPBB (Oper Profit Before Bonus)", "390.00"),
  l("percentual", "OPBB %", "0.354545"),
];

const c = (mes: number, kind: "revenue" | "cost", reais: number, codigo: string, contrato?: [string, string]): LinhaDeCompetencia => ({
  mes,
  kind,
  amount: BigInt(Math.round(reais * 100)),
  codigo,
  contrato: contrato ? { nome: contrato[0], tipo: contrato[1] } : null,
});

const competencia = [
  c(SET, "revenue", 1200, "3.01", ["Gringo", "retainer"]),
  c(SET, "revenue", 300, "3.02", ["CSO", "project"]),
  c(SET, "revenue", 50, "3.02", ["Eskala", "project"]), // sem linha na planilha
  c(SET, "cost", 400, "6.10"),
  c(SET, "cost", 100, "6.11"),
  c(SET, "cost", 30, "9.03"),
  c(SET, "cost", 20, "7.99"), // conta sem linha
  c(SET + 1, "cost", 150, "4.01"), // guia paga em outubro
  c(SET + 1, "cost", 120, "8.01"), // contabilidade paga em outubro
];
const dados = montarDadosDaDre(competencia);
const achar = (linhas: LinhaPlanilha[], rotulo: string) => linhas.find((x) => x.rotulo === rotulo)!;

describe("preencherDreComApp", () => {
  it("preenche setembro quando outubro já fechou, nas mesmas linhas", () => {
    const { linhas, aguardando } = preencherDreComApp(dre, dados, [SET], SET + 1);
    expect(aguardando.size).toBe(0);
    expect(achar(linhas, "Gringo").valores[SET]).toBe("1200.00");
    expect(achar(linhas, "CSO").valores[SET]).toBe("300.00");
    expect(achar(linhas, "Outras receitas (sem linha na planilha)").valores[SET]).toBe("50.00");
    expect(achar(linhas, "Receita").valores[SET]).toBe("1550.00");
    // As deslocadas leem o mês seguinte.
    expect(achar(linhas, "Impostos").valores[SET]).toBe("150.00");
    expect(achar(linhas, "Contabilidade (Boleto)").valores[SET]).toBe("120.00");
    expect(achar(linhas, "Receita Liquida").valores[SET]).toBe("1400.00");
    expect(achar(linhas, "Salários").valores[SET]).toBe("500.00");
    // Duas linhas na mesma conta: o valor vai para a primeira, uma vez só.
    expect(achar(linhas, "Alimentação (cartão de credito)").valores[SET]).toBe("30.00");
    expect(achar(linhas, "Travel Meals").valores[SET]).toBeNull();
    expect(achar(linhas, "Outros custos (sem linha na planilha)").valores[SET]).toBe("20.00");
    // 500 + 120 + 30 + 20
    expect(achar(linhas, "Custos Operacionais").valores[SET]).toBe("670.00");
    expect(achar(linhas, "OPBB (Oper Profit Before Bonus)").valores[SET]).toBe("730.00");
    expect(achar(linhas, "OPBB %").valores[SET]).toBe("0.470967");
  });

  it("nunca sobrescreve o que a planilha tem", () => {
    const { linhas } = preencherDreComApp(dre, dados, [AGO, SET], SET + 1);
    expect(achar(linhas, "Gringo").valores[AGO]).toBe("1000.00");
    expect(achar(linhas, "Gringo").calculado[AGO]).toBe(false);
    expect(achar(linhas, "Gringo").calculado[SET]).toBe(true);
    expect(achar(linhas, "Gringo").total).toBe("2200.00");
  });

  it("sem o extrato do mês seguinte, as deslocadas e os totais que dependem delas ficam vazios", () => {
    const { linhas, aguardando } = preencherDreComApp(dre, dados, [SET], SET);
    expect(aguardando.get(SET)).toEqual(["Impostos", "Contabilidade"]);
    expect(achar(linhas, "Impostos").valores[SET]).toBeNull();
    expect(achar(linhas, "Receita").valores[SET]).toBe("1550.00");
    expect(achar(linhas, "Receita Liquida").valores[SET]).toBeNull();
    expect(achar(linhas, "Custos Operacionais").valores[SET]).toBeNull();
    expect(achar(linhas, "OPBB (Oper Profit Before Bonus)").valores[SET]).toBeNull();
    expect(achar(linhas, "OPBB %").valores[SET]).toBeNull();
    // As linhas que não dependem do mês seguinte saem mesmo assim.
    expect(achar(linhas, "Salários").valores[SET]).toBe("500.00");
  });
});
