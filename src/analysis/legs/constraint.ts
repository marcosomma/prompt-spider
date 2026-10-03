import type { LegDefinition } from "../types";
import { clamp01, countPhrases, countWords, saturate } from "../text";

const LIMIT_WORDS = new Set(["only", "exactly", "maximum", "minimum", "limit", "within", "except", "exclude", "excluding", "without", "forbidden", "prohibited", "strictly", "solely", "exclusively", "never", "not", "no", "cannot", "can't", "don't", "mustn't", "shouldn't", "won't", "avoid", "unless", "otherwise"]);
const LIMIT_PHRASES = ["at most", "at least", "no more than", "no less than", "fewer than", "less than", "more than", "not exceed", "do not", "must not", "should not", "in english", "in italian", "in spanish", "in french", "in german", "in japanese", "one word", "single word", "yes or no"];
/** A number followed by a unit of length is almost always a constraint ("under 200 words"). */
const QUANTITY = /\b\d+(?:[.,]\d+)?\s*(?:-|to)?\s*\d*\s*(words?|characters?|chars?|sentences?|paragraphs?|lines?|items?|bullets?|points?|tokens?|pages?|seconds?|minutes?|%|percent|px|steps?|examples?|options?)\b/gi;

export const constraint: LegDefinition = {
  id: "constraint",
  label: "Constraint tightness",
  polarity: "focus",
  description: "Hard limits and exclusions: numbers with units, only/never/except, language and length caps.",
  explainer: {
    what: "How tight the limits in this piece are: numbers, maximums, forbidden things, “only” and “except”.",
    why: "Hard limits shape the answer strongly. The model treats “under 120 words” or “at most 3 hashtags” as rules it must respect, not as suggestions.",
    high: "“Keep it under 120 words.” · “Use at most 3 hashtags.”",
    low: "“Make it reasonably short.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      const toks = tokens[i] ?? [];
      if (chunk.kind === "code") return 0;
      let hits = countWords(toks, LIMIT_WORDS) * 0.8 + countPhrases(toks, LIMIT_PHRASES);
      const quantities = chunk.text.match(QUANTITY)?.length ?? 0;
      hits += quantities * 1.5;
      return clamp01(saturate(hits));
    });
  },
};
