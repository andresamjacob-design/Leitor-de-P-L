/**
 * CSV, for the same statement the bank also exports as XLSX.
 *
 * Deliberately small. The columns are matched by header in `itau-statement.ts`, so a CSV
 * and an XLSX of the same statement go through exactly one parser — there is no second
 * implementation to keep in step.
 *
 * The interactive column-mapping screen the SPEC asks for (§7) is not here: every real
 * file received so far is an XLSX with a header this already understands, and a mapping
 * UI with nothing to map would be guesswork. It goes in when a file needs it.
 */

import type { Cell } from "@/lib/import/xlsx";

/** Brazilian exports use `;`, because the comma is the decimal separator. */
function detectDelimiter(sample: string): string {
  const counts = [";", ",", "\t", "|"].map((candidate) => ({
    candidate,
    count: (sample.match(new RegExp(`\\${candidate}`, "g")) ?? []).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.count ? (counts[0].candidate as string) : ";";
}

export function parseCsv(text: string, delimiter?: string): Cell[][] {
  // A BOM at the start would otherwise become part of the first header.
  const content = text.replace(/^﻿/, "");
  const separator = delimiter ?? detectDelimiter(content.slice(0, 4000));

  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field === "" ? null : field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < content.length) {
    const char = content[index] as string;

    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === separator) {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== "" || row.length > 0) endRow();

  return rows;
}
