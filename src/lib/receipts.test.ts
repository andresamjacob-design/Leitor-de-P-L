import { describe, expect, it } from "vitest";
import { documentKind, judgeReceipt, resolveRevenueCategory } from "@/lib/receipts";
import type { ClientContract, KnownClient, Receipt } from "@/lib/receipts";
import { parseMoney } from "@/lib/money";

const CNPJ = "12345678000199";
const CPF = "12345678901";

function contract(overrides: Partial<ClientContract> = {}): ClientContract {
  return {
    id: "ct",
    name: "Contrato",
    type: "retainer",
    revenueCategoryId: "3.01",
    monthlyValue: null,
    ...overrides,
  };
}

function client(overrides: Partial<KnownClient> = {}): KnownClient {
  return { id: "cl", name: "Cliente", contracts: [], ...overrides };
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    document: CNPJ,
    counterpartyName: "EMPRESA EXEMPLO LTDA",
    amount: parseMoney("10.000,00"),
    ...overrides,
  };
}

const nenhumCliente = new Map<string, KnownClient>();

describe("documentKind", () => {
  it("separa CNPJ, CPF e vazio pelo tamanho", () => {
    expect(documentKind(CNPJ)).toBe("cnpj");
    expect(documentKind(CPF)).toBe("cpf");
    expect(documentKind("")).toBe("vazio");
    expect(documentKind("123")).toBe("invalido");
  });
});

describe("judgeReceipt", () => {
  it("CPF nunca vira cliente — é o que mantém as devoluções do Ricardo fora da receita", () => {
    const verdict = judgeReceipt(
      receipt({ document: CPF, counterpartyName: "RICARDO DE CARVALHO CUSTODIO JUNIOR", amount: parseMoney("115.000,00") }),
      nenhumCliente,
    );
    expect(verdict).toEqual({ kind: "pessoa-fisica" });
  });

  it("sem documento não há identidade, por mais que a descrição pareça", () => {
    const verdict = judgeReceipt(
      receipt({ document: "", counterpartyName: null }),
      nenhumCliente,
    );
    expect(verdict).toEqual({ kind: "sem-identidade", reason: "sem-documento" });
  });

  it("CNPJ desconhecido vira proposta de cadastro com o nome legal do extrato", () => {
    const verdict = judgeReceipt(receipt(), nenhumCliente);
    expect(verdict).toEqual({
      kind: "cliente-novo",
      name: "EMPRESA EXEMPLO LTDA",
      document: CNPJ,
    });
  });

  it("CNPJ sem cliente e sem nome não dá para cadastrar", () => {
    const verdict = judgeReceipt(receipt({ counterpartyName: "   " }), nenhumCliente);
    expect(verdict).toEqual({ kind: "sem-identidade", reason: "sem-documento" });
  });

  it("CNPJ conhecido liga o cliente", () => {
    const conhecidos = new Map([[CNPJ, client({ id: "hold", name: "Hold Beauty" })]]);
    const verdict = judgeReceipt(receipt(), conhecidos);
    expect(verdict).toMatchObject({
      kind: "cliente-conhecido",
      clientId: "hold",
      clientName: "Hold Beauty",
      categoryId: null,
      basis: "sem-contrato",
    });
  });
});

describe("resolveRevenueCategory", () => {
  it("contratos todos na mesma conta decidem sozinhos", () => {
    const alvo = client({
      contracts: [
        contract({ id: "a", revenueCategoryId: "3.01" }),
        contract({ id: "b", revenueCategoryId: "3.01" }),
      ],
    });
    expect(resolveRevenueCategory(alvo, parseMoney("1,00"))).toEqual({
      categoryId: "3.01",
      basis: "conta-unica",
    });
  });

  it("projeto e retainer juntos são ambíguos, e ambiguidade não propõe", () => {
    // É o caso de Hold Beauty, PDG IT, Hogrefe e CSO, que o handover já apontava.
    const alvo = client({
      contracts: [
        contract({ id: "proj", type: "project", revenueCategoryId: "3.02", monthlyValue: parseMoney("10.000,00") }),
        contract({ id: "ret", type: "retainer", revenueCategoryId: "3.01", monthlyValue: parseMoney("4.000,00") }),
      ],
    });
    expect(resolveRevenueCategory(alvo, parseMoney("15.000,00"))).toEqual({
      categoryId: null,
      basis: "ambiguo",
    });
  });

  it("o valor desempata quando bate com a mensalidade de um contrato só", () => {
    // PDG IT recebendo exatamente os R$ 4.000 do retainer em 13/07.
    const alvo = client({
      contracts: [
        contract({ id: "proj", type: "project", revenueCategoryId: "3.02", monthlyValue: parseMoney("10.000,00") }),
        contract({ id: "ret", type: "retainer", revenueCategoryId: "3.01", monthlyValue: parseMoney("4.000,00") }),
      ],
    });
    expect(resolveRevenueCategory(alvo, parseMoney("4.000,00"))).toEqual({
      categoryId: "3.01",
      basis: "valor-bate-com-mensalidade",
    });
  });

  it("dois contratos com a mesma mensalidade não desempatam nada", () => {
    const alvo = client({
      contracts: [
        contract({ id: "a", revenueCategoryId: "3.01", monthlyValue: parseMoney("5.000,00") }),
        contract({ id: "b", revenueCategoryId: "3.02", monthlyValue: parseMoney("5.000,00") }),
      ],
    });
    expect(resolveRevenueCategory(alvo, parseMoney("5.000,00")).basis).toBe("ambiguo");
  });

  it("contrato sem mensalidade não é candidato a desempate", () => {
    const alvo = client({
      contracts: [
        contract({ id: "a", revenueCategoryId: "3.01", monthlyValue: null }),
        contract({ id: "b", revenueCategoryId: "3.02", monthlyValue: parseMoney("9.000,00") }),
      ],
    });
    expect(resolveRevenueCategory(alvo, parseMoney("0,00")).basis).toBe("ambiguo");
  });

  it("cliente sem contrato não recebe conta chutada", () => {
    expect(resolveRevenueCategory(client(), parseMoney("1,00"))).toEqual({
      categoryId: null,
      basis: "sem-contrato",
    });
  });
});
