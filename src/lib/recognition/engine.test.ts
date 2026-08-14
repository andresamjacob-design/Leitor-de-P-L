import { describe, expect, it } from "vitest";
import {
  contractPeriods,
  deferredRevenue,
  planContract,
  type PocReport,
  type RecognitionContract,
} from "@/lib/recognition/engine";
import { parsePercent } from "@/lib/recognition/percent";
import { formatMoney, parseMoney, sum } from "@/lib/money";

function contract(overrides: Partial<RecognitionContract> = {}): RecognitionContract {
  return {
    id: "c1",
    clientId: "cliente",
    categoryId: "receita",
    type: "project",
    status: "active",
    totalValue: parseMoney("50.000,00"),
    monthlyValue: null,
    startDate: "2026-03-01",
    endDate: "2026-07-31",
    recognitionMethod: "poc",
    prorateFirstLastMonth: true,
    isIntercompany: false,
    ...overrides,
  };
}

function poc(period: string, percent: string, isCorrection = false): PocReport {
  return { period, cumulative: parsePercent(percent), isCorrection };
}

// ---------------------------------------------------------------------------
// SPEC §11, com os números exatos da especificação
// ---------------------------------------------------------------------------

describe("§11.1 — receita diferida de um projeto de R$ 50.000 em 5 meses", () => {
  const reports = [
    poc("2026-03-01", "20"),
    poc("2026-04-01", "40"),
    poc("2026-05-01", "60"),
    poc("2026-06-01", "80"),
    poc("2026-07-01", "100"),
  ];
  const plan = planContract(contract(), { through: "2026-07-01", pocReports: reports });

  it("reconhece R$ 10.000 em cada um dos cinco meses", () => {
    expect(plan.rows).toHaveLength(5);
    for (const row of plan.rows) {
      expect(formatMoney(row.amount)).toBe("10.000,00");
    }
    expect(plan.rows.map((row) => row.period)).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
    ]);
  });

  it("a receita diferida depois de março é R$ 40.000", () => {
    const throughMarch = planContract(contract(), {
      through: "2026-03-01",
      pocReports: [poc("2026-03-01", "20")],
    });
    expect(deferredRevenue(contract(), throughMarch.rows).deferred).toBe(
      parseMoney("40.000,00"),
    );
  });

  it("depois de julho é zero", () => {
    expect(deferredRevenue(contract(), plan.rows).deferred).toBe(0n);
  });

  it("a soma reconhecida é exatamente o valor do contrato", () => {
    expect(sum(plan.rows.map((row) => row.amount))).toBe(parseMoney("50.000,00"));
  });
});

describe("§11.2 — correção de POC (reescrito pela D-E)", () => {
  // O teste original referencia fevereiro num contrato que começa em março. Reescrito
  // com início em 01/02/2026, mantendo os números da spec.
  const project = contract({ startDate: "2026-02-01", endDate: "2026-06-30" });
  const plan = planContract(project, {
    through: "2026-03-01",
    pocReports: [poc("2026-02-01", "30"), poc("2026-03-01", "25", true)],
  });

  it("fevereiro reconhece R$ 15.000", () => {
    expect(formatMoney(plan.rows[0]?.amount ?? 0n)).toBe("15.000,00");
  });

  it("março reconhece −R$ 2.500", () => {
    expect(formatMoney(plan.rows[1]?.amount ?? 0n)).toBe("-2.500,00");
    expect(plan.rows[1]?.basis).toBe("correção de POC");
  });

  it("o acumulado fica em R$ 12.500 e a linha de fevereiro não é tocada", () => {
    expect(sum(plan.rows.map((row) => row.amount))).toBe(parseMoney("12.500,00"));
    expect(plan.rows[0]?.period).toBe("2026-02-01");
    expect(formatMoney(plan.rows[0]?.amount ?? 0n)).toBe("15.000,00");
  });

  it("uma queda sem a marca de correção passa, mas avisa", () => {
    const semMarca = planContract(project, {
      through: "2026-03-01",
      pocReports: [poc("2026-02-01", "30"), poc("2026-03-01", "25")],
    });
    expect(semMarca.warnings[0]).toContain("correção");
  });
});

describe("§11.3 — proração de retainer", () => {
  const retainer = contract({
    type: "retainer",
    recognitionMethod: "straight_line",
    totalValue: null,
    monthlyValue: parseMoney("6.000,00"),
    startDate: "2026-04-15",
    endDate: null,
  });

  const plan = planContract(retainer, { through: "2026-06-01" });

  it("abril reconhece R$ 3.200 — 16 dos 30 dias", () => {
    expect(formatMoney(plan.rows[0]?.amount ?? 0n)).toBe("3.200,00");
    expect(plan.rows[0]?.basis).toBe("16/30 dias do mês");
  });

  it("maio em diante reconhece R$ 6.000", () => {
    expect(formatMoney(plan.rows[1]?.amount ?? 0n)).toBe("6.000,00");
    expect(formatMoney(plan.rows[2]?.amount ?? 0n)).toBe("6.000,00");
  });

  it("com “mês cheio” ligado, abril também reconhece R$ 6.000", () => {
    const cheio = planContract({ ...retainer, prorateFirstLastMonth: false }, {
      through: "2026-06-01",
    });
    expect(formatMoney(cheio.rows[0]?.amount ?? 0n)).toBe("6.000,00");
  });
});

// ---------------------------------------------------------------------------
// Comportamento do motor
// ---------------------------------------------------------------------------

describe("retainer sem data de fim", () => {
  it("reconhece enquanto está ativo, até o mês consultado", () => {
    const plan = planContract(
      contract({
        type: "retainer",
        recognitionMethod: "straight_line",
        totalValue: null,
        monthlyValue: parseMoney("7.500,00"),
        startDate: "2026-01-01",
        endDate: null,
      }),
      { through: "2026-04-01" },
    );

    expect(plan.rows).toHaveLength(4);
    expect(sum(plan.rows.map((row) => row.amount))).toBe(parseMoney("30.000,00"));
  });

  it("não tem receita diferida, porque não tem total contratado", () => {
    const aberto = contract({
      type: "retainer",
      recognitionMethod: "straight_line",
      totalValue: null,
      monthlyValue: parseMoney("7.500,00"),
      endDate: null,
    });
    expect(deferredRevenue(aberto, []).deferred).toBeNull();
  });
});

describe("valor total distribuído em linha reta", () => {
  it("distribui sem perder centavo, mesmo quando não divide", () => {
    const plan = planContract(
      contract({
        recognitionMethod: "straight_line",
        totalValue: parseMoney("10.000,00"),
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        prorateFirstLastMonth: false,
      }),
      { through: "2026-03-01" },
    );

    expect(sum(plan.rows.map((row) => row.amount))).toBe(parseMoney("10.000,00"));
    expect(plan.rows.map((row) => formatMoney(row.amount))).toEqual([
      "3.333,34",
      "3.333,33",
      "3.333,33",
    ]);
  });

  it("meses parciais pesam pelos dias que cobrem", () => {
    const plan = planContract(
      contract({
        recognitionMethod: "straight_line",
        totalValue: parseMoney("10.000,00"),
        startDate: "2026-01-16",
        endDate: "2026-03-31",
      }),
      { through: "2026-03-01" },
    );

    expect(sum(plan.rows.map((row) => row.amount))).toBe(parseMoney("10.000,00"));
    // Janeiro cobre 16 de 31 dias; fevereiro e março, inteiros.
    expect(plan.rows[0]?.amount).toBeLessThan(plan.rows[1]?.amount ?? 0n);
  });
});

describe("mês sem reporte de POC", () => {
  it("não reconhece nada e entra na lista de relatórios faltando", () => {
    const plan = planContract(contract(), {
      through: "2026-05-01",
      pocReports: [poc("2026-03-01", "20"), poc("2026-05-01", "50")],
    });

    expect(plan.rows).toHaveLength(2);
    expect(plan.missingReports).toContain("2026-04-01");
    expect(formatMoney(plan.rows[1]?.amount ?? 0n)).toBe("15.000,00");
  });
});

describe("encerrar o projeto", () => {
  it("reconhece o saldo que faltava no mês do encerramento", () => {
    const plan = planContract(contract({ status: "completed" }), {
      through: "2026-07-01",
      pocReports: [poc("2026-03-01", "20"), poc("2026-04-01", "60")],
    });

    expect(sum(plan.rows.map((row) => row.amount))).toBe(parseMoney("50.000,00"));
    const closing = plan.rows[plan.rows.length - 1];
    expect(closing?.basis).toContain("encerramento");
    expect(formatMoney(closing?.amount ?? 0n)).toBe("20.000,00");
  });

  it("um projeto já em 100% não ganha linha de encerramento", () => {
    const plan = planContract(contract({ status: "completed" }), {
      through: "2026-07-01",
      pocReports: [poc("2026-03-01", "100")],
    });
    expect(plan.rows).toHaveLength(1);
  });
});

describe("estados que não geram nada", () => {
  it("rascunho não reconhece — um humano tem que confirmar antes (SPEC §9)", () => {
    const plan = planContract(contract({ status: "draft" }), { through: "2026-07-01" });
    expect(plan.rows).toHaveLength(0);
    expect(plan.warnings[0]).toContain("rascunho");
  });

  it("cancelado não reconhece", () => {
    expect(planContract(contract({ status: "cancelled" }), { through: "2026-07-01" }).rows)
      .toHaveLength(0);
  });

  it("reconhecimento manual não é gerado pelo motor", () => {
    const plan = planContract(contract({ recognitionMethod: "manual" }), {
      through: "2026-07-01",
    });
    expect(plan.rows).toHaveLength(0);
    expect(plan.warnings[0]).toContain("manual");
  });

  it("sem data de início não há o que distribuir", () => {
    expect(planContract(contract({ startDate: null }), { through: "2026-07-01" }).rows)
      .toHaveLength(0);
  });

  it("valor total sem data de fim pede a data em vez de adivinhar o prazo", () => {
    const plan = planContract(
      contract({ recognitionMethod: "straight_line", endDate: null }),
      { through: "2026-07-01" },
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.warnings[0]).toContain("data de fim");
  });
});

describe("idempotência", () => {
  it("rodar duas vezes dá exatamente o mesmo plano", () => {
    const input = { through: "2026-07-01", pocReports: [poc("2026-03-01", "20")] };
    expect(planContract(contract(), input)).toEqual(planContract(contract(), input));
  });
});

describe("contractPeriods", () => {
  it("para no fim do contrato, mesmo consultando depois", () => {
    expect(contractPeriods(contract(), "2026-12-01")).toHaveLength(5);
  });

  it("para no mês consultado quando o contrato é aberto", () => {
    const aberto = contract({ endDate: null });
    expect(contractPeriods(aberto, "2026-05-01")).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);
  });

  it("um contrato que ainda não começou não tem período nenhum", () => {
    expect(contractPeriods(contract(), "2026-01-01")).toHaveLength(0);
  });
});
