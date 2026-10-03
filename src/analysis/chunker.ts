import type { Chunk, ChunkKind } from "./types";

/**
 * Splits a prompt into analysable chunks while preserving exact character offsets.
 *
 * Rules, in order of precedence per line block:
 * 1. Fenced code blocks (``` ... ```) and single-line JSON/array literals become
 *    one `code` chunk each.
 * 2. Bare XML-style tag lines (`<rules>`, `</rules>`) are not chunks; they open
 *    and close a *section* recorded on the chunks inside them.
 * 3. Markdown headings, `Label:` lines without sentence punctuation and ALL-CAPS
 *    lines are `heading` chunks.
 * 4. Bullet and numbered lines are `bullet` chunks (wrapped continuation lines are
 *    folded in). A bullet holding several sentences is split into one chunk per
 *    sentence; the later ones carry `continuation: true` and the same `depth`.
 * 5. Everything else is split into `sentence` chunks.
 */
export function chunkPrompt(prompt: string): Chunk[] {
  const lines = splitLines(prompt);
  const chunks: Chunk[] = [];
  const sectionStack: string[] = [];
  let paragraph = 0;
  let previousBlank = true;
  let i = 0;

  const push = (start: number, end: number, kind: ChunkKind, extra: Partial<BulletMeta> = {}): void => {
    const trimmed = trimRange(prompt, start, end);
    if (trimmed === null) return;
    chunks.push({
      index: chunks.length,
      text: prompt.slice(trimmed.start, trimmed.end),
      start: trimmed.start,
      end: trimmed.end,
      kind,
      paragraph,
      section: sectionStack.at(-1) ?? null,
      ordered: extra.ordered ?? false,
      depth: extra.depth ?? 0,
      continuation: extra.continuation ?? false,
    });
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const content = line.text.trim();

    if (content === "") {
      if (!previousBlank) paragraph += 1;
      previousBlank = true;
      i += 1;
      continue;
    }
    previousBlank = false;

    if (FENCE.test(content)) {
      const closing = findClosingFence(lines, i + 1);
      const last = lines[closing] ?? lines[lines.length - 1]!;
      push(line.start, last.start + last.text.length, "code");
      i = closing + 1;
      continue;
    }

    const tag = BARE_TAG.exec(content);
    if (tag) {
      const name = tag[2]!.toLowerCase();
      if (tag[1] === "/") {
        const open = sectionStack.lastIndexOf(name);
        if (open >= 0) sectionStack.length = open;
      } else if (!content.endsWith("/>")) {
        sectionStack.push(name);
      }
      i += 1;
      continue;
    }

    if (JSON_LINE.test(content)) {
      push(line.start, line.start + line.text.length, "code");
      i += 1;
      continue;
    }

    if (isHeading(content)) {
      push(line.start, line.start + line.text.length, "heading");
      i += 1;
      continue;
    }

    const bullet = BULLET.exec(line.text);
    if (bullet) {
      const indent = bullet[1]!.length;
      let end = line.start + line.text.length;
      let j = i + 1;
      // Fold wrapped continuation lines (more indented, not themselves bullets).
      while (j < lines.length) {
        const next = lines[j]!;
        const nextTrim = next.text.trim();
        if (nextTrim === "" || BULLET.test(next.text) || leadingSpaces(next.text) <= indent) break;
        end = next.start + next.text.length;
        j += 1;
      }
      const meta: BulletMeta = { ordered: /\d/.test(bullet[2]!), depth: Math.min(3, Math.floor(indent / 2)), continuation: false };
      // Split after the marker so "1." is never mistaken for a sentence end; the first
      // sentence then grows back to include the marker.
      const sentences = splitSentences(prompt, line.start + bullet[0].length, end);
      if (sentences.length <= 1) {
        push(line.start, end, "bullet", meta);
      } else {
        sentences.forEach((span, s) => push(s === 0 ? line.start : span.start, span.end, "bullet", { ...meta, continuation: s > 0 }));
      }
      i = j;
      continue;
    }

    // Prose block: gather consecutive plain lines, then split into sentences.
    let end = line.start + line.text.length;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      const nextTrim = next.text.trim();
      if (nextTrim === "" || FENCE.test(nextTrim) || BARE_TAG.test(nextTrim) || JSON_LINE.test(nextTrim) || isHeading(nextTrim) || BULLET.test(next.text)) break;
      end = next.start + next.text.length;
      j += 1;
    }
    for (const span of splitSentences(prompt, line.start, end)) {
      push(span.start, span.end, "sentence");
    }
    i = j;
  }

  return chunks;
}

interface Line {
  readonly text: string;
  readonly start: number;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

type BulletMeta = Pick<Chunk, "ordered" | "depth" | "continuation">;

const FENCE = /^(```|~~~)/;
const BARE_TAG = /^<(\/?)([A-Za-z_][\w.-]*)(?:\s[^<>]*)?\/?>$/;
const BULLET = /^(\s*)([-*+•]|\d{1,3}[.)])\s+/;
const MARKDOWN_HEADING = /^#{1,6}\s+\S/;
/** A line ending in a colon with no sentence punctuation inside ("Rules:", "Output: a single JSON object, of shape:"). */
const LABEL_HEADING = /^[A-Z][^.!?\n]{0,78}:$/;
/** A single-line JSON object or array literal, optionally followed by a comma. */
const JSON_LINE = /^[{[].*[}\]],?$/;
const CAPS_HEADING = /^[A-Z][A-Z0-9\s/&:-]{2,60}$/;
/** Sentence boundary: terminal punctuation, optional closing quote, then whitespace. */
const SENTENCE_END = /[.!?]+["')\]]*(?=\s)/g;
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "no", "fig", "approx"]);

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      lines.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  lines.push({ text: text.slice(start), start });
  return lines;
}

function findClosingFence(lines: readonly Line[], from: number): number {
  for (let i = from; i < lines.length; i += 1) {
    if (FENCE.test(lines[i]!.text.trim())) return i;
  }
  return lines.length - 1;
}

function isHeading(content: string): boolean {
  if (MARKDOWN_HEADING.test(content)) return true;
  if (LABEL_HEADING.test(content)) return true;
  return CAPS_HEADING.test(content) && /[A-Z]{3,}/.test(content);
}

function leadingSpaces(text: string): number {
  return text.length - text.trimStart().length;
}

function trimRange(text: string, start: number, end: number): Span | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s += 1;
  while (e > s && /\s/.test(text[e - 1]!)) e -= 1;
  return s < e ? { start: s, end: e } : null;
}

function splitSentences(text: string, start: number, end: number): Span[] {
  const block = text.slice(start, end);
  const spans: Span[] = [];
  let cursor = 0;
  SENTENCE_END.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(block)) !== null) {
    const boundary = match.index + match[0].length;
    if (isAbbreviation(block, match.index) || isDecimalPoint(block, match.index)) continue;
    spans.push({ start: start + cursor, end: start + boundary });
    cursor = boundary;
  }
  if (cursor < block.length) spans.push({ start: start + cursor, end });
  return spans;
}

function isAbbreviation(block: string, dotIndex: number): boolean {
  if (block[dotIndex] !== ".") return false;
  const before = block.slice(0, dotIndex);
  const word = /([A-Za-z][\w.]*)$/.exec(before)?.[1]?.toLowerCase();
  if (!word) return false;
  return ABBREVIATIONS.has(word) || word.length === 1;
}

function isDecimalPoint(block: string, dotIndex: number): boolean {
  return block[dotIndex] === "." && /\d/.test(block[dotIndex - 1] ?? "") && /\d/.test(block[dotIndex + 1] ?? "");
}
