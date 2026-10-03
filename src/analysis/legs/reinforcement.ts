import type { LegDefinition } from "../types";
import { clamp01, contentTokens, jaccard, saturate } from "../text";

/**
 * Repetition across chunks. Saying something twice makes the model weigh it
 * more; it is also a signal the prompt is padded. Scored per chunk as the
 * number and strength of other chunks that echo it.
 */
export const reinforcement: LegDefinition = {
  id: "reinforcement",
  label: "Reinforcement",
  polarity: "focus",
  description: "How often other chunks repeat or echo this one; repeated instructions weigh more.",
  explainer: {
    what: "How often other pieces of the prompt say the same thing again, in the same or different words.",
    why: "Repeating a rule makes the model weigh it more. That is useful for the one rule that really matters and wasteful for everything else.",
    high: "“Keep it short.” … later: “Remember, no more than 120 words.”",
    low: "A rule that is stated once.",
  },
  score({ chunks, tokens }) {
    const sets = tokens.map((t) => contentTokens(t));
    return chunks.map((_, i) => {
      const self = sets[i]!;
      if (self.size < 2) return 0;
      let echo = 0;
      for (let j = 0; j < sets.length; j += 1) {
        if (j === i) continue;
        const sim = jaccard(self, sets[j]!);
        if (sim >= 0.2) echo += sim;
      }
      return clamp01(saturate(echo * 3, 0.5));
    });
  },
};
