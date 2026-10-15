import { describe, expect, it } from "vitest";
import { conferir, historicoDosMeses, valorNoMes, type ValorFolha } from "@/lib/folha";

const MESES = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);
const c = (reais: number) => BigInt(Math.round(reais * 100));

describe("valorNoMes", () => {
  const h: ValorFolha[] = [
    { mes: "2026-01-01", valor: c(8000), tipo: "vigente" },
    { mes: "2026-06-01", valor: c(9000), tipo: "vigente" },
    { mes: "2026-03-01", valor: c(4000), tipo: "so_no_mes" },
  ];

  it("o vigente repete nos meses seguintes, até o próximo", () => {
    expect(valorNoMes(h, "2026-02-01")).toBe(c(8000));
    expect(valorNoMes(h, "2026-05-01")).toBe(c(8000));
    expect(valorNoMes(h, "2026-06-01")).toBe(c(9000));
    expect(valorNoMes(h, "2026-12-01")).toBe(c(9000));
  });

  it("o valor só deste mês passa por cima e não vaza para o seguinte", () => {
    expect(valorNoMes(h, "2026-03-01")).toBe(c(4000));
    expect(valorNoMes(h, "2026-04-01")).toBe(c(8000));
  });

  it("antes do primeiro vigente é zero", () => {
    expect(valorNoMes([{ mes: "2026-04-01", valor: c(5000), tipo: "vigente" }], "2026-02-01")).toBe(0n);
  });
});

describe("historicoDosMeses", () => {
  const casos: Record<string, number[]> = {
    "salário fixo o ano inteiro": [8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000],
    "aumento em junho": [8000, 8000, 8000, 8000, 8000, 9000, 9000, 9000, 9000, 9000, 9000, 9000],
    "entra quebrado em março": [0, 0, 5333.33, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000],
    "sai quebrado em agosto": [8000, 8000, 8000, 8000, 8000, 8000, 8000, 2666.67, 0, 0, 0, 0],
    "entra e sai": [0, 4000, 6000, 6000, 1500, 0, 0, 0, 0, 0, 0, 0],
    "muda em dezembro": [8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 9500],
  };

  for (const [nome, reais] of Object.entries(casos)) {
    it(`${nome}: reconstrói cada mês exatamente`, () => {
      const valores = reais.map(c);
      expect(conferir(MESES, valores, historicoDosMeses(MESES, valores))).toEqual([]);
    });
  }

  it("o mês quebrado de entrada vira 'só neste mês', e o salário cheio vira vigente", () => {
    const h = historicoDosMeses(MESES, casos["entra quebrado em março"]!.map(c));
    expect(h).toEqual([
      { mes: "2026-03-01", valor: c(5333.33), tipo: "so_no_mes" },
      { mes: "2026-04-01", valor: c(8000), tipo: "vigente" },
    ]);
  });

  it("um aumento é um vigente só", () => {
    expect(historicoDosMeses(MESES, casos["aumento em junho"]!.map(c))).toEqual([
      { mes: "2026-01-01", valor: c(8000), tipo: "vigente" },
      { mes: "2026-06-01", valor: c(9000), tipo: "vigente" },
    ]);
  });
});
