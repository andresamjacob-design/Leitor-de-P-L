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
