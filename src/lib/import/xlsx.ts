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

import { inflateRawSync } from "node:zlib";

export type Cell = string | null;
export type Sheet = { name: string; rows: Cell[][] };

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

type ZipEntry = { name: string; data: Uint8Array };

function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record sits in the last 64KB, after any comment.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("não é um arquivo xlsx: fim do índice do zip não encontrado");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("índice do zip corrompido");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    // The local header repeats the name and extra field, with its own lengths.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);

    const entry: ZipEntry = {
      name,
      data: method === 0 ? raw : new Uint8Array(inflateRawSync(raw)),
    };
    entries.set(entry.name, entry.data);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

type Tag = {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  closing: boolean;
};

/**
 * Walks the document, calling back on every tag and every run of text. Small on purpose:
 * these files are machine-generated, so there are no CDATA sections or DTDs to worry
 * about, but attribute values still have to be scanned with quoting respected.
 */
function scanXml(
  xml: string,
  onTag: (tag: Tag) => void,
  onText: (text: string) => void,
): void {
  let index = 0;

  while (index < xml.length) {
    const start = xml.indexOf("<", index);
    if (start < 0) {
      if (index < xml.length) onText(xml.slice(index));
      return;
    }
    if (start > index) onText(xml.slice(index, start));

    // Skip declarations, comments and processing instructions wholesale.
    if (xml.startsWith("<!--", start)) {
      index = xml.indexOf("-->", start) + 3;
      continue;
    }
    if (xml.startsWith("<?", start) || xml.startsWith("<!", start)) {
      index = xml.indexOf(">", start) + 1;
      continue;
    }

    let cursor = start + 1;
    let quote: string | null = null;
    while (cursor < xml.length) {
      const ch = xml[cursor] as string;
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      cursor += 1;
    }

    const body = xml.slice(start + 1, cursor);
    index = cursor + 1;

    const closing = body.startsWith("/");
    const selfClosing = body.endsWith("/");
    const inner = body.slice(closing ? 1 : 0, selfClosing ? -1 : undefined).trim();

    const space = inner.search(/\s/);
    const name = space < 0 ? inner : inner.slice(0, space);
    const attrs: Record<string, string> = {};

    if (space >= 0) {
      const attrText = inner.slice(space);
      const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(attrText)) !== null) {
        const key = match[1] ?? match[3] ?? "";
        const value = match[2] ?? match[4] ?? "";
        attrs[stripNamespace(key)] = decodeEntities(value);
      }
    }

    onTag({ name: stripNamespace(name), attrs, selfClosing, closing });
  }
}

function stripNamespace(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

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
