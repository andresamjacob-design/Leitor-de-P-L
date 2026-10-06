/**
 * O extrato do Itaú em PDF, o que traz os pagamentos **itemizados**.
 *
 * Este é o formato que resolve o SISPAG. De janeiro a março de 2026 o extrato em XLSX
 * entrega os pagamentos **agregados em lotes** — `SISPAG FORNECEDORES`, sem contraparte
 * nenhuma, R$ 1,22 milhão que o razão carrega como saída anônima. O mesmo período em PDF
 * lista cada pagamento com **nome e CPF/CNPJ**. A partir de abril o próprio XLSX passou a
 * vir itemizado e este leitor deixa de ser necessário.
 *
 * Duas dificuldades, e as duas são de leitura, não de contabilidade:
 *
 *   1. **A fonte mente.** Resolvido em `itau-pdf-glyphs.ts` — o `/ToUnicode` do arquivo
 *      declara um mapa que não é o dele.
 *   2. **A linha não é uma linha.** O nome da contraparte é longo e quebra em duas,
 *      *centralizado verticalmente* sobre a linha da transação: metade acima do `y` da
 *      data, metade abaixo. Agrupar por `y` — o reflexo óbvio — parte cada pagamento em
 *      dois pedaços e perde o valor de vista. Foi o que, numa primeira tentativa, fez
 *      14 dos 19 lotes fecharem e 5 não.
 *
 * A montagem correta é por **proximidade**: cada fragmento pertence à transação cuja data
 * está verticalmente mais próxima. É o que este módulo faz, e o que faz `20/01` fechar —
 * `13.648,98 + 500 + 15.000 + 15.000 = 44.148,98`, o lote exato.
 */

import { decodeGlyphs, glyphCoverage } from "@/lib/import/itau-pdf-glyphs";
import { readGlyphPages } from "@/lib/import/itau-pdf-cids";
import type { GlyphItem } from "@/lib/import/itau-pdf-cids";
import { parseMoney, type Cents } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

/** Uma linha do extrato, já legível. */
export type StatementRow = {
  occurredOn: IsoDate;
  description: string;
  /** Razão social ou nome da pessoa, quando o extrato traz. */
  counterpartyName: string | null;
  /** Só os dígitos. */
  counterpartyTaxId: string | null;
  /** Assinado: negativo é saída. */
  amount: Cents;
};

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MONEY = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const DOCUMENT = /^\d{2,3}\.\d{3}\.\d{3}([-/]\d{2,4})(-\d{2})?$/;

/** Onde cada campo vive na página. Medido nos arquivos reais. */
const COLUMN = {
  date: { from: 0, to: 70 },
  description: { from: 70, to: 200 },
  name: { from: 200, to: 340 },
} as const;

type Piece = { x: number; y: number; text: string };

function pieces(items: readonly GlyphItem[]): Piece[] {
  return items
    .map((item) => ({ x: item.x, y: item.y, text: decodeGlyphs(item.cids).trim() }))
    .filter((piece) => piece.text !== "");
}

function isoOf(text: string): IsoDate | null {
  const m = DATE.exec(text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Quão bem a tabela de glifos explica este arquivo.
 *
 * Serve de portão: um PDF de outro produtor decodificaria para nomes plausíveis e errados,
 * que é pior do que não ler. O cabeçalho usa minúsculas e acentuadas que a tabela não
 * cobre, então a cobertura nunca é 100% — o que importa é não despencar.
 */
export function pdfCoverage(pdf: Buffer): number {
  const cids = readGlyphPages(pdf).flatMap((page) => page.items.flatMap((item) => item.cids));
  return glyphCoverage(cids);
}

export function readItauStatementPdf(pdf: Buffer): StatementRow[] {
  return rowsFromPages(readGlyphPages(pdf).map((page) => page.items));
}

/**
 * A montagem, separada da leitura do arquivo.
 *
 * Exportada porque é aqui que mora a única regra difícil — o nome que quebra em duas linhas
 * — e testá-la não deve exigir um PDF de verdade. Os arquivos reais vivem em
 * `docs/reference/`, que nunca entra no git.
 */
export function rowsFromPages(pages: readonly (readonly GlyphItem[])[]): StatementRow[] {
  const rows: StatementRow[] = [];

  for (const items of pages) {
    const all = pieces(items);

    // As âncoras: cada data na primeira coluna abre uma transação.
    const anchors = all
      .filter((p) => p.x < COLUMN.date.to && isoOf(p.text) !== null)
      .sort((a, b) => b.y - a.y);
    if (anchors.length === 0) continue;

    const buckets = anchors.map((anchor) => ({ anchor, parts: [] as Piece[] }));

    // Cada fragmento vai para a data verticalmente mais próxima — não para a de mesmo `y`.
    for (const piece of all) {
      if (piece.x < COLUMN.date.to && isoOf(piece.text) !== null) continue;
      let best = 0;
      let distance = Infinity;
      for (const [index, bucket] of buckets.entries()) {
        const d = Math.abs(bucket.anchor.y - piece.y);
        if (d < distance) {
          distance = d;
          best = index;
        }
      }
      buckets[best]?.parts.push(piece);
    }

    for (const { anchor, parts } of buckets) {
      const occurredOn = isoOf(anchor.text);
      if (!occurredOn) continue;

      const money = parts.filter((p) => MONEY.test(p.text)).sort((a, b) => b.x - a.x)[0];
      if (!money) continue;

      const document = parts.find((p) => DOCUMENT.test(p.text));
      const description = parts
        .filter((p) => p.x >= COLUMN.description.from && p.x < COLUMN.description.to)
        .sort((a, b) => b.y - a.y)
        .map((p) => p.text)
        .join(" ")
        .trim();

      const name = parts
        .filter(
          (p) =>
            p.x >= COLUMN.name.from &&
            p.x < COLUMN.name.to &&
            !MONEY.test(p.text) &&
            !DOCUMENT.test(p.text),
        )
        .sort((a, b) => b.y - a.y)
        .map((p) => p.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      rows.push({
        occurredOn,
        description,
        counterpartyName: name === "" ? null : name,
        counterpartyTaxId: document ? document.text.replace(/\D/g, "") : null,
        amount: parseMoney(money.text),
      });
    }
  }

  return rows;
}
