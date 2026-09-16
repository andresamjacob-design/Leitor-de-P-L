/**
 * Lê os glifos crus do content stream de um PDF, com posição.
 *
 * Existe porque o `unpdf`/pdf.js **não serve** para este arquivo, e não por bug dele: o
 * `/ToUnicode` do PDF é incorreto (ver `itau-pdf-glyphs.ts`). Com o mapa aplicado, a letra
 * `G` e o dígito `0` chegam como o mesmo caractere e viram indistinguíveis; sem o mapa,
 * o pdf.js recorre a heurísticas de fonte padrão e inventa outra coisa. Nos dois casos o
 * texto sai errado de um jeito que parece certo.
 *
 * A saída correta só existe uma camada abaixo: os CIDs como estão no content stream. Com
 * `/Encoding /Identity-H`, cada **dois bytes** de uma string de texto é um glifo, e nenhuma
 * tradução acontece pelo caminho. É o que este módulo devolve.
 *
 * Suporta o que estes extratos usam, e nada além: `Tm`/`Td` para posição, `Tj` e `TJ` para
 * texto, strings em hexadecimal e literais. Um PDF com outra estrutura devolve menos itens,
 * e é responsabilidade do chamador conferir a cobertura antes de confiar no resultado.
 */

import { inflateSync } from "node:zlib";

export type GlyphItem = {
  x: number;
  y: number;
  /** Os CIDs, na ordem em que foram desenhados. */
  cids: number[];
};

export type GlyphPage = {
  number: number;
  items: GlyphItem[];
};

const DECIMAL = String.raw`-?[\d.]+`;

function objects(pdf: Buffer): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  const text = pdf.toString("latin1");
  const re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.set(Number(match[1]), Buffer.from(match[2] as string, "latin1"));
  }
  return out;
}

function streamOf(body: Buffer): Buffer | null {
  const text = body.toString("latin1");
  const start = /stream\r?\n/.exec(text);
  if (!start) return null;
  const from = start.index + start[0].length;
  const to = text.indexOf("endstream", from);
  const raw = body.subarray(from, to === -1 ? body.length : to);
  try {
    return inflateSync(raw);
  } catch {
    return raw;
  }
}

/**
 * As páginas em ordem, seguindo a árvore a partir do catálogo.
 *
 * A árvore **aninha**: nestes arquivos o root aponta para dois nós intermediários, e ler só
 * o primeiro `/Kids` perde a última página — que é justamente onde estavam as transações do
 * maior lote.
 */
function pageLeaves(objs: Map<number, Buffer>, root: number, seen = new Set<number>()): number[] {
  if (seen.has(root)) return [];
  seen.add(root);
  const body = objs.get(root);
  if (!body) return [];
  const text = body.toString("latin1");
  if (/\/Type\s*\/Page(?![s])/.test(text)) return [root];
  const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(text);
  if (!kids) return [];
  const out: number[] = [];
  for (const m of (kids[1] as string).matchAll(/(\d+)\s+0\s+R/g)) {
    out.push(...pageLeaves(objs, Number(m[1]), seen));
  }
  return out;
}

function hexToCids(hex: string): number[] {
  const clean = hex.replace(/\s/g, "");
  const cids: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    cids.push(Number.parseInt(clean.slice(i, i + 4).padEnd(4, "0"), 16));
  }
  return cids;
}

function literalToCids(literal: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < literal.length; i += 1) {
    const ch = literal[i] as string;
    if (ch !== "\\") {
      bytes.push(ch.charCodeAt(0));
      continue;
    }
    i += 1;
    const next = literal[i];
    if (next === undefined) break;
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
    if (next in escapes) {
      bytes.push(escapes[next] as number);
    } else if (next >= "0" && next <= "7") {
      let octal = "";
      while (octal.length < 3 && literal[i] !== undefined && literal[i]! >= "0" && literal[i]! <= "7") {
        octal += literal[i];
        i += 1;
      }
      i -= 1;
      bytes.push(Number.parseInt(octal, 8) & 0xff);
    } else {
      bytes.push(next.charCodeAt(0));
    }
  }
  const cids: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    cids.push(((bytes[i] as number) << 8) | (bytes[i + 1] ?? 0));
  }
  return cids;
}

export function readGlyphPages(pdf: Buffer): GlyphPage[] {
  const objs = objects(pdf);
  const text = pdf.toString("latin1");
  const catalog =
    /\/Type\s*\/Catalog[\s\S]{0,200}?\/Pages\s+(\d+)\s+0\s+R/.exec(text) ??
    /\/Pages\s+(\d+)\s+0\s+R/.exec(text);
  if (!catalog) return [];

  const leaves = pageLeaves(objs, Number(catalog[1]));
  const operators = new RegExp(
    `(?:(${DECIMAL})\\s+(${DECIMAL})\\s+Td)` +
      `|(?:(${DECIMAL})\\s+(${DECIMAL})\\s+(${DECIMAL})\\s+(${DECIMAL})\\s+(${DECIMAL})\\s+(${DECIMAL})\\s+Tm)` +
      `|(?:<([0-9A-Fa-f\\s]*)>\\s*Tj)` +
      `|(?:\\[((?:[^\\[\\]\\\\]|\\\\.)*)\\]\\s*TJ)`,
    "g",
  );

  const pages: GlyphPage[] = [];
  for (const [index, leaf] of leaves.entries()) {
    const body = objs.get(leaf);
    if (!body) continue;
    const contents = /\/Contents\s+(\d+)\s+0\s+R/.exec(body.toString("latin1"));
    if (!contents) continue;
    const stream = streamOf(objs.get(Number(contents[1])) ?? Buffer.alloc(0));
    if (!stream) continue;

    const content = stream.toString("latin1");
    const items: GlyphItem[] = [];
    let x = 0;
    let y = 0;

    operators.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = operators.exec(content)) !== null) {
      if (match[1] !== undefined) {
        x += Number(match[1]);
        y += Number(match[2]);
      } else if (match[3] !== undefined) {
        x = Number(match[7]);
        y = Number(match[8]);
      } else if (match[9] !== undefined) {
        items.push({ x, y, cids: hexToCids(match[9]) });
      } else if (match[10] !== undefined) {
        const cids: number[] = [];
        for (const piece of (match[10] as string).matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:[^()\\]|\\.)*)\)/g)) {
          cids.push(...(piece[1] !== undefined ? hexToCids(piece[1]) : literalToCids(piece[2] ?? "")));
        }
        items.push({ x, y, cids });
      }
    }

    pages.push({ number: index + 1, items });
  }

  return pages;
}
