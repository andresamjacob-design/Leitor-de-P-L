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
    startDate: null,
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
    occurredOn: "2026-06-15",
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
    expect(resolveRevenueCategory(alvo, parseMoney("1,00"), "2026-06-15")).toEqual({
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
    expect(resolveRevenueCategory(alvo, parseMoney("15.000,00"), "2026-06-15")).toEqual({
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
    expect(resolveRevenueCategory(alvo, parseMoney("4.000,00"), "2026-06-15")).toEqual({
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
    expect(resolveRevenueCategory(alvo, parseMoney("5.000,00"), "2026-06-15").basis).toBe("ambiguo");
  });

  it("contrato sem mensalidade não é candidato a desempate", () => {
    const alvo = client({
      contracts: [
        contract({ id: "a", revenueCategoryId: "3.01", monthlyValue: null }),
        contract({ id: "b", revenueCategoryId: "3.02", monthlyValue: parseMoney("9.000,00") }),
      ],
    });
    expect(resolveRevenueCategory(alvo, parseMoney("0,00"), "2026-06-15").basis).toBe("ambiguo");
  });

  it("cliente sem contrato não recebe conta chutada", () => {
    expect(resolveRevenueCategory(client(), parseMoney("1,00"), "2026-06-15")).toEqual({
      categoryId: null,
      basis: "sem-contrato",
    });
  });
});

describe("vigência: dinheiro não paga contrato que ainda não existia", () => {
  it("Hogrefe em 16/06 só pode ser projeto — o retainer dela começa em 01/07", () => {
    const hogrefe = client({
      contracts: [
        contract({
          id: "proj",
          type: "project",
          revenueCategoryId: "3.02",
          monthlyValue: parseMoney("8.333,33"),
          startDate: "2026-05-01",
        }),
        contract({
          id: "ret",
          type: "retainer",
          revenueCategoryId: "3.01",
          monthlyValue: null,
          startDate: "2026-07-01",
        }),
      ],
    });

    expect(resolveRevenueCategory(hogrefe, parseMoney("10.000,00"), "2026-06-16")).toEqual({
      categoryId: "3.02",
      basis: "unico-contrato-vigente",
    });
  });

  it("mas em 16/07 os dois já valem, e volta a ser ambíguo", () => {
    const hogrefe = client({
      contracts: [
        contract({ id: "proj", type: "project", revenueCategoryId: "3.02", startDate: "2026-05-01" }),
        contract({ id: "ret", type: "retainer", revenueCategoryId: "3.01", startDate: "2026-07-01" }),
      ],
    });

    expect(resolveRevenueCategory(hogrefe, parseMoney("10.000,00"), "2026-07-16").basis).toBe(
      "ambiguo",
    );
  });

  it("CSO em 06/02 é projeto: o retainer dela só começa em 01/06", () => {
    const cso = client({
      contracts: [
        contract({
          id: "proj",
          type: "project",
          revenueCategoryId: "3.02",
          monthlyValue: parseMoney("9.600,00"),
          startDate: "2026-01-01",
        }),
        contract({
          id: "ret",
          type: "retainer",
          revenueCategoryId: "3.01",
          monthlyValue: parseMoney("3.000,00"),
          startDate: "2026-06-01",
        }),
      ],
    });

    // Repare que R$ 8.000 não bate com nenhuma mensalidade — só a vigência resolve.
    expect(resolveRevenueCategory(cso, parseMoney("8.000,00"), "2026-02-06")).toEqual({
      categoryId: "3.02",
      basis: "unico-contrato-vigente",
    });
  });

  it("contrato sem data de início não é descartado — não declarar não é não valer", () => {
    const alvo = client({
      contracts: [
        contract({ id: "a", revenueCategoryId: "3.01", startDate: null }),
        contract({ id: "b", revenueCategoryId: "3.02", startDate: "2026-07-01" }),
      ],
    });

    expect(resolveRevenueCategory(alvo, parseMoney("1,00"), "2026-02-01")).toEqual({
      categoryId: "3.01",
      basis: "unico-contrato-vigente",
    });
  });

  it("recebimento anterior a todos os contratos não elimina nada", () => {
    // Zero vigentes: descartar tudo devolveria uma resposta inventada.
    const alvo = client({
      contracts: [
        contract({ id: "a", revenueCategoryId: "3.01", startDate: "2026-06-01" }),
        contract({ id: "b", revenueCategoryId: "3.02", startDate: "2026-07-01" }),
      ],
    });

    expect(resolveRevenueCategory(alvo, parseMoney("1,00"), "2026-01-01").basis).toBe("ambiguo");
  });

  it("a vigência vem antes do valor, porque é impossibilidade e não probabilidade", () => {
    // O valor bateria com a mensalidade do retainer, mas o retainer nem tinha começado.
    const alvo = client({
      contracts: [
        contract({
          id: "proj",
          type: "project",
          revenueCategoryId: "3.02",
          monthlyValue: parseMoney("10.000,00"),
          startDate: "2026-01-01",
        }),
        contract({
          id: "ret",
          type: "retainer",
          revenueCategoryId: "3.01",
          monthlyValue: parseMoney("4.000,00"),
          startDate: "2026-09-01",
        }),
      ],
    });

    expect(resolveRevenueCategory(alvo, parseMoney("4.000,00"), "2026-03-01")).toEqual({
      categoryId: "3.02",
      basis: "unico-contrato-vigente",
    });
  });
});
