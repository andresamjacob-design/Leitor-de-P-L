import { describe, expect, it } from "vitest";
import { readXlsx } from "@/lib/import/xlsx";

/**
 * Builds a real (if minimal) xlsx in memory, so the reader is tested against the format
 * rather than against a fixture nobody can inspect. Entries are stored uncompressed —
 * the reader handles both, and this keeps the helper readable.
 */
function zip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 0, true); // stored
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 0, true); // stored
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((total, entry) => total + entry.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, centrals.length, true);
  eocdView.setUint16(10, centrals.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function workbook(sheet: string, extra: Record<string, string> = {}): Uint8Array {
  return zip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Lançamentos" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
    ...extra,
  });
}

describe("readXlsx", () => {
  it("lê números e texto embutido", () => {
    const sheets = readXlsx(
      workbook(
        '<row r="1">' +
          '<c r="A1" t="inlineStr"><is><t>PIX RECEBIDO</t></is></c>' +
          '<c r="B1"><v>-33630.7</v></c>' +
          "</row>",
      ),
    );

    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.name).toBe("Lançamentos");
    expect(sheets[0]?.rows[0]).toEqual(["PIX RECEBIDO", "-33630.7"]);
  });

  it("resolve as strings compartilhadas", () => {
    const sheets = readXlsx(
      workbook('<row r="1"><c r="A1" t="s"><v>1</v></c></row>', {
        "xl/sharedStrings.xml": "<sst><si><t>primeira</t></si><si><t>segunda</t></si></sst>",
      }),
    );
    expect(sheets[0]?.rows[0]?.[0]).toBe("segunda");
  });

  it("preenche os buracos de colunas puladas", () => {
    // A célula B não existe: a linha tem A e C, e C precisa continuar sendo a terceira.
    const sheets = readXlsx(
      workbook('<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>'),
    );
    expect(sheets[0]?.rows[0]).toEqual(["1", null, "3"]);
  });

  it("desfaz as entidades XML", () => {
    const sheets = readXlsx(
      workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>M&amp;A &lt;LTDA&gt;</t></is></c></row>'),
    );
    expect(sheets[0]?.rows[0]?.[0]).toBe("M&A <LTDA>");
  });

  it("converte serial de data quando o estilo diz que é data", () => {
    const sheets = readXlsx(
      workbook('<row r="1"><c r="A1" s="1"><v>46023</v></c></row>', {
        "xl/styles.xml":
          "<styleSheet><cellXfs><xf numFmtId=\"0\"/><xf numFmtId=\"14\"/></cellXfs></styleSheet>",
      }),
    );
    expect(sheets[0]?.rows[0]?.[0]).toBe("2026-01-01");
  });

  it("um número sem estilo de data continua número", () => {
    const sheets = readXlsx(workbook('<row r="1"><c r="A1"><v>46023</v></c></row>'));
    expect(sheets[0]?.rows[0]?.[0]).toBe("46023");
  });

  it("recusa um arquivo que não é xlsx", () => {
    expect(() => readXlsx(new TextEncoder().encode("isto não é um zip"))).toThrow(/xlsx/);
  });
});
