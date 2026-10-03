import type { LegDefinition } from "../types";
import { clamp01, rawTokens, saturate } from "../text";

const VAGUE = new Set(["thing", "things", "stuff", "something", "anything", "everything", "good", "nice", "better", "best", "appropriate", "relevant", "various", "some", "etc", "whatever", "somehow", "general", "generally", "proper", "properly", "basically", "kind", "sort", "quite", "pretty", "really", "very"]);
const QUOTED = /["“”'‘’`][^"“”'‘’`\n]{2,}["“”'‘’`]/g;
const URL = /\bhttps?:\/\/\S+|\b[\w-]+\.(com|org|net|io|ai|dev)\b/gi;
const CODE_LIKE = /\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|\b\w+\.(json|yaml|yml|md|ts|js|py|csv|txt|html)\b/g;
const NUMBER = /\b\d[\d.,:%]*\b/g;

/**
 * Concreteness: named entities, numbers, quoted strings, identifiers and long
 * technical words make an instruction unambiguous; vague filler makes it soft.
 */
export const specificity: LegDefinition = {
  id: "specificity",
  label: "Specificity",
  polarity: "focus",
  description: "Concrete anchors — names, numbers, quoted strings, identifiers — versus vague filler words.",
  explainer: {
    what: "How concrete the wording is: names, numbers, exact terms, quoted words, versus vague words like “good”, “some”, “things”.",
    why: "Precise wording leaves the model little room to guess. Vague wording lets it fill the gaps its own way, which is where surprises come from.",
    high: "“Announce the “Focus Mode” feature to design studios.”",
    low: "“Say something nice about the new thing.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      const toks = tokens[i] ?? [];
      if (toks.length === 0) return 0;
      const raw = rawTokens(chunk.text);
      let concrete = 0;
      raw.forEach((word, k) => {
        // Capitalised word that is not the first token is likely a proper noun.
        if (k > 0 && /^[A-Z][a-z]+/.test(word) && word.length > 2) concrete += 1;
        if (word.length >= 10) concrete += 0.5;
      });
      concrete += (chunk.text.match(NUMBER)?.length ?? 0) * 1;
      concrete += (chunk.text.match(QUOTED)?.length ?? 0) * 1.5;
      concrete += (chunk.text.match(URL)?.length ?? 0) * 1.5;
      concrete += (chunk.text.match(CODE_LIKE)?.length ?? 0) * 1;
      if (chunk.kind === "code") concrete += 2;
      const vague = toks.filter((t) => VAGUE.has(t)).length;
      const vagueRatio = vague / toks.length;
      return clamp01(saturate(concrete, 0.45) * (1 - 0.6 * Math.min(1, vagueRatio * 4)));
    });
  },
};
