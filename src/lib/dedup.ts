/**
 * The dedup hash of a cash entry (SPEC §7).
 *
 * `sha256(account | date | amount | direction | normalised description)`. It exists so
 * importing the same statement twice cannot create the same movement twice — the unique
 * index on `(entity_id, dedup_hash)` is what actually enforces it, this only computes it.
 *
 * Manual typing uses the same hash on purpose: if you type a movement the import already
 * brought in, the database refuses it and the form asks whether you really meant it.
 * That is why `suffix` exists — it is how a genuine second identical entry (two R$ 30
 * lunches on the same card, same day) gets through, explicitly.
 */

import { createHash } from "node:crypto";
import type { Cents } from "@/lib/money";
import { toNumeric } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { EntryDirection } from "@/lib/ledger-types";

/** Upper case, no accents, single spaces. Statement text is noisy; this makes it comparable. */
export function normalizeDescription(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type DedupSubject = {
  accountId: string;
  occurredOn: IsoDate;
  amount: Cents;
  direction: EntryDirection;
  description: string;
  /**
   * Who the money went to or came from.
   *
   * Without this, a payroll run is destroyed: the Itaú statement writes `PIX ENVIADO` in
   * the description and puts the person in a separate column, so four payments of
   * R$ 4.000 on the same day to four different people hash identically — and three of
   * them would be marked as duplicates and never reach the ledger. Found on the first
   * real import; 29 groups were affected.
   *
   * Prefer the tax id, which is stable; fall back to the name.
   */
  counterparty?: string | null;
  /**
   * Which occurrence of an otherwise identical movement this is, counting from zero.
   *
   * Two genuinely identical lines can appear in one statement — the same supplier paid
   * twice for the same amount on the same day. They are different movements, and the
   * index is what keeps them apart while still letting a re-import of the same file match
   * them one for one.
   */
  suffix?: number;
};

export function dedupHash(subject: DedupSubject): string {
  const parts = [
    subject.accountId,
    subject.occurredOn,
    toNumeric(subject.amount),
    subject.direction,
    normalizeDescription(subject.description),
  ];

  const counterparty = subject.counterparty?.trim();
  if (counterparty) parts.push(normalizeDescription(counterparty));

  if (subject.suffix !== undefined && subject.suffix > 0) parts.push(`#${subject.suffix}`);

  return createHash("sha256").update(parts.join("|")).digest("hex");
}

// ---------------------------------------------------------------------------
// Segunda camada: o mesmo movimento escrito com outro texto (D142)
// ---------------------------------------------------------------------------

/** Um movimento, visto só pelo que não muda entre exports do mesmo banco. */
export type MovimentoPorDocumento = {
  occurredOn: IsoDate;
  /** Magnitude, como no resto do razão; o sentido está em `direction`. */
  amount: Cents;
  direction: EntryDirection;
  counterpartyTaxId: string | null;
};

const soDigitos = (texto: string | null): string => (texto ?? "").replace(/\D/g, "");

const chaveDocumento = (m: MovimentoPorDocumento): string =>
  `${m.occurredOn}|${m.amount}|${m.direction}|${soDigitos(m.counterpartyTaxId)}`;

/**
 * Quais linhas novas são o mesmo movimento de uma linha que já está no razão, **mesmo com a
 * descrição escrita de outro jeito**.
 *
 * O hash acima usa a descrição, e o Itaú não escreve o mesmo movimento do mesmo jeito em
 * todo export: o extrato de 25/08 traz `SAÍDA BOLETO  PAGO PRUDENTIAL` onde o razão tem
 * `BOLETO PAGO PRUDENTIAL`, e `RECEBIMENTOS SISPAG FAST ESCOVA FRANCHI` onde o razão tem
 * `RECEBIMENTOS`. Medido naquele arquivo: 248 movimentos, todos já no razão, e o hash
 * reconhecia **73**. Os outros 175 entrariam em duplicata. O CPF/CNPJ da contraparte, esse,
 * era o mesmo dos dois lados.
 *
 * Então esta camada compara **data, valor, sentido e documento da contraparte**, e só isso.
 * Ela não substitui o hash, soma-se a ele — com as duas, aquele arquivo fecha 248 de 248.
 *
 * Três travas, e cada uma impede um erro diferente:
 *
 *   - **Só linha com documento.** Sem CPF/CNPJ, `data + valor` sozinhos juntariam dois
 *     movimentos diferentes que só coincidem no valor. Linha sem documento fica com o hash.
 *   - **Um para um.** Duas mensalidades de R$ 388,76 da Intermédica no mesmo dia são duas; se
 *     o razão tem uma, uma das novas é duplicata e a outra entra. É a mesma regra do índice
 *     de ocorrência do hash (D78), contada por quantidade.
 *   - **O que o hash já reconheceu não pode ser reconhecido de novo.** Uma linha do razão
 *     que já casou com outra linha pelo hash sai do estoque antes desta camada rodar — sem
 *     isso, a mesma linha do razão "absolveria" duas linhas novas.
 *
 * Quem chama passa só o razão **da mesma conta** e do intervalo do arquivo.
 */
export function duplicatasPorDocumento(
  novos: readonly MovimentoPorDocumento[],
  jaDuplicata: readonly boolean[],
  razao: readonly (MovimentoPorDocumento & { dedupHash: string })[],
  hashesJaCasados: ReadonlySet<string>,
): boolean[] {
  const estoque = new Map<string, number>();
  for (const linha of razao) {
    if (hashesJaCasados.has(linha.dedupHash)) continue;
    if (soDigitos(linha.counterpartyTaxId) === "") continue;
    const chave = chaveDocumento(linha);
    estoque.set(chave, (estoque.get(chave) ?? 0) + 1);
  }

  return novos.map((novo, i) => {
    if (jaDuplicata[i] === true) return true;
    if (soDigitos(novo.counterpartyTaxId) === "") return false;
    const chave = chaveDocumento(novo);
    const disponivel = estoque.get(chave) ?? 0;
    if (disponivel === 0) return false;
    estoque.set(chave, disponivel - 1);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Terceira camada: o documento apareceu de um lado só
// ---------------------------------------------------------------------------

/** O movimento com o texto que o banco escreveu e o nome de quem pagou ou recebeu. */
export type MovimentoPorNome = MovimentoPorDocumento & {
  description: string;
  counterpartyName: string | null;
};

const chaveNome = (m: MovimentoPorNome): string =>
  [
    m.occurredOn,
    m.amount,
    m.direction,
    normalizeDescription(m.description),
    normalizeDescription(m.counterpartyName ?? ""),
  ].join("|");

/**
 * Quais linhas novas são o mesmo movimento de uma linha do razão em que **só um dos dois
 * lados trouxe o CPF/CNPJ**.
 *
 * O hash usa o documento quando há e o nome quando não há; a segunda camada exige documento
 * dos dois lados. O que fica entre as duas: a leitura de print. Em 03/11 os prints da Conta
 * BS2 trouxeram o PIX de R$ 6.300 da FE FRANCHISING de 22/10 só com o nome; em 11/11 novos
 * prints da mesma conta trouxeram o mesmo PIX **com** o CNPJ. Hash diferente, segunda camada
 * cega, e a linha voltou como pendente — aprovar contaria a receita duas vezes.
 *
 * Esta camada compara data, valor, sentido, descrição e **nome** da contraparte — tudo o que
 * o hash compara, menos o documento. As travas:
 *
 *   - **Só quando exatamente um lado tem documento.** Com documento dos dois lados, quem
 *     decide é a segunda camada; sem documento em nenhum, o próprio hash já usou o nome.
 *     Isso também impede que esta camada gaste uma linha do razão que a segunda já usou:
 *     a segunda só consome linhas com documento para linhas novas com documento, e esta
 *     só casa linha nova com documento contra razão sem, e vice-versa.
 *   - **Nome e descrição presentes e iguais.** Sem nome, data + valor + "PIX RECEBIDO"
 *     juntariam dois pagadores diferentes.
 *   - **Um para um**, e o que o hash já reconheceu sai do estoque — como na segunda camada.
 */
export function duplicatasPorNome(
  novos: readonly MovimentoPorNome[],
  jaDuplicata: readonly boolean[],
  razao: readonly (MovimentoPorNome & { dedupHash: string })[],
  hashesJaCasados: ReadonlySet<string>,
): boolean[] {
  const temDoc = (m: MovimentoPorDocumento) => soDigitos(m.counterpartyTaxId) !== "";
  const temNome = (m: MovimentoPorNome) => normalizeDescription(m.counterpartyName ?? "") !== "";

  // Dois estoques: linhas do razão com documento só servem a linhas novas sem, e o inverso.
  const estoque = { comDoc: new Map<string, number>(), semDoc: new Map<string, number>() };
  for (const linha of razao) {
    if (hashesJaCasados.has(linha.dedupHash) || !temNome(linha)) continue;
    const alvo = temDoc(linha) ? estoque.comDoc : estoque.semDoc;
    const chave = chaveNome(linha);
    alvo.set(chave, (alvo.get(chave) ?? 0) + 1);
  }

  return novos.map((novo, i) => {
    if (jaDuplicata[i] === true) return true;
    if (!temNome(novo)) return false;
    const alvo = temDoc(novo) ? estoque.semDoc : estoque.comDoc;
    const chave = chaveNome(novo);
    const disponivel = alvo.get(chave) ?? 0;
    if (disponivel === 0) return false;
    alvo.set(chave, disponivel - 1);
    return true;
  });
}
