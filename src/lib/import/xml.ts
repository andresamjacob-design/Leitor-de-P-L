/**
 * A small XML scanner for machine-generated Office documents.
 *
 * Not a general parser: no CDATA, no DTDs, no namespace resolution beyond dropping the
 * prefix. It handles what Excel and Word write, and nothing else — which is the only
 * reason it is safe to be this short.
 */


const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

export type Tag = {
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
export function scanXml(
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

export function stripNamespace(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}
