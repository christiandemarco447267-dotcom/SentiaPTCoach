// Tiny, safe Markdown subset for coach answers: **bold**, *italic* / _italic_,
// `inline code`, "-"/"*"/"•" bullet lists, "1." numbered lists, paragraphs and
// line breaks. Pure: it returns a token tree that the UI renders as React
// elements (never as HTML strings), so model output can't inject markup.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "br" };

export type Block = { t: "p"; c: Inline[] } | { t: "ul"; items: Inline[][] } | { t: "ol"; items: Inline[][]; start: number };

const MAX_INPUT = 8000;

/** Parse inline markup. Unmatched markers stay as literal text. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && "*_`\\".includes(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 3 && (src.startsWith("**", i) || src.startsWith("__", i))) {
      const mark = src.slice(i, i + 2);
      const end = src.indexOf(mark, i + 2);
      if (end > i + 2 && src[i + 2] !== " ") {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < 3 && (ch === "*" || ch === "_")) {
      // Intraword underscores (snake_case) are literal; italic needs a non-space right after the marker.
      const prev = src[i - 1];
      const wordBefore = prev !== undefined && /[A-Za-z0-9]/.test(prev);
      const next = src[i + 1];
      if (!(ch === "_" && wordBefore) && next && next !== " " && next !== ch) {
        let end = i + 1;
        while (end < src.length) {
          end = src.indexOf(ch, end);
          if (end < 0) break;
          if (src[end - 1] !== " " && src[end + 1] !== ch && !(ch === "_" && /[A-Za-z0-9]/.test(src[end + 1] ?? ""))) break;
          end += 1;
        }
        if (end > i + 1) {
          flush();
          out.push({ t: "em", c: parseInline(src.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

const UL = /^\s*(?:[-*•+])\s+(.*)$/;
const OL = /^\s*(\d{1,3})[.)]\s+(.*)$/;

/** Parse text into paragraphs and lists. Single newlines inside a paragraph become line breaks. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.slice(0, MAX_INPUT).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const c: Inline[] = [];
    para.forEach((line, idx) => {
      if (idx) c.push({ t: "br" });
      c.push(...parseInline(line.replace(/^#{1,6}\s+/, "")));
    });
    blocks.push({ t: "p", c });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (ul) {
        if (last?.t === "ul") last.items.push(parseInline(ul[1]));
        else blocks.push({ t: "ul", items: [parseInline(ul[1])] });
      } else if (ol) {
        if (last?.t === "ol") last.items.push(parseInline(ol[2]));
        else blocks.push({ t: "ol", items: [parseInline(ol[2])], start: Number(ol[1]) || 1 });
      }
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** Plain text with the markup removed (for copy, previews and follow-up prompts). */
export function stripMarkdown(text: string): string {
  const inl = (c: Inline[]): string => c.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? " " : inl(n.c))).join("");
  return parseMarkdown(text)
    .map((b) => (b.t === "p" ? inl(b.c) : b.items.map((it) => inl(it)).join("; ")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
