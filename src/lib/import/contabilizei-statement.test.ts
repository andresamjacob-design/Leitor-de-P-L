import { describe, expect, it } from "vitest";
import {
  parseContabilizeiStatement,
  reconcileContabilizei,
} from "@/lib/import/contabilizei-statement";
import { parseMoney } from "@/lib/money";
import type { PdfPage, PositionedItem } from "@/lib/import/layout";

const DATE = 78;
const CATEGORY = 129;
const DETAIL = 166;
const ID = 342;
const AMOUNT = 437;
const BALANCE = 496;

function at(x: number, y: number, text: string): PositionedItem {
  return { x, y, text, width: 30 };
}

/**
 * A movement as the statement prints it: the amount and the balance on one row, the
 * description a hair below it, and the document and origin on the rows under that.
 */
function movement(
  y: number,
  { date, category, description, id, amount, balance, document }: {
    date?: string;
    category: string;
    description: string;
    id: string;
    amount: string;
    balance: string;
    document?: string;
  },
): PositionedItem[] {
  const row: PositionedItem[] = [
    at(CATEGORY, y, category),
    at(ID, y, id),
    at(AMOUNT, y, amount),
    at(BALANCE, y, balance),
    at(DETAIL, y - 1, description),
  ];
  if (date) row.push(at(DATE, y, date));
  if (document) row.push(at(DETAIL, y - 8, document));
  row.push(at(DETAIL, y - 15, "Agência: 0001 / Conta: 123456"));
  return row;
}

function statement(body: PositionedItem[], opening = "45.999,99"): PdfPage[] {
  return [
    {
      number: 1,
      items: [
        at(DATE, 900, "CNPJ 50.050.390/0001-82"),
        at(200, 900, "Banco 301"),
        at(300, 900, "Agência 0001"),
        at(400, 900, "Conta 3111117-6"),
        at(DATE, 880, "01 de JANEIRO de 2025 07 de OUTUBRO de 2025"),
        at(DATE, 870, "Total de entradas do período R$ 25.350,00 Total de saídas do período R$ 4.500,00"),
        at(DATE, 860, `Saldo inicial do período R$ ${opening}`),
        ...body,
      ],
    },
  ];
}

describe("parseContabilizeiStatement", () => {
  it("lê a conta, o período e o saldo inicial do cabeçalho", () => {
    const parse = parseContabilizeiStatement(statement([]));
    expect(parse.source.institution).toBe("Contabilizei");
    expect(parse.source.branch).toBe("0001");
    expect(parse.source.account).toBe("3111117-6");
    expect(parse.periodStart).toBe("2025-01-01");
    expect(parse.periodEnd).toBe("2025-10-07");
    expect(parse.openingBalance).toBe(parseMoney("45.999,99"));
  });

  it("tira o sentido do saldo, não da palavra", () => {
    // O valor impresso não tem sinal: 3.000,00 nos dois casos. Só o saldo distingue.
    const parse = parseContabilizeiStatement(
      statement([
        ...movement(700, {
          date: "03 JAN. 2025",
          category: "PIX",
          description: "Pix enviado - Laura Santana",
          id: "1",
          amount: "3.000,00",
          balance: "42.999,99",
        }),
        ...movement(650, {
          category: "PIX",
          description: "Pix recebido - Alguém",
          id: "2",
          amount: "3.000,00",
          balance: "45.999,99",
        }),
      ]),
    );

    expect(parse.transactions).toHaveLength(2);
    expect(parse.transactions[0]?.direction).toBe("out");
    expect(parse.transactions[1]?.direction).toBe("in");
    expect(parse.transactions[0]?.amount).toBe(parseMoney("3.000,00"));
  });

  it("guarda o CNPJ da contraparte e recusa o CPF mascarado", () => {
    const parse = parseContabilizeiStatement(
      statement([
        ...movement(700, {
          date: "03 JAN. 2025",
          category: "PIX",
          description: "Pix enviado - INAE DIAS GODOI",
          id: "1",
          amount: "4.000,00",
          balance: "41.999,99",
          document: "44.708.871/0001-30",
        }),
        ...movement(650, {
          category: "PIX",
          description: "Pix enviado - Laura Santana",
          id: "2",
          amount: "1.000,00",
          balance: "40.999,99",
          document: "709.***.***-26",
        }),
      ]),
    );

    expect(parse.transactions[0]?.counterpartyTaxId).toBe("44.708.871/0001-30");
    expect(parse.transactions[0]?.counterpartyName).toBe("INAE DIAS GODOI");
    // Cinco dígitos sobrevivem à máscara e não identificam ninguém.
    expect(parse.transactions[1]?.counterpartyTaxId).toBeNull();
    expect(parse.transactions[1]?.counterpartyName).toBe("Laura Santana");
    expect(parse.transactions[1]?.raw["documento"]).toBe("709.***.***-26");
  });

  it("descarta a linha cujo saldo não se move", () => {
    const parse = parseContabilizeiStatement(
      statement([
        ...movement(700, {
          date: "20 MAI. 2025",
          category: "BOLETO",
          description: "Boleto pago - Simples Nacional",
          id: "1",
          amount: "1.000,00",
          balance: "44.999,99",
        }),
        ...movement(650, {
          category: "BOLETO",
          description: "Boleto estornado - DARF Unificado",
          id: "2",
          amount: "166,98",
          balance: "44.999,99",
        }),
      ]),
    );

    expect(parse.transactions).toHaveLength(1);
    expect(parse.discarded).toHaveLength(1);
    expect(parse.discarded[0]?.reason).toMatch(/saldo não se move/);
  });

  it("não confunde o banco como contraparte com o rodapé da página", () => {
    // O rodapé repete `CONTABILIZEI TECNOLOGIA LTDA`, e o banco também recebe PIX.
    const parse = parseContabilizeiStatement(
      statement([
        at(DATE, 720, "CONTABILIZEI TECNOLOGIA LTDA CNPJ 20.182.807/0001-08"),
        at(DATE, 710, "SAC - 0800 885 0088"),
        ...movement(700, {
          date: "23 MAI. 2025",
          category: "PIX",
          description: "Pix recebido - CONTABILIZEI TECNOLOGIA LTDA",
          id: "1",
          amount: "1,65",
          balance: "46.001,64",
        }),
      ]),
    );

    expect(parse.transactions).toHaveLength(1);
    expect(parse.transactions[0]?.amount).toBe(parseMoney("1,65"));
    expect(parse.transactions[0]?.direction).toBe("in");
  });
});

describe("reconcileContabilizei", () => {
  it("fecha quando os movimentos batem com o saldo declarado", () => {
    const parse = parseContabilizeiStatement(
      statement([
        ...movement(700, {
          date: "03 JAN. 2025",
          category: "PIX",
          description: "Pix enviado - Alguém",
          id: "1",
          amount: "4.500,00",
          balance: "41.499,99",
        }),
        ...movement(650, {
          category: "TED",
          description: "Transferência recebida",
          id: "2",
          amount: "25.350,00",
          balance: "66.849,99",
        }),
        at(418, 620, "Saldo final do dia"),
        at(BALANCE, 620, "66.849,99"),
      ]),
    );

    const check = reconcileContabilizei(parse);
    expect(check.ok).toBe(true);
    expect(check.difference).toBe(0n);
  });

  it("recusa quando não há saldo para conferir", () => {
    const parse = parseContabilizeiStatement(statement([]));
    expect(reconcileContabilizei(parse).ok).toBe(false);
  });
});
