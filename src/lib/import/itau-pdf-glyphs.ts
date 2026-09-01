/**
 * Decodificador do extrato em PDF impresso pelo app do Itaú.
 *
 * A Q13 dava esses arquivos como ilegíveis, e a razão registrada era "fonte é subconjunto
 * sem mapa Unicode". A primeira metade está certa — a fonte embutida é um subset **sem
 * tabela `cmap`**. A segunda metade é pior do que parecia:
 *
 * > **O `/ToUnicode` do próprio PDF está errado.** Ele declara `<001c><0025><0030>`, isto
 * > é, que os glifos `0x1c`–`0x25` são os dígitos `0`–`9`. Texto conhecido prova que são as
 * > letras `G`–`P`. O arquivo mente sobre si mesmo, e é por isso que toda ferramenta
 * > devolve lixo: quem confia no mapa erra, e quem o ignora não tem mapa nenhum.
 *
 * O mapa de verdade é trivial depois de visto — dois blocos contíguos, sem buraco:
 *
 *   | CID           | conteúdo |
 *   |---------------|----------|
 *   | `0x06`–`0x0f` | `0`–`9`  |
 *   | `0x16`–`0x2f` | `A`–`Z`  |
 *
 * mais a pontuação que o extrato usa: espaço, `.`, `,`, `-`, `/`, `:`.
 *
 * Como foi derivado, e por que dá para confiar: casando o texto que **já se sabia estar
 * ali**. `PAGAMENTOS A FORNECEDORES` tem 25 letras e o item tem 25 glifos, um a um sem
 * conflito; `RICARDO DE CARVALHO CUSTODIO JUNIOR` fecha as demais. A prova independente é o
 * documento da contraparte sair formatado sozinho — `398.805.388-03`, um CPF com pontos e
 * traço nos lugares certos, que nenhuma tabela errada produziria por acaso.
 *
 * Por que isso vale o esforço: esses PDFs cobrem **janeiro a março de 2026**, o período em
 * que o extrato do Itaú vinha com os pagamentos **agregados em lotes SISPAG** — R$ 1,22
 * milhão que o razão tem como saída sem contraparte nenhuma, 95% de todo o custo que falta
 * na DRE. O PDF traz os mesmos meses **itemizados, com nome e CPF/CNPJ**.
 *
 * ⚠️ O mapa vale para o produtor que gerou estes arquivos. `decodeItauGlyphs` não adivinha:
 * devolve `<xx>` para o que não conhece, e `glyphCoverage` mede quanto foi realmente
 * decodificado, para o chamador poder recusar um PDF de outra origem em vez de aceitar
 * nomes plausíveis e errados.
 */

/** Blocos contíguos do subset. */
const BLOCKS: readonly { from: number; alphabet: string }[] = [
  { from: 0x06, alphabet: "0123456789" },
  { from: 0x16, alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
];

/** Pontuação e separadores, observados no extrato. */
const PUNCTUATION: ReadonlyMap<number, string> = new Map([
  [0x01, " "],
  [0x02, "."],
  [0x03, " "],
  [0x04, ","],
  [0x05, ":"],
  [0x11, "&"],
  [0x12, "-"],
  [0x15, "/"],
]);

const table = new Map<number, string>(PUNCTUATION);
for (const block of BLOCKS) {
  for (let i = 0; i < block.alphabet.length; i += 1) {
    table.set(block.from + i, block.alphabet[i] as string);
  }
}

/** O mapa completo, exposto para teste e auditoria. */
export const GLYPH_TABLE: ReadonlyMap<number, string> = table;

/** Um glifo desconhecido vira `<xx>`, para o problema aparecer em vez de virar dado errado. */
export function decodeGlyphs(cids: readonly number[]): string {
  return cids
    .map((cid) => table.get(cid) ?? `<${cid.toString(16).padStart(2, "0")}>`)
    .join("");
}

/** Que fração dos glifos a tabela reconheceu. Portão contra PDF de outro produtor. */
export function glyphCoverage(cids: readonly number[]): number {
  if (cids.length === 0) return 0;
  let known = 0;
  for (const cid of cids) if (table.has(cid)) known += 1;
  return known / cids.length;
}
