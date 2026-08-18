/**
 * De quem é esse dinheiro que entrou.
 *
 * Sobram 67 entradas sem categoria no razão. A pergunta que resolve a maioria delas não é
 * "em qual conta isso cai" — é "quem mandou". O extrato do Itaú traz o documento da
 * contraparte, e a D40 já diz que **identidade vence texto**; o que falta é ligar o
 * documento a um cliente e, quando der, ao contrato dele.
 *
 * A regra que separa os casos é o **tipo do documento**, e ela é estrutural, não uma lista
 * de exceções:
 *
 *   - **11 dígitos é CPF, e CPF nunca é cliente.** É pessoa: devolução de pagamento,
 *     reembolso, quitação pessoal. São exatamente as duas devoluções do Ricardo
 *     (R$ 165.000) e um Roberto — dinheiro que entrou e não é receita de ninguém. Tratar
 *     pessoa física como cliente inventaria R$ 170 mil de receita que não existe, e é o
 *     mesmo erro da D83 entrando por outra porta.
 *   - **14 dígitos é CNPJ, e CNPJ é empresa.** Ou já é um cliente cadastrado, e a linha só
 *     precisa ser ligada a ele; ou não é, e o próprio extrato traz o nome legal para
 *     cadastrar sem inventar nada.
 *   - **Sem documento não há identidade.** `OP REC EXT` e `BOLETOS RECEBIDOS` não nomeiam
 *     ninguém, e nenhuma regra de texto vai consertar isso: a informação não está no
 *     arquivo.
 *
 * Sobre a conta de receita, o critério é o do `propose-parties`: **ambiguidade é motivo
 * para não propor.** Um cliente com um contrato de projeto *e* um de retainer alcança duas
 * contas diferentes, e adivinhar qual delas trocaria um "não sei" honesto por um número
 * errado que ninguém mais confere.
 *
 * O que desempata sem chutar está em `resolveRevenueCategory`, e o mais forte é a
 * **vigência**: *dinheiro não paga contrato que ainda não existia*. É impossibilidade, não
 * probabilidade, e sozinha resolve mais casos reais do que o casamento por valor.
 *
 * Vale lembrar por que isso é seguro: categorizar uma **entrada** não cria competência.
 * `planCashMirror` só espelha custo, e receita nasce de contrato e NF (SPEC §5). Ligar
 * cliente e conta numa entrada arruma o fluxo de caixa e a margem por cliente sem mover um
 * centavo da DRE — o `verify:reconcile` continua fechando em zero.
 */

import type { Cents } from "@/lib/money";

export type ContractType = "retainer" | "project";

/** Um contrato do cliente, com a conta de receita já resolvida pelo chamador. */
export type ClientContract = {
  id: string;
  name: string;
  type: ContractType;
  /** `contracts.category_id`, ou o padrão do tipo quando ele é nulo. */
  revenueCategoryId: string;
  monthlyValue: Cents | null;
  /** `YYYY-MM-DD`, ou null quando o contrato não declara início. */
  startDate: string | null;
};

export type KnownClient = {
  id: string;
  name: string;
  contracts: readonly ClientContract[];
};

export type Receipt = {
  /** Só os dígitos. Vazio quando o extrato não trouxe documento. */
  document: string;
  counterpartyName: string | null;
  amount: Cents;
  /** `YYYY-MM-DD`. Serve para descartar contrato que ainda não existia. */
  occurredOn: string;
};

export type ReceiptVerdict =
  /** Não dá para identificar, e nenhuma regra de texto conserta. */
  | { kind: "sem-identidade"; reason: "sem-documento" | "documento-invalido" }
  /** Pessoa física: não é cliente, e não é receita. */
  | { kind: "pessoa-fisica" }
  /** CNPJ conhecido: liga o cliente, e a conta quando ela é inequívoca. */
  | {
      kind: "cliente-conhecido";
      clientId: string;
      clientName: string;
      categoryId: string | null;
      /** Por que a conta foi (ou não foi) escolhida. */
      basis: Basis;
    }
  /** CNPJ novo: o extrato traz o nome legal, e cadastrar não inventa nada. */
  | { kind: "cliente-novo"; name: string; document: string };

const CNPJ_LENGTH = 14;
const CPF_LENGTH = 11;

export function documentKind(document: string): "cnpj" | "cpf" | "vazio" | "invalido" {
  if (document === "") return "vazio";
  if (document.length === CNPJ_LENGTH) return "cnpj";
  if (document.length === CPF_LENGTH) return "cpf";
  return "invalido";
}

export type Basis =
  | "conta-unica"
  | "unico-contrato-vigente"
  | "valor-bate-com-mensalidade"
  | "ambiguo"
  | "sem-contrato";

/**
 * Qual conta de receita a entrada alcança, ou `null` quando o cliente tem contratos que
 * apontam para contas diferentes e nada desempata.
 *
 * Os desempates, do mais duro para o mais frouxo:
 *
 *   1. **Todos os contratos na mesma conta.** Não há o que desempatar.
 *   2. **Vigência.** *Dinheiro não paga contrato que ainda não existia.* Um recebimento
 *      anterior ao início de um contrato não pode ser dele — é o único critério aqui que
 *      é impossibilidade, não probabilidade. Resolve os R$ 10.000 da Hogrefe em 16/06,
 *      quando o retainer dela só começa em 01/07, e os R$ 8.000 da CSO em 06/02, com o
 *      retainer começando em 01/06.
 *   3. **Valor igual à mensalidade de um contrato só.**
 *
 * O que deliberadamente *não* é critério: "parece um retainer porque repete todo mês".
 * Repetição é evidência para um humano olhar, não para o código decidir — o relatório
 * `decisoes` a imprime, e para por aí.
 */
export function resolveRevenueCategory(
  client: KnownClient,
  amount: Cents,
  occurredOn: string,
): { categoryId: string | null; basis: Basis } {
  if (client.contracts.length === 0) return { categoryId: null, basis: "sem-contrato" };

  const accounts = new Set(client.contracts.map((contract) => contract.revenueCategoryId));
  if (accounts.size === 1) {
    return { categoryId: client.contracts[0]!.revenueCategoryId, basis: "conta-unica" };
  }

  // Um contrato sem data de início não pode ser descartado: não declarar vigência não é
  // o mesmo que não estar vigente.
  const vigentes = client.contracts.filter(
    (contract) => contract.startDate === null || contract.startDate <= occurredOn,
  );
  const contasVigentes = new Set(vigentes.map((contract) => contract.revenueCategoryId));
  if (vigentes.length > 0 && contasVigentes.size === 1) {
    return { categoryId: vigentes[0]!.revenueCategoryId, basis: "unico-contrato-vigente" };
  }

  // O valor desempata quando bate com a mensalidade de um contrato só. Dois contratos com
  // a mesma mensalidade não desempatam nada, e aí continua ambíguo.
  const candidatos = vigentes.length > 0 ? vigentes : client.contracts;
  const exact = candidatos.filter(
    (contract) => contract.monthlyValue !== null && contract.monthlyValue === amount,
  );
  if (exact.length === 1) {
    return { categoryId: exact[0]!.revenueCategoryId, basis: "valor-bate-com-mensalidade" };
  }

  return { categoryId: null, basis: "ambiguo" };
}

export function judgeReceipt(
  receipt: Receipt,
  clientsByDocument: ReadonlyMap<string, KnownClient>,
): ReceiptVerdict {
  const kind = documentKind(receipt.document);

  if (kind === "vazio") return { kind: "sem-identidade", reason: "sem-documento" };
  if (kind === "invalido") return { kind: "sem-identidade", reason: "documento-invalido" };
  if (kind === "cpf") return { kind: "pessoa-fisica" };

  const client = clientsByDocument.get(receipt.document);
  if (client) {
    const { categoryId, basis } = resolveRevenueCategory(
      client,
      receipt.amount,
      receipt.occurredOn,
    );
    return {
      kind: "cliente-conhecido",
      clientId: client.id,
      clientName: client.name,
      categoryId,
      basis,
    };
  }

  const name = receipt.counterpartyName?.trim();
  if (!name) return { kind: "sem-identidade", reason: "sem-documento" };
  return { kind: "cliente-novo", name, document: receipt.document };
}

export const VERDICT_LABEL: Record<string, string> = {
  "sem-documento": "o extrato não nomeia ninguém — nenhuma regra de texto resolve",
  "documento-invalido": "documento com tamanho que não é CPF nem CNPJ",
  "pessoa-fisica": "CPF — é pessoa, não cliente; a entrada não é receita",
  "conta-unica": "todos os contratos do cliente apontam para a mesma conta",
  "unico-contrato-vigente":
    "só um contrato já tinha começado nessa data — dinheiro não paga contrato que não existia",
  "valor-bate-com-mensalidade": "o valor bate exatamente com a mensalidade de um contrato",
  ambiguo: "o cliente tem contratos em contas diferentes e nada desempata",
  "sem-contrato": "cliente sem contrato cadastrado — a conta é decisão sua",
};
