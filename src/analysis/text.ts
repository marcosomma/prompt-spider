/** Small, dependency-free text helpers shared by the legs. */

const WORD = /[A-Za-z0-9][\w'-]*/g;

/** Lower-cased word tokens. Apostrophes and hyphens stay inside a token (`don't`, `step-by-step`). */
export function tokenize(text: string): string[] {
  return (text.match(WORD) ?? []).map((w) => w.toLowerCase());
}

/** Original-case word tokens, for capitalisation checks. */
export function rawTokens(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** Maps a hit count to [0, 1): one hit ≈ 0.45, two ≈ 0.70, three ≈ 0.83 at the default rate. */
export function saturate(hits: number, rate = 0.6): number {
  return hits <= 0 ? 0 : 1 - Math.exp(-hits * rate);
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Counts how many phrases (space-separated token sequences) occur in the token list. */
export function countPhrases(tokens: readonly string[], phrases: readonly string[]): number {
  let hits = 0;
  for (const phrase of phrases) {
    const parts = phrase.split(" ");
    for (let i = 0; i + parts.length <= tokens.length; i += 1) {
      let matched = true;
      for (let k = 0; k < parts.length; k += 1) {
        if (tokens[i + k] !== parts[k]) {
          matched = false;
          break;
        }
      }
      if (matched) hits += 1;
    }
  }
  return hits;
}

const NEGATION_TOKENS: ReadonlySet<string> = new Set(["not", "never", "don't", "dont", "no", "without", "avoid", "cannot", "can't"]);

/** Like `countPhrases`, but ignores a phrase when a negation sits within `window` tokens before it ("never say you don't know"). */
export function countPhrasesUnlessNegated(tokens: readonly string[], phrases: readonly string[], window = 2): number {
  let hits = 0;
  for (const phrase of phrases) {
    const parts = phrase.split(" ");
    for (let i = 0; i + parts.length <= tokens.length; i += 1) {
      let matched = true;
      for (let k = 0; k < parts.length; k += 1) {
        if (tokens[i + k] !== parts[k]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      let negated = false;
      for (let b = Math.max(0, i - window); b < i; b += 1) if (NEGATION_TOKENS.has(tokens[b]!)) negated = true;
      if (!negated) hits += 1;
    }
  }
  return hits;
}

export function countWords(tokens: readonly string[], words: ReadonlySet<string>): number {
  let hits = 0;
  for (const token of tokens) if (words.has(token)) hits += 1;
  return hits;
}

/** Content tokens for similarity: drops stop words and very short tokens, crude plural folding. */
export function contentTokens(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const token of tokens) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    out.add(token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token);
  }
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Min–max normalises a vector into [0, 1]; a flat vector maps to 0.5 everywhere. */
export function normalize(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 1e-9) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

export const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "that", "this", "with", "you", "your", "are", "not", "but", "any", "all", "can",
  "will", "from", "have", "has", "had", "was", "were", "been", "being", "its", "it's", "into", "than",
  "then", "them", "they", "their", "there", "these", "those", "what", "when", "where", "which", "while",
  "who", "whom", "why", "how", "also", "just", "only", "about", "after", "before", "over", "under",
  "should", "would", "could", "may", "might", "must", "shall", "does", "did", "doing", "done", "each",
  "every", "some", "such", "very", "more", "most", "much", "many", "our", "out", "per", "via", "use",
]);

/** Collapses whitespace and cuts to `max` characters with an ellipsis. */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
