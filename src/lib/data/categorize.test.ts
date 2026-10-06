import { describe, expect, it } from "vitest";
import { MERCHANT_CATEGORY_CODES, merchantCategoryOf } from "@/lib/data/categorize";

const detalhe = (valor: string) => merchantCategoryOf({ detalhe: valor });

/**
 * As formas abaixo são as que a fatura do Itaú realmente produz — 101 valores distintos no
 * razão, reduzidos aqui a um exemplar de cada forma. O que se prova é que a regra separa
 * ramo de não-ramo **sem uma lista de cidades ou de moedas**, que é o que a faria envelhecer.
 */
describe("merchantCategoryOf", () => {
  it("tira a cidade quando o ponto vem depois de um espaço", () => {
    expect(detalhe("ALIMENTAÇÃO .SAO PAULO")).toBe("ALIMENTAÇÃO");
    expect(detalhe("ALIMENTAÇÃO .GASPAR")).toBe("ALIMENTAÇÃO");
    expect(detalhe("VEÍCULOS .GASPAR")).toBe("VEÍCULOS");
  });

  it("tira a cidade quando o ponto vem colado — o caso que a versão anterior não via", () => {
    // `TURISMO E ENTRETENIM.` nunca traz espaço antes do ponto, e cortar em " ." deixava
    // cada cidade virar um ramo próprio: catorze chaves de uma linha cada.
    expect(detalhe("TURISMO E ENTRETENIM.SAO PAULO")).toBe("TURISMO E ENTRETENIM");
    expect(detalhe("TURISMO E ENTRETENIM.BELO HORIZONT")).toBe("TURISMO E ENTRETENIM");
    expect(detalhe("TURISMO E ENTRETENIM.SANTdoPARNAIB")).toBe("TURISMO E ENTRETENIM");
  });

  it("aceita ramo com a cidade vazia", () => {
    expect(detalhe("DIVERSOS .")).toBe("DIVERSOS");
    expect(detalhe("TURISMO E ENTRETENIM.")).toBe("TURISMO E ENTRETENIM");
  });

  it("ignora o sufixo de continuação, que vem depois da cidade", () => {
    expect(detalhe("DIVERSOS .BELA VISTA · Continua...")).toBe("DIVERSOS");
  });

  it("recusa conversão de câmbio, que usa o mesmo campo e não é ramo nenhum", () => {
    expect(detalhe("SAN FRANCISCO 1.848,24 BRL 366,21 · Dólar de Conversão R$ 5,36")).toBeNull();
    expect(detalhe("8018996256 1.124,25 USD 1.124,25 · Dólar de Conversão R$ 5,42")).toBeNull();
    expect(detalhe("SAN FRANCISCO 20,00 USD 20,00 · Dólar de Conversão R$ 5,31")).toBeNull();
    expect(detalhe("(888)850-3958 511,88 USD 511,88 · Dólar de Conversão R$ 5,36")).toBeNull();
    expect(
      detalhe("VANCOUVER 1,00 USD 1,00 · Dólar de Conversão R$ 5,58 · Continua..."),
    ).toBeNull();
  });

  it("recusa cidade sozinha — sem ponto não há o separador que faz um ramo existir", () => {
    // `SAO PAULO` tinha 7 linhas no razão fingindo ser uma categoria de lojista.
    expect(detalhe("SAO PAULO")).toBeNull();
    expect(detalhe("BARUERI")).toBeNull();
    expect(detalhe("Rio")).toBeNull();
  });

  it("recusa a linha de totalização da fatura", () => {
    expect(detalhe("Total de outros lançamentos - 39.089,44")).toBeNull();
  });

  it("devolve nulo quando não há `detalhe` — extrato de conta corrente não tem", () => {
    expect(merchantCategoryOf(null)).toBeNull();
    expect(merchantCategoryOf({})).toBeNull();
    expect(merchantCategoryOf({ detalhe: 42 })).toBeNull();
    expect(detalhe("")).toBeNull();
    expect(detalhe(" . SAO PAULO")).toBeNull();
  });

  it("normaliza a caixa, porque a chave do mapa é maiúscula", () => {
    expect(detalhe("Alimentação .Sao Paulo")).toBe("ALIMENTAÇÃO");
  });

  /**
   * A trava que protege o conserto: todo ramo do mapa tem de continuar saindo do campo
   * exatamente como está escrito lá. Se alguém mexer no leitor e um deles deixar de casar,
   * a camada 6 some em silêncio — que é o defeito que este conserto acabou de tirar.
   */
  it("cada ramo do mapa continua legível a partir do campo real", () => {
    for (const ramo of Object.keys(MERCHANT_CATEGORY_CODES)) {
      expect(detalhe(`${ramo} .SAO PAULO`)).toBe(ramo);
      expect(detalhe(`${ramo}.SAO PAULO`)).toBe(ramo);
    }
  });
});
