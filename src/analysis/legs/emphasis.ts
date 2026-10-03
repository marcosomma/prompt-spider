import type { LegDefinition } from "../types";
import { clamp01, countWords, rawTokens, saturate } from "../text";

const EMPHASIS_WORDS = new Set(["important", "importantly", "critical", "critically", "crucial", "essential", "vital", "key", "note", "remember", "strictly", "absolutely", "extremely", "really", "definitely", "especially", "particularly", "priority", "mandatory", "warning", "caution", "nb", "attention"]);
const BOLD = /\*\*[^*\n]+\*\*|__[^_\n]+__/g;

/** Typographic and lexical shouting: CAPS, bold, exclamation marks, "IMPORTANT". */
export const emphasis: LegDefinition = {
  id: "emphasis",
  label: "Emphasis",
  polarity: "focus",
  description: "Typographic and lexical stress: ALL CAPS, **bold**, exclamation marks, IMPORTANT / NOTE / critical.",
  explainer: {
    what: "How much this piece is stressed: CAPITALS, bold, exclamation marks, words like IMPORTANT or critical.",
    why: "Stress makes the model pay extra attention, but only while it is rare. When everything is shouted, nothing stands out any more.",
    high: "“IMPORTANT: do not use the word “revolutionary”.”",
    low: "“Avoid the word revolutionary.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      if (chunk.kind === "code") return 0;
      const toks = tokens[i] ?? [];
      const raw = rawTokens(chunk.text);
      const caps = raw.filter((w) => w.length >= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)).length;
      // An all-caps heading is structure, not shouting; only count caps inside prose.
      const capsHits = chunk.kind === "heading" ? Math.min(caps, 1) * 0.5 : caps;
      const bold = chunk.text.match(BOLD)?.length ?? 0;
      const bangs = (chunk.text.match(/!/g)?.length ?? 0);
      const hits = capsHits + bold * 1.2 + bangs * 0.8 + countWords(toks, EMPHASIS_WORDS);
      return clamp01(saturate(hits));
    });
  },
};
