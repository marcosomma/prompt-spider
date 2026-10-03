import type { LegDefinition } from "../types";
import { clamp01, countPhrases, countWords, saturate } from "../text";

const HEDGE_WORDS = new Set(["maybe", "perhaps", "might", "could", "possibly", "probably", "ideally", "optionally", "optional", "roughly", "approximately", "somewhat", "somehow", "etc", "whatever", "hopefully", "likely", "generally", "usually", "sometimes", "occasionally"]);
const HEDGE_PHRASES = ["if possible", "if you can", "if you want", "if needed", "if necessary", "when possible", "or something", "something like", "kind of", "sort of", "i think", "i guess", "i suppose", "i believe", "try to", "feel free", "it would be nice", "would be great", "up to you", "your call", "not sure", "more or less", "and so on", "you may", "you can", "you could", "you might"];

/**
 * Soft language that gives the model permission to ignore a chunk. A hedged
 * instruction is weighed less than a plain one. This is a diluting leg.
 */
export const hedging: LegDefinition = {
  id: "hedging",
  label: "Hedging",
  polarity: "dilute",
  description: "Soft, optional language (maybe, if possible, try to, etc.) that lets the model skip the chunk.",
  explainer: {
    what: "How optional this piece sounds: maybe, if possible, try to, it's up to you.",
    why: "Soft wording gives the model permission to skip the request. If you really want it, say it plainly. This leg lowers the focus score.",
    high: "“Maybe add an emoji if you think it fits.”",
    low: "“Add one emoji.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      const toks = tokens[i] ?? [];
      if (chunk.kind === "code") return 0;
      let hits = countWords(toks, HEDGE_WORDS) * 0.9 + countPhrases(toks, HEDGE_PHRASES) * 1.2;
      const questions = chunk.text.match(/\?/g)?.length ?? 0;
      hits += questions * 0.7;
      return clamp01(saturate(hits));
    });
  },
};
