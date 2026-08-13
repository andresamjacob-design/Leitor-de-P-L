import { describe, expect, it } from "vitest";
import {
  isAutomaticSweep,
  parseItauStatement,
  reconcileStatement,
} from "@/lib/import/itau-statement";
import { parseMoney } from "@/lib/money";
import type { Cell } from "@/lib/import/xlsx";

/** The shape the bank exports: metadata rows, then a header, then the movements. */
function statement(rows: Cell[][], header = ["Data", "Lançamento", "Razão Social", "CPF/CNPJ", "Valor (R$)", "Saldo (R$)"]): Cell[][] {
  return [
    ["Atualização:", "15/07/2026 10:18:21"],
    ["Nome:", "DYNAMICS DATA"],
    ["Agência:", "0561"],
    ["Conta:", "0098873-4"],
    [],
    ["Lançamentos"],
    ["Periodo:", "01/01/2026 até 15/07/2026"],
    [],
    header,
    ...rows,
  ];
}

describe("parseItauStatement", () => {
  it("lê os metadados da conta e o período", () => {
    const parse = parseItauStatement(statement([]));
    expect(parse.source.branch).toBe("0561");
    expect(parse.source.account).toBe("0098873-4");
    expect(parse.periodStart).toBe("2026-01-01");
    expect(parse.periodEnd).toBe("2026-07-15");
  });

  it("transforma uma linha em movimento, com sinal virando sentido", () => {
    const parse = parseItauStatement(
      statement([
        ["05/01/2026", "PIX RECEBIDO", "MARY KAY DO BRASIL L", "12.345.678/0001-95", "32500.0", null],
        ["05/01/2026", "SISPAG FORNECEDORES", "", "", "-5200.0", null],
      ]),
    );

    expect(parse.transactions).toHaveLength(2);
    expect(parse.transactions[0]).toMatchObject({
      occurredOn: "2026-01-05",
      direction: "in",
      amount: parseMoney("32.500,00"),
      counterpartyTaxId: "12345678000195",
    });
    expect(parse.transactions[1]).toMatchObject({ direction: "out", amount: parseMoney("5.200,00") });
  });

  it("descarta toda linha de saldo — é o que impede o fluxo de caixa de dobrar", () => {
    const parse = parseItauStatement(
      statement([
        ["31/12/2025", "SALDO ANTERIOR", "", "", null, "142469.28"],
        ["05/01/2026", "PIX RECEBIDO", "", "", "1000.0", null],
        ["05/01/2026", "SALDO TOTAL DISPONÍVEL DIA", "", "", null, "143469.28"],
        ["05/01/2026", "SALDO MOVIMENTAÇÃO CONTA", "", "", null, "1.0"],
        ["05/01/2026", "SALDO APLIC. AUT.", "", "", null, "143468.28"],
      ]),
    );

    expect(parse.transactions).toHaveLength(1);
    expect(parse.openingBalance).toBe(parseMoney("142.469,28"));
    expect(parse.discarded).toHaveLength(4);
  });

  it("acha o cabeçalho pelo nome, mesmo com uma coluna a mais no meio", () => {
    // Uma das exportações reais tem `Ag/origem` entre a descrição e a razão social.
    const parse = parseItauStatement(
      statement(
        [["03/07/2026", "PIX ENVIADO", "0001/78760794-0", "IVSON JOSE", "101.161.124-41", "-1000.0", null]],
        ["Data", "Lançamento", "Ag/origem", "Razão Social", "CPF/CNPJ", "Valor (R$)", "Saldo (R$)"],
      ),
    );

    expect(parse.transactions[0]).toMatchObject({
      amount: parseMoney("1.000,00"),
      direction: "out",
      counterpartyName: "IVSON JOSE",
      counterpartyTaxId: "10116112441",
    });
  });

  it("aceita valor em pt-BR, que é o que um CSV traz", () => {
    const parse = parseItauStatement(
      statement([["05/01/2026", "BOLETO PAGO", "", "", "-1.234,56", null]]),
    );
    expect(parse.transactions[0]?.amount).toBe(parseMoney("1.234,56"));
  });

  it("aceita colunas separadas de débito e crédito", () => {
    const parse = parseItauStatement(
      statement(
        [
          ["05/01/2026", "PAGAMENTO", "300,00", ""],
          ["06/01/2026", "RECEBIMENTO", "", "500,00"],
        ],
        ["Data", "Histórico", "Débito", "Crédito"],
      ),
    );

    expect(parse.transactions[0]).toMatchObject({ direction: "out", amount: parseMoney("300,00") });
    expect(parse.transactions[1]).toMatchObject({ direction: "in", amount: parseMoney("500,00") });
  });

  it("captura parcelas na descrição, sem confundir com data", () => {
    const parse = parseItauStatement(
      statement([
        ["05/01/2026", "MERCADO 01/03", "", "", "-100.0", null],
        ["16/07/2026", "BOLETOS RECEBIDOS  16/07S", "", "", "3300.0", null],
      ]),
    );

    expect(parse.transactions[0]).toMatchObject({ installmentCurrent: 1, installmentTotal: 3 });
    expect(parse.transactions[1]?.installmentTotal).toBeNull();
  });

  it("diz que não é um extrato quando não acha o cabeçalho", () => {
    const parse = parseItauStatement([["qualquer", "coisa"], ["outra", "linha"]]);
    expect(parse.transactions).toHaveLength(0);
    expect(parse.warnings[0]?.severity).toBe("error");
    expect(parse.warnings[0]?.message).toContain("cabeçalho");
  });
});

describe("isAutomaticSweep", () => {
  it("reconhece a varredura da aplicação automática", () => {
    expect(isAutomaticSweep("APL APLIC AUT MAIS AP")).toBe(true);
    expect(isAutomaticSweep("APL APLIC AUT MAIS")).toBe(true);
    expect(isAutomaticSweep("RES APLIC AUT MAIS")).toBe(true);
  });

  it("rendimento não é varredura — é receita de verdade", () => {
    expect(isAutomaticSweep("RENDIMENTOS REND PAGO APLIC AUT MAIS")).toBe(false);
    expect(isAutomaticSweep("ENTRADA REND PAGO APLIC AUT MAIS")).toBe(false);
    expect(isAutomaticSweep("RENDIMENTO APLICAÇÃO AUTOMÁTICA REND PAGO APLIC AUT MAIS")).toBe(false);
  });

  it("o CDB é uma conta de verdade, não varredura", () => {
    expect(isAutomaticSweep("APLICACAO CDB DI")).toBe(false);
    expect(isAutomaticSweep("RESGATE CDB")).toBe(false);
  });

  it("um pagamento comum não é varredura", () => {
    expect(isAutomaticSweep("SISPAG FORNECEDORES")).toBe(false);
    expect(isAutomaticSweep("PIX RECEBIDO")).toBe(false);
  });
});

describe("reconcileStatement", () => {
  it("confere o saldo declarado dia a dia", () => {
    const parse = parseItauStatement(
      statement([
        ["31/12/2025", "SALDO ANTERIOR", "", "", null, "1000.0"],
        ["05/01/2026", "PIX RECEBIDO", "", "", "500.0", null],
        ["05/01/2026", "SALDO TOTAL DISPONÍVEL DIA", "", "", null, "1500.0"],
        ["06/01/2026", "BOLETO PAGO", "", "", "-200.0", null],
        ["06/01/2026", "SALDO TOTAL DISPONÍVEL DIA", "", "", null, "1300.0"],
      ]),
    );

    const result = reconcileStatement(parse);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("acusa o dia em que a leitura não fecha", () => {
    const parse = parseItauStatement(
      statement([
        ["31/12/2025", "SALDO ANTERIOR", "", "", null, "1000.0"],
        ["05/01/2026", "PIX RECEBIDO", "", "", "500.0", null],
        ["05/01/2026", "SALDO TOTAL DISPONÍVEL DIA", "", "", null, "1600.0"],
      ]),
    );

    const result = reconcileStatement(parse);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({
      date: "2026-01-05",
      difference: parseMoney("-100,00"),
    });
  });

  it("a varredura da aplicação não entra na conta — senão o dia não fecha", () => {
    const parse = parseItauStatement(
      statement([
        ["31/12/2025", "SALDO ANTERIOR", "", "", null, "1000.0"],
        ["05/01/2026", "RES APLIC AUT MAIS", "", "", "900.0", null],
        ["05/01/2026", "APL APLIC AUT MAIS", "", "", "-900.0", null],
        ["05/01/2026", "PIX RECEBIDO", "", "", "500.0", null],
        ["05/01/2026", "SALDO TOTAL DISPONÍVEL DIA", "", "", null, "1500.0"],
      ]),
    );

    expect(parse.transactions).toHaveLength(1);
    expect(reconcileStatement(parse).ok).toBe(true);
  });

  it("o saldo de exportação não é ponto de conferência", () => {
    // `SALDO EM CONTA CORRENTE` é tirado na hora da exportação e já embute rendimento
    // do dia, então nunca bate com o fechamento — e não deve reprovar a importação.
    const parse = parseItauStatement(
      statement([
        ["31/12/2025", "SALDO ANTERIOR", "", "", null, "1000.0"],
        ["05/01/2026", "PIX RECEBIDO", "", "", "500.0", null],
        ["05/01/2026", "SALDO TOTAL DISPONÍVEL DIA", "", "", null, "1500.0"],
        ["06/01/2026", "SALDO EM CONTA CORRENTE", "", "", null, "1505.25"],
      ]),
    );

    expect(reconcileStatement(parse).ok).toBe(true);
  });
});
