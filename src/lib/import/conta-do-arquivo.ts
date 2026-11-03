/**
 * Qual conta um arquivo importado é, lido de dentro do próprio arquivo (D143).
 *
 * A tela de importação pedia que o Andre escolhesse a conta num menu — que abria em
 * `Contabilizei — conta corrente`, a conta **inativa**. Um extrato do Itaú enviado sem mexer
 * no menu iria para a conta errada. E o arquivo já diz de quem é: o leitor de cada formato
 * extrai a identidade dele, e até aqui ela só servia para *avisar* do engano depois.
 *
 * Medido nos arquivos reais:
 *
 * | arquivo | o que ele diz | conta cadastrada |
 * |---|---|---|
 * | extrato Itaú (.xlsx) | conta `0098873-4` | `Itaú — conta corrente`, número `0098873-4` |
 * | extrato Contabilizei (.pdf) | conta `3111117-6` | `Contabilizei`, número `3111117-6` |
 * | fatura (.pdf) | conta final `5780` | `Itaucard Empresas`, final `5780` |
 * | fatura (.pdf) | conta final `8384`, cartão `8299` | `Itaucard`, final `8299` |
 *
 * A última linha é a armadilha: a fatura imprime o final da **conta de cobrança** (8384), e
 * a conta foi cadastrada com o final do **cartão** (8299), que é o único dela. O nome do
 * arquivo também não ajuda — `Itaucard_4740_…` é um dos sete cartões da conta 5780. Por isso
 * a regra de fatura aceita o final da conta **ou** o de qualquer cartão impresso nela.
 *
 * Puro: recebe a identidade já lida e as contas, devolve a conta ou o motivo de não achar.
 */

import type { AccountType } from "@/lib/ledger-types";

export type ContaCandidata = {
  id: string;
  name: string;
  type: AccountType;
  number: string | null;
  lastDigits: string | null;
  /** Só o print usa, quando a tela mostra o banco e não o número da conta. */
  institution?: string | null;
  active?: boolean;
};

export type IdentidadeDoArquivo =
  /** Extrato de conta corrente: o número da conta impresso no arquivo. */
  | { tipo: "extrato"; conta: string | null }
  /** Fatura de cartão: o final da conta de cobrança e o final de cada cartão listado. */
  | { tipo: "fatura"; finalDaConta: string | null; finaisDosCartoes: readonly string[] }
  /**
   * Print da tela do banco (D168): o número, se a tela mostrar; senão o nome do banco, que
   * só decide quando uma única conta cadastrada é daquele banco.
   */
  | { tipo: "print"; banco: string | null; conta: string | null };

export type ContaEncontrada = { ok: true; conta: ContaCandidata } | { ok: false; motivo: string };

/** Só os dígitos, sem zero à esquerda: `0098873-4` e `98873-4` são a mesma conta. */
function numero(texto: string | null): string {
  return (texto ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

const ehCartao = (conta: ContaCandidata) => conta.type === "credit_card";

/**
 * O nome do banco reduzido ao que identifica: `Banco BS2 S.A.` e `BS2` dão `bs2`. O que
 * sobra depois de tirar "banco", "s.a." e pontuação é o nome.
 */
function palavra(texto: string | null): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bbanco\b|\bs\.?\s?a\.?(?=\s|$)|\bbank\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function contaDoArquivo(
  identidade: IdentidadeDoArquivo,
  contas: readonly ContaCandidata[],
): ContaEncontrada {
  if (identidade.tipo === "print") {
    const caixa = contas.filter((c) => !ehCartao(c));
    // 1. O número na tela, se a IA leu um que existe.
    if (numero(identidade.conta) !== "") {
      const pelo = contaDoArquivo({ tipo: "extrato", conta: identidade.conta }, caixa);
      if (pelo.ok) return pelo;
    }
    // 2. O nome do banco na tela.
    const banco = palavra(identidade.banco);
    if (banco !== "") {
      const achadas = caixa.filter((c) => palavra(`${c.institution ?? ""} ${c.name}`).includes(banco));
      if (achadas.length === 1) return { ok: true, conta: achadas[0] as ContaCandidata };
    }
    // 3. O que a tela diz não bateu (o Andre em 03/11: "tente tirar essa restrição"). Print
    //    só vem de banco que não exporta, e é a conta corrente ativa cadastrada sem número —
    //    as que exportam têm o número, porque é por ele que o extrato delas é reconhecido.
    const semExport = caixa.filter((c) => c.type === "bank" && c.active !== false && numero(c.number) === "");
    return escolher(
      semExport,
      "não achei a conta destes prints. Cadastre a conta do banco em Contas e envie de novo.",
      `há ${semExport.length} contas correntes sem número cadastrado (` +
        `${semExport.map((c) => c.name).join(", ")}), e o print não diz de qual é.`,
    );
  }

  if (identidade.tipo === "extrato") {
    const lida = numero(identidade.conta);
    if (lida === "") {
      return { ok: false, motivo: "o extrato não diz o número da conta, então não sei de quem ele é." };
    }
    const achadas = contas.filter((c) => !ehCartao(c) && numero(c.number) === lida);
    return escolher(
      achadas,
      `o extrato é da conta ${identidade.conta}, e nenhuma conta cadastrada tem esse número. ` +
        "Cadastre o número em Contas e envie de novo.",
      `mais de uma conta cadastrada tem o número ${identidade.conta}.`,
    );
  }

  const finais = new Set(
    [identidade.finalDaConta, ...identidade.finaisDosCartoes]
      .map((f) => (f ?? "").replace(/\D/g, ""))
      .filter((f) => f !== ""),
  );
  if (finais.size === 0) {
    return {
      ok: false,
      motivo: "não reconheci este PDF como fatura do Itaú nem como extrato da Contabilizei.",
    };
  }
  const achadas = contas.filter(
    (c) => ehCartao(c) && c.lastDigits !== null && finais.has(c.lastDigits.replace(/\D/g, "")),
  );
  const lista = [...finais].join(", ");
  return escolher(
    achadas,
    `a fatura é da conta final ${identidade.finalDaConta ?? "?"} (cartões ${lista}), e nenhum ` +
      "cartão cadastrado termina assim. Cadastre o cartão em Contas e envie de novo.",
    `mais de um cartão cadastrado bate com os finais ${lista} desta fatura.`,
  );
}

/** Uma conta só é resposta. Zero ou duas são o motivo de não decidir — escolher seria chutar. */
function escolher(
  achadas: readonly ContaCandidata[],
  nenhuma: string,
  varias: string,
): ContaEncontrada {
  if (achadas.length === 1) return { ok: true, conta: achadas[0] as ContaCandidata };
  return { ok: false, motivo: achadas.length === 0 ? nenhuma : varias };
}
