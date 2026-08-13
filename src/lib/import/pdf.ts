/**
 * Turning a PDF into positioned text.
 *
 * The card invoice is laid out in two columns, and reading it as lines interleaves them —
 * `19/01 Uber ... 07/01 POSTO DE SER` on one line, from opposite sides of the page
 * (DECISIONS A6). So the parser needs coordinates, not text, and this is the only place
 * that talks to `unpdf`.
 */

import type { PositionedItem, PdfPage } from "@/lib/import/layout";

/**
 * pdf.js reaches for `Math.sumPrecise`, which Node 24 does not ship. Without this it
 * warns on every page and falls back; with it, the arithmetic is the one pdf.js intended.
 */
function ensureSumPrecise(): void {
  const target = Math as unknown as { sumPrecise?: (values: Iterable<number>) => number };
  if (typeof target.sumPrecise === "function") return;
  target.sumPrecise = (values: Iterable<number>) => {
    // Kahan summation: enough precision for glyph positions, and no dependency.
    let total = 0;
    let compensation = 0;
    for (const value of values) {
      const adjusted = value - compensation;
      const next = total + adjusted;
      compensation = next - total - adjusted;
      total = next;
    }
    return total;
  };
}

export async function readPdfPages(bytes: Uint8Array): Promise<PdfPage[]> {
  ensureSumPrecise();

  const { getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(bytes);
  const pages: PdfPage[] = [];

  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const items: PositionedItem[] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const text = item.str.trim();
      if (text === "") continue;
      const transform = item.transform as number[];
      items.push({
        text,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        width: item.width ?? 0,
      });
    }

    pages.push({ number, items });
  }

  return pages;
}
