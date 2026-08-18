import { describe, expect, it } from "vitest";
import { buildBridge, significantLines } from "@/lib/reconcile";
import type { MonthBuckets } from "@/lib/reconcile";
import { parseMoney, ZERO } from "@/lib/money";

function buckets(overrides: Partial<MonthBuckets> = {}): MonthBuckets {
  return {
    period: "2026-06-01",
    caixaOperacional: ZERO,
    receitaReconhecida: ZERO,
    custoReconhecido: ZERO,
    entradasSemEspelho: ZERO,
    saidasSemEspelho: ZERO,
    saidasComEspelhoEmOutroMes: ZERO,
    entradasComEspelhoEmOutroMes: ZERO,
    custoComCaixaEmOutroMes: ZERO,
    custoDeCartao: ZERO,
    custoSemCaixa: ZERO,
    ajusteManualNoEspelho: ZERO,
    ...overrides,
  };
}

describe("buildBridge", () => {
  it("mês vazio fecha em zero", () => {
    const bridge = buildBridge(buckets());
    expect(bridge.residual).toBe(ZERO);
    expect(significantLines(bridge)).toHaveLength(0);
  });

  it("um custo pago e reconhecido no mesmo mês se cancela e não aparece na ponte", () => {
    // R$ 10.000 saem do banco em 6.10 e viram custo de junho. O caixa operacional é
    // −10.000, o resultado é −10.000, e não há nada a explicar.
    const bridge = buildBridge(
      buckets({
        caixaOperacional: -parseMoney("10.000,00"),
        custoReconhecido: parseMoney("10.000,00"),
      }),
    );
    expect(bridge.resultado).toBe(-parseMoney("10.000,00"));
    expect(bridge.caixa).toBe(-parseMoney("10.000,00"));
    expect(bridge.residual).toBe(ZERO);
    expect(significantLines(bridge)).toHaveLength(0);
  });

  it("receita reconhecida sem o dinheiro ter caído explica a diferença inteira", () => {
    const bridge = buildBridge(
      buckets({ caixaOperacional: ZERO, receitaReconhecida: parseMoney("400.000,00") }),
    );
    expect(bridge.resultado).toBe(parseMoney("400.000,00"));
    expect(bridge.residual).toBe(ZERO);
  });

  it("o dinheiro do contrato entrando não mexe no resultado", () => {
    // Recebimento de contrato já reconhecido: entra R$ 400.000 no caixa, e a linha
    // "entradas sem competência" tira os mesmos R$ 400.000 da ponte.
    const bridge = buildBridge(
      buckets({
        caixaOperacional: parseMoney("400.000,00"),
        entradasSemEspelho: parseMoney("400.000,00"),
      }),
    );
    expect(bridge.resultado).toBe(ZERO);
    expect(bridge.residual).toBe(ZERO);
  });

  it("compra no cartão é custo sem caixa no mês", () => {
    const bridge = buildBridge(
      buckets({
        custoReconhecido: parseMoney("8.000,00"),
        custoDeCartao: parseMoney("8.000,00"),
      }),
    );
    expect(bridge.resultado).toBe(-parseMoney("8.000,00"));
    expect(bridge.caixa).toBe(ZERO);
    expect(bridge.residual).toBe(ZERO);
  });

  it("salário de janeiro pago em fevereiro: sai do caixa aqui, pesa lá", () => {
    // Fevereiro: R$ 60.000 saem, com competência em janeiro.
    const fevereiro = buildBridge(
      buckets({
        period: "2026-02-01",
        caixaOperacional: -parseMoney("60.000,00"),
        saidasComEspelhoEmOutroMes: parseMoney("60.000,00"),
      }),
    );
    expect(fevereiro.resultado).toBe(ZERO);
    expect(fevereiro.residual).toBe(ZERO);

    // Janeiro: o custo pesa, sem dinheiro nenhum se movendo.
    const janeiro = buildBridge(
      buckets({
        period: "2026-01-01",
        custoReconhecido: parseMoney("60.000,00"),
        custoComCaixaEmOutroMes: parseMoney("60.000,00"),
      }),
    );
    expect(janeiro.resultado).toBe(-parseMoney("60.000,00"));
    expect(janeiro.residual).toBe(ZERO);
  });

  it("custo sem categoria fica no caixa e fora do resultado", () => {
    // É o estado das 250 linhas pendentes: dinheiro saiu, resultado não sentiu.
    const bridge = buildBridge(
      buckets({
        caixaOperacional: -parseMoney("290.000,00"),
        saidasSemEspelho: parseMoney("290.000,00"),
      }),
    );
    expect(bridge.resultado).toBe(ZERO);
    expect(bridge.residual).toBe(ZERO);
  });

  it("espelho editado à mão aparece com nome em vez de virar resíduo", () => {
    // Caixa −10.000, mas alguém deixou a competência em 12.000.
    const bridge = buildBridge(
      buckets({
        caixaOperacional: -parseMoney("10.000,00"),
        custoReconhecido: parseMoney("12.000,00"),
        ajusteManualNoEspelho: parseMoney("2.000,00"),
      }),
    );
    expect(bridge.resultado).toBe(-parseMoney("12.000,00"));
    expect(bridge.residual).toBe(ZERO);
  });

  it("um mês real, com tudo acontecendo junto, ainda fecha", () => {
    // Os baldes não são livres: num mês de verdade eles saem dos mesmos lançamentos, e
    // duas identidades os amarram. Escrever o teste a partir das primitivas é o que prova
    // que a ponte fecha por construção, e não por sorte na escolha dos números.
    //
    //   caixaOperacional = (entradas espelhadas aqui + em outro mês + sem espelho)
    //                    − (saídas   espelhadas aqui + em outro mês + sem espelho)
    //   custoReconhecido = (saídas espelhadas aqui − entradas espelhadas aqui)
    //                    + ajuste manual + custo com caixa em outro mês
    //                    + custo de cartão + custo sem caixa
    const saidasEspelhadasAqui = parseMoney("180.000,00");
    const entradasEspelhadasAqui = ZERO;
    const saidasComEspelhoEmOutroMes = parseMoney("30.000,00");
    const entradasComEspelhoEmOutroMes = parseMoney("5.000,00");
    const saidasSemEspelho = parseMoney("90.000,00");
    const entradasSemEspelho = parseMoney("500.000,00");
    const custoComCaixaEmOutroMes = parseMoney("25.000,00");
    const custoDeCartao = parseMoney("40.000,00");
    const custoSemCaixa = parseMoney("15.000,00");

    const caixaOperacional =
      entradasEspelhadasAqui +
      entradasComEspelhoEmOutroMes +
      entradasSemEspelho -
      (saidasEspelhadasAqui + saidasComEspelhoEmOutroMes + saidasSemEspelho);

    const custoReconhecido =
      saidasEspelhadasAqui -
      entradasEspelhadasAqui +
      custoComCaixaEmOutroMes +
      custoDeCartao +
      custoSemCaixa;

    const bridge = buildBridge(
      buckets({
        caixaOperacional,
        receitaReconhecida: parseMoney("450.000,00"),
        custoReconhecido,
        entradasSemEspelho,
        saidasSemEspelho,
        saidasComEspelhoEmOutroMes,
        entradasComEspelhoEmOutroMes,
        custoComCaixaEmOutroMes,
        custoDeCartao,
        custoSemCaixa,
      }),
    );

    expect(caixaOperacional).toBe(parseMoney("205.000,00"));
    expect(custoReconhecido).toBe(parseMoney("260.000,00"));
    expect(bridge.resultado).toBe(parseMoney("190.000,00"));
    expect(bridge.residual).toBe(ZERO);
  });

  it("um centavo sem explicação vira resíduo, que é o ponto do verificador", () => {
    const bridge = buildBridge(
      buckets({ caixaOperacional: ZERO, custoReconhecido: parseMoney("0,01") }),
    );
    expect(bridge.residual).toBe(-parseMoney("0,01"));
  });
});
