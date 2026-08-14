import { describe, expect, it } from "vitest";
import { reconcileContract, type Invoice } from "@/lib/data/invoices";
import { parseMoney } from "@/lib/money";

function invoice(servicePeriod: string, amount: string, status: Invoice["status"] = "issued"): Invoice {
  return {
    id: `nf-${servicePeriod}`,
    entityId: "e",
    clientId: "c",
    contractId: "k",
    number: "1",
    series: null,
    issueDate: servicePeriod,
    servicePeriod,
    dueDate: null,
    status,
    grossAmount: parseMoney(amount),
    netAmount: null,
    isIntercompany: false,
    notes: null,
  };
}

describe("reconcileContract", () => {
  it("põe reconhecido, faturado e recebido lado a lado por mês", () => {
    const result = reconcileContract({
      recognition: [
        { period: "2026-03-01", amount: parseMoney("10.000,00") },
        { period: "2026-04-01", amount: parseMoney("10.000,00") },
      ],
      invoices: [invoice("2026-03-01", "10.000,00")],
      receipts: [{ occurredOn: "2026-04-10", amount: parseMoney("10.000,00"), direction: "in" }],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.totals).toEqual({
      recognized: parseMoney("20.000,00"),
      invoiced: parseMoney("10.000,00"),
      received: parseMoney("10.000,00"),
    });
  });

  it("uma NF cancelada não conta como faturada", () => {
    const result = reconcileContract({
      recognition: [],
      invoices: [invoice("2026-03-01", "10.000,00", "cancelled")],
      receipts: [],
    });
    expect(result.totals.invoiced).toBe(0n);
  });

  it("um estorno recebido entra negativo, e não some", () => {
    const result = reconcileContract({
      recognition: [],
      invoices: [],
      receipts: [
        { occurredOn: "2026-03-10", amount: parseMoney("5.000,00"), direction: "in" },
        { occurredOn: "2026-03-20", amount: parseMoney("500,00"), direction: "out" },
      ],
    });
    expect(result.totals.received).toBe(parseMoney("4.500,00"));
  });

  it("o recebimento cai no mês em que o dinheiro entrou, não no da competência", () => {
    const result = reconcileContract({
      recognition: [{ period: "2026-03-01", amount: parseMoney("10.000,00") }],
      invoices: [],
      receipts: [{ occurredOn: "2026-05-08", amount: parseMoney("10.000,00"), direction: "in" }],
    });

    expect(result.rows.find((row) => row.period === "2026-03-01")?.received).toBe(0n);
    expect(result.rows.find((row) => row.period === "2026-05-01")?.received).toBe(
      parseMoney("10.000,00"),
    );
  });
});
