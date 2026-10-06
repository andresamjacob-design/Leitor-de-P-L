import { describe, expect, it } from "vitest";
import type { CashFlowReport, CashFlowRow, CashFlowSection } from "@/lib/cash-flow";
import { preencherComORazao } from "@/lib/fluxo-da-planilha";
import type { LinhaPlanilha } from "@/lib/planilha";

const SOCIOS = "Sócios — pró-labore e distribuição";
const vazio = () => Array.from({ length: 12 }, () => null as string | null);
const l = (tipo: LinhaPlanilha["tipo"], rotulo: string, ago: string | null = null): LinhaPlanilha => {
  const valores = vazio();
  valores[7] = ago;
  return { ordem: 0, tipo, rotulo, detalhe: null, valores, total: ago };
};
const row = (code: string | null, label: string, ago: bigint, set: bigint): CashFlowRow => ({
  categoryId: code,
  code,
  label,
  values: [ago, set],
  total: ago + set,
});
const secao = (key: CashFlowSection["key"], rows: CashFlowRow[]): CashFlowSection => ({
  key,
  label: key,
  rows,
  totals: [0, 1].map((i) => rows.reduce((a, r) => a + (r.values[i] ?? 0n), 0n)),
  total: rows.reduce((a, r) => a + r.total, 0n),
});

// O relatório do razão para agosto e setembro (em centavos).
const entradas = secao("in", [
  row("3.01", "Suporte", 100_00n, 1000_00n),
  row("3.02", "Projeto", 0n, 500_00n),
  row(null, "Sem categoria", 0n, 7_00n),
]);
const saidas = secao("out", [
  row("6.10", "Freelancers", 0n, 300_00n),
  row(null, SOCIOS, 0n, 45_000_00n),
  row("7.01", "Gsuite", 0n, 50_00n),
  row("8.03", "Ciclo", 0n, 40_00n),
]);
const report: CashFlowReport = {
  periods: ["2026-08-01", "2026-09-01"],
  opening: [0n, 0n],
  sections: [entradas, saidas, secao("transfer", [])],
  operating: [entradas.totals[0]! - saidas.totals[0]!, entradas.totals[1]! - saidas.totals[1]!],
  net: [0n, 0n],
  closing: [1_000_00n, 999_99n],
  warnings: [],
};

const planilha: LinhaPlanilha[] = [
  l("secao", "Income"),
  l("grupo", "Sales", "100"),
  l("linha", "Receita Ongoing", "100"),
  l("linha", "Receita Projetos", "0"),
  l("total", "Total Income", "100"),
  l("secao", "Expenses"),
  l("grupo", "Pessoas", "0"),
  l("linha", "Time - Interno", "0"),
  l("linha", "Time - Freelancers", "0"),
  l("linha", "Distribuição de Lucro", "0"),
  l("grupo", "Gerais e Admnistrativos", "0"),
  l("linha", "Gsuite (cartão de credito)", "0"),
  l("total", "Total Expenses", "0"),
  l("secao", "Summary"),
  l("linha", "Inadimplencia", "0"),
  l("total", "Net savings", "100"),
  l("total", "Ending balance", "1000"),
  l("linha", "Valor Itaú", "1000"),
];

const SET = 8;
const r = preencherComORazao(planilha, report, [SET], SOCIOS);
const achar = (rotulo: string) => r.find((x) => x.rotulo === rotulo);

describe("preencherComORazao", () => {
  it("não toca no mês que a planilha tem", () => {
    expect(achar("Receita Ongoing")?.valores[7]).toBe("100");
    expect(achar("Receita Ongoing")?.calculado[7]).toBe(false);
  });

  it("preenche o mês vazio com o razão, na linha certa", () => {
    expect(achar("Receita Ongoing")?.valores[SET]).toBe("1000.00");
    expect(achar("Receita Projetos")?.valores[SET]).toBe("500.00");
    expect(achar("Gsuite (cartão de credito)")?.valores[SET]).toBe("50.00");
    expect(achar("Distribuição de Lucro")?.valores[SET]).toBe("45000.00");
    expect(achar("Receita Ongoing")?.calculado[SET]).toBe(true);
  });

  it("uma conta vai para uma linha só — Interno leva a 6.10, Freelancers fica vazia", () => {
    // 6.10 e a Ciclo (8.03), que a planilha conta dentro de Pessoas.
    expect(achar("Time - Interno")?.valores[SET]).toBe("340.00");
    expect(achar("Time - Freelancers")?.valores[SET]).toBeNull();
  });

  it("o grupo é a soma das linhas dele", () => {
    expect(achar("Sales")?.valores[SET]).toBe("1500.00");
    expect(achar("Pessoas")?.valores[SET]).toBe("45340.00");
  });

  it("o que não tem linha vira 'Outras', no nível dos grupos, e o total é o do razão", () => {
    expect(achar("Outras entradas (sem linha na planilha)")?.tipo).toBe("grupo");
    expect(achar("Outras entradas (sem linha na planilha)")?.valores[SET]).toBe("7.00");
    expect(achar("Outras saídas (sem linha na planilha)")).toBeUndefined();
    expect(achar("Total Income")?.valores[SET]).toBe("1507.00");
    expect(achar("Total Expenses")?.valores[SET]).toBe("45390.00");
  });

  it("linhas mais 'Outras' somam o total da seção, nos dois lados", () => {
    const soma = (de: string, ate: string) => {
      const i = r.findIndex((x) => x.rotulo === de);
      const j = r.findIndex((x) => x.rotulo === ate);
      return r
        .slice(i + 1, j)
        .filter((x) => x.tipo === "linha" || x.rotulo.startsWith("Outras"))
        .reduce((a, x) => a + Number(x.valores[SET] ?? 0), 0);
    };
    expect(soma("Income", "Total Income")).toBe(1507);
    expect(soma("Expenses", "Total Expenses")).toBe(45390);
  });

  it("Net savings e Ending balance vêm do razão; conferências manuais ficam vazias", () => {
    expect(achar("Net savings")?.valores[SET]).toBe("-43883.00");
    expect(achar("Ending balance")?.valores[SET]).toBe("999.99");
    expect(achar("Valor Itaú")?.valores[SET]).toBeNull();
    expect(achar("Inadimplencia")?.valores[SET]).toBeNull();
  });

  it("sem transferência que sobre, não aparece linha de transferência", () => {
    expect(achar("Transferências e saldo de abertura de conta")).toBeUndefined();
  });

  it("a abertura de conta no mês aparece antes do Ending balance (D147)", () => {
    const comAbertura: CashFlowReport = {
      ...report,
      sections: [entradas, saidas, secao("transfer", [row(null, "Saldo de abertura — GSJ", 0n, 19_000_00n)])],
    };
    const x = preencherComORazao(planilha, comAbertura, [SET], SOCIOS);
    const i = x.findIndex((y) => y.rotulo === "Transferências e saldo de abertura de conta");
    expect(x[i]?.valores[SET]).toBe("19000.00");
    expect(x[i]?.calculado[SET]).toBe(true);
    expect(x[i + 1]?.rotulo).toBe("Ending balance");
  });

  it("o total da linha passa a incluir o mês calculado", () => {
    expect(achar("Receita Ongoing")?.total).toBe("1100.00");
    // Saldo não se soma: a linha de saldo não tem total.
    expect(achar("Ending balance")?.total).toBeNull();
  });

  it("mês fora do relatório não é inventado", () => {
    const so = preencherComORazao(planilha, report, [10], SOCIOS);
    expect(so.find((x) => x.rotulo === "Receita Ongoing")?.valores[10]).toBeNull();
    expect(so.some((x) => x.rotulo.startsWith("Outras"))).toBe(false);
    expect(so.find((x) => x.rotulo === "Sales")?.valores[10]).toBeNull();
    expect(so.every((x) => x.calculado[10] === false)).toBe(true);
  });
});
