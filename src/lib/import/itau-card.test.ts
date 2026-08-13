import { describe, expect, it } from "vitest";
import { parseItauCardInvoice, reconcileCardInvoice } from "@/lib/import/itau-card";
import { parseMoney } from "@/lib/money";
import type { PdfPage, PositionedItem } from "@/lib/import/layout";

const LEFT = 148;
const DESCRIPTION = 175;
const AMOUNT = 316;
const RIGHT = 364;

function at(x: number, y: number, text: string): PositionedItem {
  return { x, y, text, width: 30 };
}

/** A transaction as the invoice prints it: date, establishment, amount. */
function charge(y: number, date: string, name: string, amount: string): PositionedItem[] {
  return [at(LEFT, y, date), at(DESCRIPTION, y, name), at(AMOUNT, y, amount)];
}

function invoice(body: PositionedItem[], rightColumn: PositionedItem[] = []): PdfPage[] {
  const header = [
    at(LEFT, 900, "Numero da conta 5336.XXXX.XXXX.5780"),
    at(LEFT, 890, "Empresa DYNAMICS DATA CONSULTING TECNO"),
    at(LEFT, 880, "Vencimento: 05/02/2026"),
    at(LEFT, 870, "Emissão: 25/01/2026"),
    at(LEFT, 860, "= Total desta fatura 11.431,98"),
  ];
  // Enough text on the right to make the second column real (4% of the document).
  const filler = Array.from({ length: 12 }, (_, index) =>
    at(RIGHT, 1000 + index * 10, `nota ${index}`),
  );
  return [{ number: 1, items: [...header, ...body, ...rightColumn, ...filler] }];
}

describe("parseItauCardInvoice", () => {
  it("lê a conta, a empresa e as datas de dentro do PDF, nunca do nome do arquivo", () => {
    const parse = parseItauCardInvoice(invoice([]));
    expect(parse.source.account).toBe("5336.XXXX.XXXX.5780");
    expect(parse.source.accountLastDigits).toBe("5780");
    expect(parse.source.holder).toContain("DYNAMICS DATA");
    expect(parse.dueDate).toBe("2026-02-05");
    expect(parse.issueDate).toBe("2026-01-25");
  });

  it("lê as compras da seção de lançamentos", () => {
    const parse = parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos: compras e saques"),
        at(LEFT, 690, "R C CUSTODIO JR (final 2227)"),
        ...[at(LEFT, 680, "DATA"), at(DESCRIPTION, 680, "ESTABELECIMENTO"), at(297, 680, "VALOR EM R$")],
        ...charge(670, "05/01", "WIX*1217485431", "30,00"),
        at(DESCRIPTION, 660, "DIVERSOS .SAO PAULO"),
        ...charge(650, "07/01", "POSTO DE SER-CT S LINS", "37,97"),
        at(LEFT, 640, "Total dos lançamentos atuais"),
        at(AMOUNT, 640, "67,97"),
      ]),
    );

    expect(parse.transactions).toHaveLength(2);
    expect(parse.transactions[0]).toMatchObject({
      occurredOn: "2026-01-05",
      description: "WIX*1217485431",
      amount: parseMoney("30,00"),
      direction: "out",
    });
    expect(parse.source.cards).toEqual([{ label: "R C CUSTODIO JR", lastDigits: "2227" }]);
    expect(parse.statedChargesTotal).toBe(parseMoney("67,97"));
  });

  it("a categoria e a cidade da linha seguinte viram detalhe, não outro lançamento", () => {
    const parse = parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos: compras e saques"),
        ...charge(670, "05/01", "WIX", "30,00"),
        at(DESCRIPTION, 660, "DIVERSOS .SAO PAULO"),
      ]),
    );

    expect(parse.transactions).toHaveLength(1);
    expect(parse.transactions[0]?.raw.detalhe).toBe("DIVERSOS .SAO PAULO");
  });

  it("uma compra de dezembro numa fatura de janeiro fica em dezembro", () => {
    const parse = parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos: compras e saques"),
        ...charge(670, "23/12", "ANUIDADE", "83,25"),
      ]),
    );
    expect(parse.transactions[0]?.occurredOn).toBe("2025-12-23");
  });

  it("estorno é dinheiro de volta, não uma despesa negativa escondida", () => {
    const parse = parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos: produtos e serviços"),
        ...charge(670, "05/01", "ESTORNO ANUIDADE", "- 83,25"),
      ]),
    );
    expect(parse.transactions[0]).toMatchObject({
      direction: "in",
      amount: parseMoney("83,25"),
    });
  });

  it("parcela vira número de parcela", () => {
    const parse = parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos: compras e saques"),
        ...charge(670, "21/01", "MERCADO*2ELETROINF01/03", "1.030,12"),
      ]),
    );
    expect(parse.transactions[0]).toMatchObject({ installmentCurrent: 1, installmentTotal: 3 });
  });

  it("as parcelas de faturas futuras não entram — seria cobrar duas vezes", () => {
    const parse = parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos: compras e saques"),
        ...charge(690, "21/01", "MERCADO*2ELETROINF01/03", "1.030,12"),
        at(LEFT, 670, "Compras parceladas - próximas faturas"),
        ...charge(650, "21/01", "MERCADO*2ELETROINF02/03", "1.030,12"),
      ]),
    );

    expect(parse.transactions).toHaveLength(1);
    expect(parse.discarded[0]?.reason).toContain("fatura futura");
  });

  it("o repasse de IOF é uma cobrança de verdade", () => {
    const parse = parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos internacionais"),
        ...charge(690, "01/01", "SLACK", "1.001,58"),
        at(LEFT, 670, "Repasse de IOF em R$"),
        at(AMOUNT, 670, "38,75"),
      ]),
    );

    expect(parse.transactions).toHaveLength(2);
    expect(parse.transactions[1]?.description).toBe("Repasse de IOF");
  });

  it("texto da coluna vizinha não pode virar o valor do lançamento", () => {
    const parse = parseItauCardInvoice(
      invoice(
        [
          at(LEFT, 700, "Lançamentos: compras e saques"),
          ...[at(LEFT, 690, "DATA"), at(DESCRIPTION, 690, "ESTABELECIMENTO"), at(297, 690, "VALOR EM R$")],
          ...charge(670, "02/02", "ADOBE", "139,01"),
        ],
        [at(RIGHT, 670, "Limite máximo para saque no exterior"), at(523, 670, "7.220,00")],
      ),
    );

    expect(parse.transactions[0]?.amount).toBe(parseMoney("139,01"));
  });

  it("um marcador de seção da coluna da direita não fecha a seção da esquerda", () => {
    const parse = parseItauCardInvoice(
      invoice(
        [
          at(LEFT, 700, "Lançamentos: compras e saques"),
          ...charge(690, "05/01", "WIX", "30,00"),
          ...charge(670, "06/01", "ADOBE", "40,00"),
        ],
        [at(RIGHT, 680, "Encargos cobrados nesta fatura")],
      ),
    );

    expect(parse.transactions).toHaveLength(2);
  });
});

describe("reconcileCardInvoice", () => {
  const base = (amount: string, total: string) =>
    parseItauCardInvoice(
      invoice([
        at(LEFT, 700, "Lançamentos: compras e saques"),
        ...charge(690, "05/01", "WIX", amount),
        at(LEFT, 670, "Total dos lançamentos atuais"),
        at(AMOUNT, 670, total),
      ]),
    );

  it("aprova quando a soma bate exatamente com o total impresso", () => {
    const result = reconcileCardInvoice(base("30,00", "30,00"));
    expect(result.ok).toBe(true);
    expect(result.difference).toBe(0n);
  });

  it("recusa por um centavo de diferença — não existe “quase certo” aqui (D-B)", () => {
    const result = reconcileCardInvoice(base("30,00", "30,01"));
    expect(result.ok).toBe(false);
    expect(result.difference).toBe(parseMoney("-0,01"));
    expect(result.message).toContain("recusada");
  });

  it("recusa quando a fatura não declara total nenhum para conferir", () => {
    const parse = parseItauCardInvoice(
      invoice([at(LEFT, 700, "Lançamentos: compras e saques"), ...charge(690, "05/01", "WIX", "30,00")]),
    );
    const result = reconcileCardInvoice(parse);
    expect(result.ok).toBe(false);
    expect(result.expected).toBeNull();
  });
});
