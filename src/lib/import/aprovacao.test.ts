import { describe, expect, it } from "vitest";
import { decidirAprovacao, saldoDeConferencia } from "@/lib/import/aprovacao";

const r = (v: number) => BigInt(Math.round(v * 100));
const linha = (dia: string, valor: number, direction: "in" | "out") => ({
  occurredOn: `2026-09-${dia}`,
  amount: r(valor),
  direction,
});

describe("decidirAprovacao", () => {
  it("extrato que fecha com o saldo do banco vai sozinho", () => {
    // Razão em 31/08: 177.798,72. Entra 10.000, sai 2.500 → 185.298,72, o que o extrato diz.
    const d = decidirAprovacao({
      conta: "caixa",
      saldoNoRazao: r(177798.72),
      fechamento: { data: "2026-09-24", saldo: r(185298.72) },
      novas: [linha("05", 10000, "in"), linha("10", 2500, "out")],
    });
    expect(d).toEqual({ aprovar: true });
  });

  it("uma linha a mais no app segura o arquivo e diz quanto", () => {
    // O caso conhecido: o boleto de R$ 8.300 que o razão guarda partido em dois.
    const d = decidirAprovacao({
      conta: "caixa",
      saldoNoRazao: r(111399.72),
      // O boleto é anterior ao fechamento — no caso real, 15/06 num extrato até 25/08.
      fechamento: { data: "2026-09-25", saldo: r(111399.72) },
      novas: [linha("15", 8300, "in")],
    });
    expect(d.aprovar).toBe(false);
    if (!d.aprovar) {
      expect(d.diferenca).toBe(-r(8300));
      expect(d.motivo).toMatch(/R\$ 8\.300,00 a mais no app/);
    }
  });

  it("uma linha faltando também segura", () => {
    const d = decidirAprovacao({
      conta: "caixa",
      saldoNoRazao: r(1000),
      fechamento: { data: "2026-09-24", saldo: r(1500) },
      novas: [linha("05", 200, "in")],
    });
    expect(d.aprovar).toBe(false);
    if (!d.aprovar) expect(d.motivo).toMatch(/a menos no app/);
  });

  it("um centavo de diferença já segura — banco é ao centavo", () => {
    const d = decidirAprovacao({
      conta: "caixa",
      saldoNoRazao: r(1000),
      fechamento: { data: "2026-09-24", saldo: r(1100.01) },
      novas: [linha("05", 100, "in")],
    });
    expect(d.aprovar).toBe(false);
  });

  it("extrato sem saldo declarado não vai sozinho", () => {
    const d = decidirAprovacao({
      conta: "caixa",
      saldoNoRazao: r(1000),
      fechamento: null,
      novas: [linha("05", 100, "in")],
    });
    expect(d.aprovar).toBe(false);
  });

  it("fatura vai sozinha — o total dela já foi conferido na leitura", () => {
    expect(
      decidirAprovacao({ conta: "cartao", saldoNoRazao: null, fechamento: null, novas: [linha("05", 50, "out")] }),
    ).toEqual({ aprovar: true });
  });

  it("arquivo sem linha nova não tem o que segurar", () => {
    expect(
      decidirAprovacao({ conta: "caixa", saldoNoRazao: r(1), fechamento: null, novas: [] }),
    ).toEqual({ aprovar: true });
  });
});

describe("saldoDeConferencia", () => {
  it("usa o fechamento do dia, não a fotografia da exportação", () => {
    // O extrato de 24/09: fotografia 264.177,45 em 24/09, fechamento 264.170,37 em 22/09.
    expect(
      saldoDeConferencia([
        { date: "2026-09-24", balance: r(264177.45), label: "SALDO EM CONTA CORRENTE" },
        { date: "2026-09-22", balance: r(264170.37), label: "SALDO TOTAL DISPONÍVEL DIA" },
        { date: "2026-09-21", balance: r(266095.09), label: "SALDO TOTAL DISPONÍVEL DIA" },
      ]),
    ).toEqual({ data: "2026-09-22", saldo: r(264170.37) });
  });

  it("sem saldo de fechamento, não há o que conferir", () => {
    expect(
      saldoDeConferencia([{ date: "2026-09-24", balance: r(1), label: "SALDO EM CONTA CORRENTE" }]),
    ).toBeNull();
  });
});

describe("decidirAprovacao — linhas depois do dia conferido", () => {
  it("não entram na conta do saldo, porque o banco ainda não fechou o dia delas", () => {
    const d = decidirAprovacao({
      conta: "caixa",
      saldoNoRazao: r(1000),
      fechamento: { data: "2026-09-22", saldo: r(1100) },
      novas: [linha("20", 100, "in"), linha("24", 999, "out")],
    });
    expect(d).toEqual({ aprovar: true });
  });
});
