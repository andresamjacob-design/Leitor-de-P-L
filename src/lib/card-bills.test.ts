import { describe, expect, it } from "vitest";
import { quebrarFaturas, type Fatura, type Pagamento } from "@/lib/card-bills";
import { parseMoney, type Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

function pagamento(id: string, valor: string, occurredOn = "2026-05-05"): Pagamento {
  return {
    id,
    accountId: "bank",
    occurredOn: occurredOn as IsoDate,
    amount: parseMoney(valor),
  };
}

function fatura(importId: string, compras: [string, string, "in" | "out"][]): Fatura {
  return {
    importId,
    compras: compras.map(([categoryId, valor, direction]) => ({
      categoryId,
      amount: parseMoney(valor),
      direction,
    })),
  };
}

const liquido = (partes: readonly { amount: Cents; direction: "in" | "out" }[]) =>
  partes.reduce((a, p) => a + (p.direction === "out" ? p.amount : -p.amount), 0n);

describe("quebrarFaturas", () => {
  it("troca o pagamento pelas categorias das compras que ele quitou", () => {
    const p = pagamento("pg1", "1.000,00");
    const f = fatura("imp1", [
      ["gsuite", "600,00", "out"],
      ["passagem", "400,00", "out"],
    ]);

    const { substituidos, partes, semFatura } = quebrarFaturas([p], [f]);

    expect(substituidos.has("pg1")).toBe(true);
    expect(semFatura).toHaveLength(0);
    expect(partes.map((x) => x.categoryId).sort()).toEqual(["gsuite", "passagem"]);
    expect(liquido(partes)).toBe(parseMoney("1.000,00"));
  });

  it("a soma das partes é o pagamento — trocar não move o total do mês", () => {
    const p = pagamento("pg1", "9.510,89");
    const f = fatura("imp1", [
      ["a", "5.000,00", "out"],
      ["b", "4.600,89", "out"],
      ["a", "90,00", "out"],
      ["b", "180,00", "in"],
    ]);

    const { partes } = quebrarFaturas([p], [f]);

    expect(liquido(partes)).toBe(p.amount);
  });

  it("as partes ficam na data do pagamento, não na da compra", () => {
    const p = pagamento("pg1", "100,00", "2026-06-05");
    const { partes } = quebrarFaturas([p], [fatura("imp1", [["x", "100,00", "out"]])]);

    expect(partes[0]?.occurredOn).toBe("2026-06-05");
  });

  it("compras da mesma conta viram uma linha só", () => {
    const p = pagamento("pg1", "300,00");
    const f = fatura("imp1", [
      ["gsuite", "100,00", "out"],
      ["gsuite", "200,00", "out"],
    ]);

    const { partes } = quebrarFaturas([p], [f]);

    expect(partes).toHaveLength(1);
    expect(partes[0]?.amount).toBe(parseMoney("300,00"));
  });

  it("uma conta que fecha negativa na fatura vira entrada", () => {
    // Estorno maior que compra no ciclo: o banco pagou menos por causa dela.
    const p = pagamento("pg1", "700,00");
    const f = fatura("imp1", [
      ["gsuite", "1.000,00", "out"],
      ["passagem", "300,00", "in"],
    ]);

    const { partes } = quebrarFaturas([p], [f]);
    const passagem = partes.find((x) => x.categoryId === "passagem");

    expect(passagem?.direction).toBe("in");
    expect(passagem?.amount).toBe(parseMoney("300,00"));
    expect(liquido(partes)).toBe(parseMoney("700,00"));
  });

  it("uma conta que se anula dentro da fatura não vira linha", () => {
    const p = pagamento("pg1", "500,00");
    const f = fatura("imp1", [
      ["gsuite", "500,00", "out"],
      ["passagem", "80,00", "out"],
      ["passagem", "80,00", "in"],
    ]);

    const { partes } = quebrarFaturas([p], [f]);

    expect(partes.map((x) => x.categoryId)).toEqual(["gsuite"]);
  });

  it("pagamento sem fatura de valor exato fica como estava", () => {
    // O caso real: R$ 830,97 em 05/06 é a fatura de maio do 8299, que nunca foi importada.
    const p = pagamento("pg1", "830,97");
    const f = fatura("imp1", [["x", "1.000,00", "out"]]);

    const { substituidos, partes, semFatura } = quebrarFaturas([p], [f]);

    expect(substituidos.size).toBe(0);
    expect(partes).toHaveLength(0);
    expect(semFatura.map((x) => x.id)).toEqual(["pg1"]);
  });

  it("uma fatura só casa uma vez, mesmo com dois pagamentos iguais", () => {
    // Protege da reimportação: o handover conta que 9 dos 34 arquivos são a mesma fatura
    // sob outro nome. Fatura que ninguém pagou não pode entrar duas vezes.
    const a = pagamento("pg1", "100,00");
    const b = pagamento("pg2", "100,00");
    const f = fatura("imp1", [["x", "100,00", "out"]]);

    const { substituidos, semFatura, partes } = quebrarFaturas([a, b], [f]);

    expect(substituidos.size).toBe(1);
    expect(semFatura).toHaveLength(1);
    expect(liquido(partes)).toBe(parseMoney("100,00"));
  });

  it("dois pagamentos iguais com duas faturas iguais casam os dois", () => {
    const a = pagamento("pg1", "100,00");
    const b = pagamento("pg2", "100,00");
    const f1 = fatura("imp1", [["x", "100,00", "out"]]);
    const f2 = fatura("imp2", [["y", "100,00", "out"]]);

    const { substituidos, semFatura } = quebrarFaturas([a, b], [f1, f2]);

    expect(substituidos.size).toBe(2);
    expect(semFatura).toHaveLength(0);
  });

  it("compra sem conta continua sem conta", () => {
    const p = pagamento("pg1", "50,00");
    const f: Fatura = {
      importId: "imp1",
      compras: [{ categoryId: null, amount: parseMoney("50,00"), direction: "out" }],
    };

    const { partes } = quebrarFaturas([p], [f]);

    expect(partes[0]?.categoryId).toBeNull();
  });
});
