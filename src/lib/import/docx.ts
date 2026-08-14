/**
 * Text out of a `.docx`.
 *
 * A Word file is a zip of XML, same as a spreadsheet, so it reuses the same zip reader
 * and XML scanner. Only the text is wanted here — a contract goes to the LLM as prose,
 * and its formatting carries nothing the extraction needs.
 *
 * Paragraph and table-cell boundaries are preserved as line breaks, because a contract
 * often puts the value in one cell and its label in the next, and running them together
 * would lose which is which.
 */

import { readZip } from "@/lib/import/zip";
import { decodeEntities, scanXml } from "@/lib/import/xml";

/** `w:p` is a paragraph, `w:tab` a tab, `w:br` a line break, `w:tc` a table cell. */
export function readDocx(bytes: Uint8Array): string {
  const files = readZip(bytes);
  const document = files.get("word/document.xml");
  if (!document) {
    throw new Error("não é um arquivo .docx: word/document.xml não encontrado");
  }

  const xml = new TextDecoder().decode(document);
  const parts: string[] = [];
  let inText = false;

  scanXml(
    xml,
    (tag) => {
      if (tag.name === "t") {
        inText = !tag.closing && !tag.selfClosing;
        return;
      }
      if (tag.closing && (tag.name === "p" || tag.name === "tc")) parts.push("\n");
      if (!tag.closing && tag.name === "tab") parts.push("\t");
      if (!tag.closing && tag.name === "br") parts.push("\n");
    },
    (text) => {
      if (inText) parts.push(decodeEntities(text));
    },
  );

  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
