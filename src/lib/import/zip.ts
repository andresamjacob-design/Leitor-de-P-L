/**
 * Just enough zip to read an Office file.
 *
 * Both `.xlsx` and `.docx` are zip archives of XML, so the same reader serves the bank
 * statements and the contracts. Uses only `node:zlib` — see DECISIONS D34 for why there
 * is no library here.
 */

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

type ZipEntry = { name: string; data: Uint8Array };

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
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
