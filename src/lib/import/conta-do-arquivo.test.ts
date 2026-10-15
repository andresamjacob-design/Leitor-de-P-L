import { describe, expect, it } from "vitest";
import { contaDoArquivo, type ContaCandidata } from "@/lib/import/conta-do-arquivo";

/** As contas como estão cadastradas na DD Group. */
const CONTAS: ContaCandidata[] = [
  { id: "contab", name: "Contabilizei — conta corrente", type: "bank", number: "3111117-6", lastDigits: null },
  { id: "itau", name: "Itaú — conta corrente", type: "bank", number: "0098873-4", lastDigits: "8873" },
  { id: "c8299", name: "Itaucard — final 8299", type: "credit_card", number: null, lastDigits: "8299" },
  {
    id: "c5780",
    name: "Itaucard Empresas — final 5780",
    type: "credit_card",
    number: "5336.XXXX.XXXX.5780",
    lastDigits: "5780",
  },
  { id: "cdb", name: "Itaú — CDB DI", type: "investment", number: null, lastDigits: null },
];

const conta = (r: ReturnType<typeof contaDoArquivo>) => (r.ok ? r.conta.id : r.motivo);

describe("contaDoArquivo — extrato", () => {
  it("acha a conta corrente pelo número impresso no extrato", () => {
    expect(conta(contaDoArquivo({ tipo: "extrato", conta: "0098873-4" }, CONTAS))).toBe("itau");
  });

  it("ignora zero à esquerda e pontuação", () => {
    expect(conta(contaDoArquivo({ tipo: "extrato", conta: "98873-4" }, CONTAS))).toBe("itau");
  });

  it("acha a Contabilizei pelo número dela, mesmo inativa", () => {
    expect(conta(contaDoArquivo({ tipo: "extrato", conta: "3111117-6" }, CONTAS))).toBe("contab");
  });

  it("não decide quando nenhuma conta tem o número — e diz o que fazer", () => {
    const r = contaDoArquivo({ tipo: "extrato", conta: "12345-6" }, CONTAS);
    expect(r.ok).toBe(false);
    expect(conta(r)).toMatch(/12345-6.*Cadastre/);
  });

  it("não decide quando o extrato não diz o número", () => {
    expect(contaDoArquivo({ tipo: "extrato", conta: null }, CONTAS).ok).toBe(false);
  });

  it("extrato nunca vai para conta de cartão, mesmo com o mesmo número", () => {
    const comCartao = [
      ...CONTAS,
      { id: "x", name: "cartão", type: "credit_card" as const, number: "0098873-4", lastDigits: null },
    ];
    expect(conta(contaDoArquivo({ tipo: "extrato", conta: "0098873-4" }, comCartao))).toBe("itau");
  });
});

describe("contaDoArquivo — fatura", () => {
  it("acha o cartão pelo final da conta de cobrança", () => {
    const r = contaDoArquivo({ tipo: "fatura", finalDaConta: "5780", finaisDosCartoes: ["2227"] }, CONTAS);
    expect(conta(r)).toBe("c5780");
  });

  it("acha pelo final do cartão quando a conta de cobrança tem outro número (8384 → 8299)", () => {
    const r = contaDoArquivo({ tipo: "fatura", finalDaConta: "8384", finaisDosCartoes: ["8299"] }, CONTAS);
    expect(conta(r)).toBe("c8299");
  });

  it("fatura nunca vai para conta corrente", () => {
    const r = contaDoArquivo({ tipo: "fatura", finalDaConta: "8873", finaisDosCartoes: [] }, CONTAS);
    expect(r.ok).toBe(false);
  });

  it("PDF que não é fatura nem extrato é recusado com o motivo", () => {
    const r = contaDoArquivo({ tipo: "fatura", finalDaConta: null, finaisDosCartoes: [] }, CONTAS);
    expect(conta(r)).toMatch(/não reconheci/);
  });

  it("dois cartões batendo é motivo para não decidir, não para chutar", () => {
    const r = contaDoArquivo(
      { tipo: "fatura", finalDaConta: "5780", finaisDosCartoes: ["8299"] },
      CONTAS,
    );
    expect(r.ok).toBe(false);
    expect(conta(r)).toMatch(/mais de um cartão/);
  });
});
