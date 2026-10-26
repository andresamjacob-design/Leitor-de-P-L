import { describe, expect, it } from "vitest";
import { groupCashFlowRows, SOCIOS_LABEL } from "@/lib/data/cash-flow-report";
import type { CashFlowRow } from "@/lib/cash-flow";

function row(code: string | null, label: string, values: number[]): CashFlowRow {
  const cents = values.map((v) => BigInt(v));
  return {
    categoryId: code,
    code,
    label,
    values: cents,
    total: cents.reduce((a, b) => a + b, 0n),
  };
}

describe("groupCashFlowRows", () => {
  it("agrupa por código, na ordem da aba Expenses — não na ordem em que as linhas chegam", () => {
    const rows = [
      row("4.01", "Impostos sobre a receita", [100, 0]),
      row("6.10", "Freelancers", [500, 500]),
    ];

    const { groups } = groupCashFlowRows(rows, 2);

    expect(groups.map((g) => g.label)).toEqual(["Pessoas", "Imposto"]);
  });

  it("o total do grupo é a soma das linhas que já existiam, não um número novo", () => {
    const rows = [
      row("7.01", "Google Workspace", [100, 200]),
      row("7.02", "Salesforce", [50, 0]),
    ];

    const { groups } = groupCashFlowRows(rows, 2);
    const gerais = groups.find((g) => g.label === "Gerais e Admnistrativos");

    expect(gerais?.rows).toHaveLength(2);
    expect(gerais?.totals).toEqual([150n, 200n]);
    expect(gerais?.total).toBe(350n);
  });

  it("a linha de sócios (D112, sem code) entra em Pessoas pelo rótulo", () => {
    const rows = [row(null, SOCIOS_LABEL, [1000, 1000])];

    const { groups, ungrouped } = groupCashFlowRows(rows, 2);

    expect(ungrouped).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Pessoas");
    expect(groups[0]?.total).toBe(2000n);
  });

  it("código sem grupo conhecido não desaparece — cai em ungrouped", () => {
    const rows = [row("99.02", "Pagamento de fatura de cartão", [830])];

    const { groups, ungrouped } = groupCashFlowRows(rows, 1);

    expect(groups).toHaveLength(0);
    expect(ungrouped).toEqual(rows);
  });

  it("linha sem categoria (code null, sem ser a de sócios) também cai em ungrouped", () => {
    const rows = [row(null, "Sem categoria", [42])];

    const { ungrouped } = groupCashFlowRows(rows, 1);

    expect(ungrouped).toEqual(rows);
  });

  it("Alimentação (9.03) vai para Cost of Goods/Cost of Services, nunca Travel (D106)", () => {
    const rows = [row("9.03", "Alimentação", [70])];

    const { groups } = groupCashFlowRows(rows, 1);

    expect(groups[0]?.label).toBe("Cost of Goods/Cost of Services");
  });

  it("Agência (8.03) vai para Pessoas, mesmo sem linha na aba Colaboradores", () => {
    const rows = [row("8.03", "Agência", [4000])];

    const { groups } = groupCashFlowRows(rows, 1);

    expect(groups[0]?.label).toBe("Pessoas");
  });
});
