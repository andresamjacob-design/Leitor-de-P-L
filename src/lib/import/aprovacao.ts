/**
 * Quando um arquivo enviado pode ir para o razão sem ninguém olhar (D145).
 *
 * O Andre pediu em 05/10: *"os documentos ficam aguardando revisão, quero que o sistema já
 * faça tudo sozinho e me dê o fluxo pronto"*. A revisão existia por uma razão — linha
 * duplicada ou faltando é dinheiro que o app inventa ou esquece. Então ela não some: ela é
 * trocada por uma conferência que o próprio banco assina.
 *
 * **Extrato:** o extrato declara o saldo da conta no fim do período. Se o saldo do razão até
 * aquele dia, mais as linhas novas, der **exatamente** esse número, nada sobra e nada falta —
 * e vai sozinho. Se não der, uma linha está a mais ou a menos (o boleto de R$ 8.300 partido
 * em dois, D142, é o caso que se conhece), e o arquivo fica esperando, com a diferença escrita.
 * É a prioridade dele desde 14/09 (D136): categorizar a maioria, e **não ter disparidade com
 * o banco**.
 *
 * **Fatura:** não tem saldo de conta para conferir, mas a leitura já foi recusada lá atrás se
 * as compras não somassem o total impresso nela (D-B). Passou dali, vai sozinha.
 *
 * Linha sem categoria **entra** do mesmo jeito: o saldo é do banco, a categoria é opinião
 * sobre ele (D135). Ela aparece no fluxo como "Sem categoria" e no `pendencias`, nunca some.
 *
 * Puro: recebe os números, devolve a decisão.
 */

import { formatBRL, type Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";

export type LinhaNova = { occurredOn: IsoDate; amount: Cents; direction: EntryDirection };

export type DecisaoAutomatica =
  | { aprovar: true }
  | { aprovar: false; motivo: string; diferenca: Cents | null };

export function decidirAprovacao({
  conta,
  saldoNoRazao,
  fechamento,
  novas,
}: {
  conta: "caixa" | "cartao";
  /** Saldo da conta no razão até o dia do fechamento, antes das linhas novas. */
  saldoNoRazao: Cents | null;
  /** O saldo que o extrato declara no último dia dele. */
  fechamento: { data: IsoDate; saldo: Cents } | null;
  /** As linhas que entrariam — sem as que já são duplicata. */
  novas: readonly LinhaNova[];
}): DecisaoAutomatica {
  if (novas.length === 0) return { aprovar: true };
  if (conta === "cartao") return { aprovar: true };

  if (fechamento === null || saldoNoRazao === null) {
    return {
      aprovar: false,
      motivo: "o extrato não declara o saldo do fim do período, então não dá para conferir com o banco.",
      diferenca: null,
    };
  }

  // Só as linhas até o dia conferido entram na conta; as de depois (exportação no meio do
  // dia) não têm saldo do banco para conferir, e serão conferidas pelo próximo extrato.
  const projetado = novas
    .filter((l) => l.occurredOn <= fechamento.data)
    .reduce((saldo, l) => saldo + (l.direction === "in" ? l.amount : -l.amount), saldoNoRazao);
  const diferenca = fechamento.saldo - projetado;
  if (diferenca === 0n) return { aprovar: true };

  return {
    aprovar: false,
    motivo:
      `com estas linhas o saldo do app ficaria ${formatBRL(projetado)}, e o extrato diz ` +
      `${formatBRL(fechamento.saldo)} — ${formatBRL(diferenca < 0n ? -diferenca : diferenca)} ` +
      `${diferenca < 0n ? "a mais no app: alguma linha provavelmente já estava lá" : "a menos no app: falta alguma linha"}. ` +
      "Confira antes de aprovar.",
    diferenca,
  };
}

/**
 * O saldo que serve de ponto de conferência: o de data mais recente que **fecha um dia**.
 *
 * O extrato do Itaú termina com `SALDO EM CONTA CORRENTE`, uma fotografia tirada na hora da
 * exportação. Ele não fecha dia nenhum e difere do fechamento pelo rendimento da aplicação
 * automática que ainda não foi pago — o leitor já o registrava sem usar como checkpoint
 * (D35). A primeira versão da aprovação automática usava o de data mais recente, e o extrato
 * de 24/09 ficaria parado por R$ 7,08 que não eram linha nenhuma: o fechamento de 22/09,
 * `SALDO TOTAL DISPONÍVEL DIA`, bate com o app ao centavo.
 */
export function saldoDeConferencia(
  declarados: readonly { date: IsoDate; balance: Cents; label: string }[],
): { data: IsoDate; saldo: Cents } | null {
  const fotografia = (label: string) => /saldo em conta corrente/i.test(label);
  const melhor = declarados
    .filter((b) => !fotografia(b.label))
    .reduce<(typeof declarados)[number] | null>((a, b) => (a === null || b.date > a.date ? b : a), null);
  return melhor ? { data: melhor.date, saldo: melhor.balance } : null;
}
