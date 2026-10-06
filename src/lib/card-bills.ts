/**
 * Quebrar o pagamento da fatura nas compras que ele quitou (D116).
 *
 * ## O problema
 *
 * A D-C tirou o cartão do fluxo de caixa, porque cartão é passivo e não caixa. A D108
 * completou: sem o cartão no relatório, o pagamento da fatura tem **uma perna só** e conta
 * como saída de verdade. Medido contra a aba `Expenses` da planilha do Andre, o total do mês
 * fecha ao centavo em cinco dos sete meses.
 *
 * **O total fecha e a composição não.** A planilha dele quebra a fatura nas categorias das
 * compras — `Gsuite`, `Passagem`, `Alimentação` —, no mês em que a fatura foi paga. O app
 * mostra uma linha só, `Pagamento de fatura de cartão`. Quem lê o fluxo do app não consegue
 * responder *"quanto gastei com viagem em maio"*, e a resposta existe.
 *
 * ## Por que dá para fazer isso sem inventar nada
 *
 * As faturas foram importadas uma a uma, cada arquivo virando uma `statement_imports`. Então
 * **cada importação é uma fatura**, e a soma das compras dela é o valor que o banco pagou.
 * Medido: **13 dos 14 pagamentos de 2026 casam com uma fatura importada, um para um, ao
 * centavo** — sem precisar somar duas.
 *
 * O que não casa fica como estava. O pagamento de R$ 830,97 em 05/06 é a fatura de maio do
 * cartão 8299, que nunca foi importada; ele continua sendo uma linha só, com o nome que
 * sempre teve. Uma quebra parcial que fingisse ser completa seria pior que nenhuma.
 *
 * ## As travas
 *
 *   - **O casamento é por valor exato e um para um.** Nada de "a fatura mais próxima": uma
 *     fatura já usada não casa de novo, e um pagamento sem fatura exata não é quebrado. Isso
 *     também protege da reimportação — o handover conta que 9 dos 34 arquivos são a mesma
 *     fatura sob outro nome, e uma delas soma negativo. Fatura que ninguém pagou nunca entra.
 *   - **A soma é a condição de saída.** As compras de uma fatura somam o pagamento por
 *     construção (é assim que ela foi casada), então trocar um pelo outro **não pode mover o
 *     total do mês**. Se mover, é defeito.
 *   - **As compras vão para a data do pagamento, não a da compra.** É o que faz a linha
 *     aparecer no mês certo do fluxo, e é exatamente por isso que a DRE do app é a da
 *     planilha *alinhada* enquanto o fluxo dela é *um mês à frente* (D114).
 */

import type { Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

export type Compra = {
  categoryId: string | null;
  amount: Cents;
  direction: "in" | "out";
};

/** Uma fatura importada: o arquivo virou um `statement_imports`. */
export type Fatura = {
  importId: string;
  compras: readonly Compra[];
};

/** O pagamento da fatura, na conta corrente. */
export type Pagamento = {
  id: string;
  accountId: string;
  occurredOn: IsoDate;
  amount: Cents;
};

/** O que substitui um pagamento quebrado. */
export type Parte = {
  id: string;
  accountId: string;
  occurredOn: IsoDate;
  amount: Cents;
  direction: "in" | "out";
  categoryId: string | null;
  /**
   * Verdadeiro quando a conta fechou **negativa** dentro daquela fatura — estorno maior que
   * compra no ciclo. Ela desconta das saídas em vez de virar entrada (D113/D116), que é o
   * que a planilha do Andre faz: `Bank Charges` vale −37,50 em abril, dentro da despesa.
   */
  abatesSection?: boolean;
};

export type Quebra = {
  /** Ids dos pagamentos que foram substituídos — o chamador tira estes do relatório. */
  substituidos: ReadonlySet<string>;
  /** As linhas que entram no lugar deles. */
  partes: readonly Parte[];
  /** Pagamentos sem fatura correspondente. Ficam como estavam, e o relatório os nomeia. */
  semFatura: readonly Pagamento[];
};

/** Saída − entrada de uma lista de compras. */
function liquido(compras: readonly Compra[]): Cents {
  return compras.reduce((a, c) => a + (c.direction === "out" ? c.amount : -c.amount), 0n);
}

/**
 * Casa cada pagamento com a fatura de mesmo valor e devolve as compras no lugar dele.
 *
 * O casamento é **um para um e por valor exato**. Duas faturas de mesmo valor casam com dois
 * pagamentos de mesmo valor, em ordem, e nenhuma casa duas vezes.
 */
export function quebrarFaturas(
  pagamentos: readonly Pagamento[],
  faturas: readonly Fatura[],
): Quebra {
  const porValor = new Map<string, Fatura[]>();
  for (const fatura of faturas) {
    const chave = liquido(fatura.compras).toString();
    porValor.set(chave, [...(porValor.get(chave) ?? []), fatura]);
  }

  const substituidos = new Set<string>();
  const partes: Parte[] = [];
  const semFatura: Pagamento[] = [];

  for (const pagamento of pagamentos) {
    const candidatas = porValor.get(pagamento.amount.toString());
    const fatura = candidatas?.shift();
    if (!fatura) {
      semFatura.push(pagamento);
      continue;
    }

    // Uma compra por categoria: a fatura traz dezenas de linhas, e o fluxo quer a conta.
    const porCategoria = new Map<string, Cents>();
    for (const compra of fatura.compras) {
      const chave = compra.categoryId ?? "";
      const sinal = compra.direction === "out" ? compra.amount : -compra.amount;
      porCategoria.set(chave, (porCategoria.get(chave) ?? 0n) + sinal);
    }

    for (const [chave, valor] of porCategoria) {
      if (valor === 0n) continue;
      partes.push({
        // O id não existe em lugar nenhum, e é de propósito: esta linha é uma leitura, não
        // um lançamento. Nada no banco muda.
        id: `${pagamento.id}:${chave || "sem-conta"}`,
        accountId: pagamento.accountId,
        occurredOn: pagamento.occurredOn,
        amount: valor < 0n ? -valor : valor,
        direction: valor < 0n ? "in" : "out",
        ...(valor < 0n ? { abatesSection: true } : {}),
        categoryId: chave === "" ? null : chave,
      });
    }
    substituidos.add(pagamento.id);
  }

  return { substituidos, partes, semFatura };
}
