/**
 * A minimal XLSX reader: zip + SpreadsheetML, using only `node:zlib`.
 *
 * Why not a library. `exceljs` was the authorised choice (DECISIONS D23), and it **fails
 * on every statement Itaú generates** — the bank writes `<coreProperties>` with an
 * unprefixed `lastModifiedBy`, and exceljs throws `Unexpected xml node in parseOpen`.
 * Three of three real statements were unreadable; only the Google-Sheets-exported
 * workbook loaded. A parser that cannot read the files this system exists to import is
 * not a dependency worth having, so this reads them directly (DECISIONS D34).
 *
 * Scope on purpose: enough SpreadsheetML to read a bank statement — shared strings,
 * inline strings, numbers, and date serials. No formulas, no styles beyond number
 * formats, no writing.
 */

import { readZip } from "@/lib/import/zip";
import { decodeEntities, scanXml } from "@/lib/import/xml";

export type Cell = string | null;
export type Sheet = { name: string; rows: Cell[][] };

// ---------------------------------------------------------------------------
// Number formats
// ---------------------------------------------------------------------------

/** Built-in formats that mean a date or a time (ECMA-376, §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function readDateStyles(stylesXml: string | undefined): Set<number> {
  const dateStyles = new Set<number>();
  if (!stylesXml) return dateStyles;

  const customDateFormats = new Set<number>();
  let inCellXfs = false;
  let styleIndex = 0;

  scanXml(
    stylesXml,
    (tag) => {
      if (tag.name === "numFmt" && !tag.closing) {
        const id = Number(tag.attrs.numFmtId);
        const code = tag.attrs.formatCode ?? "";
        // A format is a date if it mentions day, month or year outside a literal.
        const bare = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
        if (/[dmyhs]/i.test(bare) && /[dy]/i.test(bare)) customDateFormats.add(id);
      }
      if (tag.name === "cellXfs") {
        if (tag.closing) inCellXfs = false;
        else if (!tag.selfClosing) {
          inCellXfs = true;
          styleIndex = 0;
        }
      }
      if (inCellXfs && tag.name === "xf" && !tag.closing) {
        const id = Number(tag.attrs.numFmtId ?? 0);
        if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) {
          dateStyles.add(styleIndex);
        }
        styleIndex += 1;
      }
    },
    () => {},
  );

  return dateStyles;
}

/**
 * Excel counts days from 1900-01-00, and believes 1900 was a leap year. Serial 60 is that
 * phantom 29/02/1900; everything after it is shifted by one.
 */
function serialToIsoDate(serial: number): string {
  const days = Math.floor(serial);
  const epoch = Date.UTC(1899, 11, 31);
  const shifted = days > 59 ? days - 1 : days;
  const date = new Date(epoch + shifted * 86400000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  let current: string[] | null = null;
  let inText = false;

  scanXml(
    xml,
    (tag) => {
      if (tag.name === "si") {
        if (tag.closing) {
          strings.push((current ?? []).join(""));
          current = null;
        } else {
          current = [];
          if (tag.selfClosing) {
            strings.push("");
            current = null;
          }
        }
      }
      if (tag.name === "t") inText = !tag.closing && !tag.selfClosing;
      // `rPh` holds phonetic hints for Japanese; its text is not part of the value.
      if (tag.name === "rPh" && !tag.closing) inText = false;
    },
    (text) => {
      if (inText && current) current.push(decodeEntities(text));
    },
  );

  return strings;
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function readSheet(xml: string, shared: string[], dateStyles: Set<number>): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] | null = null;
  let cell: { index: number; type: string; style: number } | null = null;
  let buffer: string[] = [];
  let inValue = false;
  let inInline = false;

  const flushCell = () => {
    if (!cell || !row) return;
    const raw = buffer.join("");
    buffer = [];

    let value: Cell;
    if (raw === "") {
      value = null;
    } else if (cell.type === "s") {
      value = shared[Number(raw)] ?? null;
    } else if (cell.type === "b") {
      value = raw === "1" ? "TRUE" : "FALSE";
    } else if (cell.type === "inlineStr" || cell.type === "str") {
      value = raw;
    } else if (dateStyles.has(cell.style) && raw !== "" && Number.isFinite(Number(raw))) {
      value = serialToIsoDate(Number(raw));
    } else {
      value = raw;
    }

    while (row.length < cell.index) row.push(null);
    row[cell.index] = value;
    cell = null;
  };

  scanXml(
    xml,
    (tag) => {
      switch (tag.name) {
        case "row":
          if (tag.closing) {
            if (row) rows.push(row);
            row = null;
          } else {
            row = [];
            if (tag.selfClosing) {
              rows.push(row);
              row = null;
            }
          }
          break;
        case "c":
          if (tag.closing) {
            flushCell();
          } else {
            cell = {
              index: columnIndex(tag.attrs.r ?? "A1"),
              type: tag.attrs.t ?? "n",
              style: Number(tag.attrs.s ?? 0),
            };
            buffer = [];
            if (tag.selfClosing) flushCell();
          }
          break;
        case "v":
          inValue = !tag.closing && !tag.selfClosing;
          break;
        case "is":
          inInline = !tag.closing;
          break;
        case "t":
          inValue = inInline && !tag.closing && !tag.selfClosing ? true : inValue;
          if (inInline && tag.closing) inValue = false;
          break;
        default:
          break;
      }
    },
    (text) => {
      if (inValue) buffer.push(decodeEntities(text));
    },
  );

  return rows;
}

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = readZip(bytes);
  const decoder = new TextDecoder();
  const text = (name: string) => {
    const data = files.get(name);
    return data ? decoder.decode(data) : undefined;
  };

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("não é um arquivo xlsx: xl/workbook.xml não encontrado");

  const shared = readSharedStrings(text("xl/sharedStrings.xml"));
  const dateStyles = readDateStyles(text("xl/styles.xml"));

  // Sheet name and order come from workbook.xml; the file each one lives in comes from
  // the relationship id, resolved through workbook.xml.rels.
  const relationships = new Map<string, string>();
  scanXml(
    text("xl/_rels/workbook.xml.rels") ?? "",
    (tag) => {
      if (tag.name === "Relationship" && tag.attrs.Id && tag.attrs.Target) {
        relationships.set(tag.attrs.Id, tag.attrs.Target);
      }
    },
    () => {},
  );

  const sheets: Sheet[] = [];
  scanXml(
    workbook,
    (tag) => {
      if (tag.name !== "sheet" || tag.closing) return;
      const name = tag.attrs.name ?? `Planilha ${sheets.length + 1}`;
      const target = relationships.get(tag.attrs.id ?? "");
      if (!target) return;

      const path = target.startsWith("/")
        ? target.slice(1)
        : target.startsWith("xl/")
          ? target
          : `xl/${target}`;

      const sheetXml = text(path);
      if (sheetXml === undefined) return;
      sheets.push({ name, rows: readSheet(sheetXml, shared, dateStyles) });
    },
    () => {},
  );

  return sheets;
}
