import { describe, expect, it } from "vitest";
import { dividirPorCliente, lerClientesManuais, lerInvoiceSalesforce } from "@/lib/import/salesforce-invoice";
import { parseMoney } from "@/lib/money";

// O texto como o leitor de PDF do projeto devolve a invoice 125 — só o que importa aqui.
const LINHAS = [
  "TO:",
  "COMPANY: Salesforce, Inc.",
  "● SFA Medika - $14,000.00",
  "● HARPIX - $7,000.00",
  "● Faculdade ITA Educacional - $7,000.00",
  "● Artium Soluções - $3,500.00",
  "Payment Due By 12-09/2026",
];

describe("lerInvoiceSalesforce", () => {
  const inv = lerInvoiceSalesforce(LINHAS, "Invoice - SF - 125 (1) (1).pdf");

  it("lê cada cliente com a parte dele, em centavos de dólar", () => {
    expect(inv.clientes).toEqual([
      { nome: "SFA Medika", usd: 1_400_000n },
      { nome: "HARPIX", usd: 700_000n },
      { nome: "Faculdade ITA Educacional", usd: 700_000n },
      { nome: "Artium Soluções", usd: 350_000n },
    ]);
  });

  it("o total é a soma da lista — o do cabeçalho é imagem", () => {
    expect(inv.totalUsd).toBe(3_150_000n);
  });

  it("vencimento no formato estranho dele, e número pelo nome do arquivo", () => {
    expect(inv.vencimento).toBe("2026-09-12");
    expect(inv.numero).toBe("125");
  });
});

describe("o formato da invoice 129", () => {
  const inv = lerInvoiceSalesforce([
    "● Touti: $3,500",
    "● Hospcom: $14,000",
    "● Audens Group: $3,500",
    "● SLK - Grupo Podpah: $3,500",
    "● Ancora - $3,500",
    "Payment Due By 22-08/2026",
  ]);

  it("dois-pontos ou traço, sem centavos, e o nome com traço dentro fica inteiro", () => {
    expect(inv.clientes.map((c) => c.nome)).toEqual(["Touti", "Hospcom", "Audens Group", "SLK - Grupo Podpah", "Ancora"]);
    expect(inv.totalUsd).toBe(2_800_000n);
    expect(inv.vencimento).toBe("2026-08-22");
  });
});

describe("lerClientesManuais", () => {
  it("lê a divisão escrita à mão, para invoice em que ela só está na imagem", () => {
    expect(lerClientesManuais("Danke=2378.55; Auddas=446.06")).toEqual([
      { nome: "Danke", usd: 237_855n },
      { nome: "Auddas", usd: 44_606n },
    ]);
  });

  it("recusa o que não entende", () => {
    expect(() => lerClientesManuais("Danke 2378")).toThrow();
  });
});

describe("dividirPorCliente", () => {
  it("R$ 5,00 por dólar divide exato", () => {
    const partes = dividirPorCliente(parseMoney("157.500,00"), lerInvoiceSalesforce(LINHAS).clientes);
    expect(partes.map((p) => p.valor)).toEqual([
      parseMoney("70.000,00"),
      parseMoney("35.000,00"),
      parseMoney("35.000,00"),
      parseMoney("17.500,00"),
    ]);
  });

  it("valor quebrado: a soma é sempre o recebido, ao centavo", () => {
    const recebido = parseMoney("151.616,13");
    const partes = dividirPorCliente(recebido, lerInvoiceSalesforce(LINHAS).clientes);
    expect(partes.reduce((a, p) => a + p.valor, 0n)).toBe(recebido);
  });
});
