/**
 * A ponte entre os dois razões.
 *
 * `cash_entries` e `recognition_entries` **não batem, e não é para baterem** (D2): um diz
 * quando o dinheiro se moveu, o outro quando o resultado aconteceu. Fundir os dois faria
 * os dois relatórios concordarem por construção e destruiria o motivo de existirem dois.
 *
 * O que *precisa* ser verdade é mais forte e mais útil: **toda diferença entre eles tem
 * nome**. Se sobra um centavo sem explicação, é defeito — um espelho que não nasceu, um
 * lançamento categorizado depois do fechamento, um custo contado duas vezes. Este módulo
 * escreve a identidade que fecha, e o `verify:reconcile` a executa mês a mês contra o
 * banco de verdade.
 *
 * A decomposição é exaustiva por construção, e é isso que faz o resíduo significar algo:
 *
 *   - Todo lançamento de caixa do mês, numa conta de caixa e fora de `transfer`, é
 *     **espelhado no próprio mês**, **espelhado em outro mês** (D2b, o salário de janeiro
 *     pago em fevereiro) ou **não espelhado** (receita recebida, sócios, ou ainda sem
 *     categoria).
 *   - Toda linha de custo em competência do mês é **espelho de caixa do mesmo mês**,
 *     **espelho de caixa de outro mês**, **espelho de compra no cartão** (custo quando
 *     compra, dinheiro só quando a fatura é paga, D-C) ou **não tem caixa nenhum**
 *     (contrato, POC, `recognize:manual`).
 *
 * Os espelhos do próprio mês se cancelam contra o próprio caixa — é o único par que some
 * da ponte, e some porque `planCashMirror` copia o valor com o sinal trocado. Quando
 * alguém edita um espelho à mão (D-A), essa cópia deixa de valer, e a diferença aparece
 * com nome próprio em vez de virar resíduo.
 */

import type { Cents } from "@/lib/money";
import type { Period } from "@/lib/dates";

export type MonthBuckets = {
  period: Period;
  /** Entradas − saídas do mês, contas de caixa, fora de `transfer`. */
  caixaOperacional: Cents;
  receitaReconhecida: Cents;
  /** Assinado: devolução numa conta de custo entra negativa. */
  custoReconhecido: Cents;
  /** Entradas do mês sem espelho: receita recebida ou ainda sem categoria. */
  entradasSemEspelho: Cents;
  /** Saídas do mês sem espelho: custo pago ainda sem categoria. */
  saidasSemEspelho: Cents;
  /**
   * Retirada de sócio no mês (`owner_draw`), separada das duas de cima porque diz outra
   * coisa (D110). "Sem competência" costuma significar *ainda* sem — uma linha à espera de
   * categoria, que vai pesar no resultado quando alguém responder. Distribuição de lucro
   * **nunca** vai: ela está fora da DRE por decisão, desde a D24. Somar as duas debaixo do
   * mesmo rótulo transforma uma escolha em pendência e infla a lista de tarefas.
   */
  saidasDeSocios: Cents;
  /**
   * Folha paga cuja competência **não** vem do dia do pagamento (D120).
   *
   * Desde a D120 a folha em competência é lida da aba `Colaboradores`, que é a fonte de
   * competência do Andre, e o pagamento deixou de espelhar — senão o custo entraria duas
   * vezes. Sem um balde próprio ela cairia em `saidasSemEspelho`, cujo rótulo diz *ainda*
   * sem competência, e R$ 1,2 milhão de folha viraria lista de tarefas. É a mesma lição da
   * D113, e o mesmo remédio.
   */
  saidasDeFolha: Cents;
  /**
   * Retirada devolvida. Existe como balde separado porque o razão a guarda como entrada,
   * mas **não vira linha própria na ponte** (D113): ela abate `saidasDeSocios`, porque o
   * que aconteceu foi uma distribuição menor, não um recebimento.
   */
  entradasDeSocios: Cents;
  /** Saídas do mês cuja competência caiu em outro mês. */
  saidasComEspelhoEmOutroMes: Cents;
  entradasComEspelhoEmOutroMes: Cents;
  /** Custo deste mês cujo dinheiro se moveu em outro. */
  custoComCaixaEmOutroMes: Cents;
  /** Custo deste mês que é compra no cartão — o dinheiro sai quando a fatura é paga. */
  custoDeCartao: Cents;
  /** Custo deste mês sem caixa nenhum: contrato, POC, plano manual. */
  custoSemCaixa: Cents;
  /**
   * O quanto os espelhos do próprio mês deixaram de ser cópia fiel do caixa, por edição
   * manual (D-A). Zero enquanto ninguém editar.
   */
  ajusteManualNoEspelho: Cents;
};

export type BridgeLine = {
  label: string;
  amount: Cents;
  /** Por que essa diferença existe. Vai impressa junto do número. */
  why: string;
};

export type Bridge = {
  period: Period;
  /** O resultado da DRE: receita − custo, em competência. */
  resultado: Cents;
  /** O que o fluxo de caixa chama de operacional. */
  caixa: Cents;
  lines: readonly BridgeLine[];
  /** Tem de ser zero. Qualquer outro valor é defeito. */
  residual: Cents;
};

export function buildBridge(buckets: MonthBuckets): Bridge {
  const resultado = buckets.receitaReconhecida - buckets.custoReconhecido;

  const lines: BridgeLine[] = [
    {
      label: "Receita reconhecida no mês",
      amount: buckets.receitaReconhecida,
      why: "receita nasce de contrato e NF, nunca do dia em que o dinheiro caiu (SPEC §5)",
    },
    {
      label: "Entradas de caixa sem competência",
      amount: -buckets.entradasSemEspelho,
      why: "dinheiro recebido que não é resultado do mês: recebimento de contrato já reconhecido, aporte, ou ainda sem categoria",
    },
    {
      label: "Saídas de caixa sem competência",
      amount: buckets.saidasSemEspelho,
      why: "dinheiro pago que ainda não virou custo porque está sem categoria — vai pesar no resultado quando alguém responder",
    },
    {
      label: "Folha paga, com competência na planilha",
      amount: buckets.saidasDeFolha,
      why: "D120 — a competência da folha vem da aba `Colaboradores`, não do dia do pagamento; o pagamento não espelha para o custo não entrar duas vezes",
    },
    {
      // Líquida de propósito (D113): retirada devolvida **não é entrada**. Mostrar
      // "distribuiu 607.500" e "recebeu de volta 165.000" faz a empresa parecer ter
      // distribuído o que não distribuiu, e faz a devolução parecer dinheiro ganho. O que
      // aconteceu é uma distribuição de 442.500, e é isso que a linha diz.
      label: "Distribuição de lucro aos sócios",
      amount: buckets.saidasDeSocios - buckets.entradasDeSocios,
      why: "D24 e D110 — sai do caixa e fica fora da DRE por decisão; devolução abate, não entra",
    },
    {
      label: "Saídas cuja competência é de outro mês",
      amount: buckets.saidasComEspelhoEmOutroMes,
      why: "D2b — o salário de janeiro pago em fevereiro sai do caixa aqui e pesa no resultado lá",
    },
    {
      label: "Entradas cuja competência é de outro mês",
      amount: -buckets.entradasComEspelhoEmOutroMes,
      why: "o mesmo, ao contrário: devolução recebida aqui, aliviando o custo de outro mês",
    },
    {
      label: "Custo cujo caixa é de outro mês",
      amount: -buckets.custoComCaixaEmOutroMes,
      why: "pesa no resultado deste mês, mas o dinheiro se moveu em outro",
    },
    {
      label: "Custo de compra no cartão",
      amount: -buckets.custoDeCartao,
      why: "D-C — a compra é custo no ato; o dinheiro só sai quando a fatura é paga, e aí como transferência",
    },
    {
      label: "Custo sem caixa nenhum",
      amount: -buckets.custoSemCaixa,
      why: "contrato, POC, plano manual ou a folha lida da `Colaboradores` (D120) — competência que não tem, e não deve ter, linha de caixa própria",
    },
    {
      label: "Ajuste manual em espelho",
      amount: -buckets.ajusteManualNoEspelho,
      why: "D-A — alguém editou a competência à mão e ela deixou de ser cópia do caixa",
    },
  ];

  const explicado = lines.reduce((acc, line) => acc + line.amount, buckets.caixaOperacional);

  return {
    period: buckets.period,
    resultado,
    caixa: buckets.caixaOperacional,
    lines,
    residual: resultado - explicado,
  };
}

/** Só as linhas que têm valor — uma ponte cheia de zeros não se lê. */
export function significantLines(bridge: Bridge): readonly BridgeLine[] {
  return bridge.lines.filter((line) => line.amount !== 0n);
}
