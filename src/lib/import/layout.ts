/**
 * Rebuilding a page's reading order from coordinates.
 *
 * A PDF has no notion of a line or a column — it has glyphs at positions. These helpers
 * turn that back into "column 1 top to bottom, then column 2", which is how the Itaú
 * invoice is meant to be read (DECISIONS A6).
 *
 * Pure and free of any PDF library, so the layout logic is testable with a handful of
 * made-up coordinates instead of a real statement.
 */

export type PositionedItem = {
  text: string;
  x: number;
  y: number;
  width: number;
};

export type PdfPage = {
  number: number;
  items: PositionedItem[];
};

/** A visual line: items that sit at the same height, left to right. */
export type LayoutLine = {
  y: number;
  items: PositionedItem[];
  /** Which detected column the line belongs to. */
  column: number;
  text: string;
};

/** Items whose baselines differ by less than this are on the same line. */
const LINE_TOLERANCE = 3;

/** Date-like x positions closer together than this belong to the same column. */
const COLUMN_TOLERANCE = 24;

/**
 * How far apart two real columns must be.
 *
 * This has to clear the widest thing that is *not* a column — the amount column of a
 * table, which piles up 172pt right of its dates — while still admitting the narrowest
 * thing that is: the invoices seen put their second column 198pt to 216pt out. Anything
 * in between would be a guess, and 190 sits in the gap.
 *
 * Getting this wrong is not silent: an amount column promoted to a page column tears
 * every amount off its date, and the invoice then fails to reconcile against its own
 * printed total (D-B).
 */
const MIN_COLUMN_GAP = 190;

/** A column has to carry at least this share of the document's text to be one. */
const MIN_COLUMN_SHARE = 0.04;

/**
 * Finds the left edge of each column from where text starts.
 *
 * Dates alone are not enough: some invoices have a right column made entirely of prose
 * and interest tables, with no date in it at all, and reading that as a single column
 * lets `Encargos cobrados nesta fatura` — printed beside the purchases, not below them —
 * close the transaction section halfway through.
 *
 * Text start positions cluster hard on the real column edges (148 and 364 in every Itaú
 * invoice seen so far), so the histogram finds them whatever the page contains.
 */
export function detectColumns(items: readonly PositionedItem[]): number[] {
  const xs = items.map((item) => item.x).sort((a, b) => a - b);
  if (xs.length === 0) return [0];

  const minimumSize = Math.max(3, Math.round(items.length * MIN_COLUMN_SHARE));

  // Peaks, not runs. Chaining nearby positions would swallow a whole table — 288, 296,
  // 302, 310, 316 are each within a few points of the next — and report its left edge as
  // a column. Text that starts a column piles up on one exact position instead.
  const bins = new Map<number, number>();
  for (const x of xs) {
    const bin = Math.round(x / 2) * 2;
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }

  const peaks = [...bins.entries()]
    .filter(([, count]) => count >= minimumSize)
    .map(([bin]) => bin)
    .sort((a, b) => a - b);

  const columns: number[] = [];
  for (const peak of peaks) {
    const previous = columns[columns.length - 1];
    if (previous !== undefined && peak - previous < MIN_COLUMN_GAP) continue;
    columns.push(peak);
  }

  return columns.length > 0 ? columns : [Math.min(...xs)];
}

/** Which column an x falls in: the last column whose left edge is at or before it. */
function columnOf(x: number, columns: readonly number[]): number {
  let index = 0;
  for (const [candidate, left] of columns.entries()) {
    // A little slack, because a wrapped continuation can start marginally left of the
    // column's date position.
    if (x >= left - COLUMN_TOLERANCE / 2) index = candidate;
  }
  return index;
}

/**
 * Groups a page's items into lines, split by column, ordered the way a person reads them:
 * the whole of column 1 top to bottom, then the whole of column 2.
 */
export function toLines(page: PdfPage, knownColumns?: readonly number[]): LayoutLine[] {
  const columns = knownColumns ?? detectColumns(page.items);
  const byColumn = new Map<number, PositionedItem[]>();

  for (const item of page.items) {
    const column = columnOf(item.x, columns);
    byColumn.set(column, [...(byColumn.get(column) ?? []), item]);
  }

  const lines: LayoutLine[] = [];

  for (const column of [...byColumn.keys()].sort((a, b) => a - b)) {
    const items = (byColumn.get(column) as PositionedItem[]).sort((a, b) => b.y - a.y);
    let current: PositionedItem[] = [];

    const flush = () => {
      if (current.length === 0) return;
      const ordered = [...current].sort((a, b) => a.x - b.x);
      lines.push({
        y: ordered[0]?.y ?? 0,
        column,
        items: ordered,
        text: ordered.map((item) => item.text).join(" "),
      });
      current = [];
    };

    for (const item of items) {
      const reference = current[0];
      if (reference && Math.abs(reference.y - item.y) > LINE_TOLERANCE) flush();
      current.push(item);
    }
    flush();
  }

  return lines;
}

/**
 * Every line of every page, in reading order.
 *
 * Columns are detected once across the whole document, not per page. A page whose second
 * column happens to hold no dates — the last page of an invoice, all interest tables —
 * would otherwise look single-column, and its two columns would be merged into one line
 * each: `05/01 ESTORNO ANUIDADE - 83,25 Valor do IOF 15,34` reads the wrong number as the
 * amount. The layout is the same on every page, so the whole document decides it.
 */
export function toDocumentLines(pages: readonly PdfPage[]): LayoutLine[] {
  const columns = detectColumns(pages.flatMap((page) => page.items));
  return pages.flatMap((page) => toLines(page, columns));
}
