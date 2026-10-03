import type { LegDefinition } from "../types";
import { clamp01, countPhrases, countWords, saturate } from "../text";

const CONTEXT_SECTIONS = new Set(["context", "background", "example", "examples", "sample", "samples", "data", "input", "document", "documents", "reference", "references", "source", "sources", "transcript", "history", "notes", "about"]);
const CONTEXT_WORDS = new Set(["background", "context", "currently", "previously", "yesterday", "recently", "historically", "company", "team", "project", "product", "startup", "founded", "launched", "based", "located", "customers", "users", "revenue", "market", "industry", "we", "our", "ours", "us", "they", "he", "she", "his", "her", "their", "was", "were", "had", "has", "have", "been"]);
const CONTEXT_PHRASES = ["for context", "for background", "here is", "here's", "below is", "the following is", "as you can see", "for example", "for instance", "e.g", "such as", "we are", "we have", "i am", "i'm", "my company", "my team", "our company", "our team"];

/**
 * Descriptive load: material the model should *know* rather than *do*. High
 * values mean the chunk is background, examples or data, which dilutes the
 * task signal around it. This is a diluting leg.
 */
export const contextLoad: LegDefinition = {
  id: "contextLoad",
  label: "Context load",
  polarity: "dilute",
  description: "Background, examples and data the model should know rather than act on. Dilutes the task signal.",
  explainer: {
    what: "How much this piece is background: facts about you, examples, data, history. Things to know rather than things to do.",
    why: "Background helps the model understand, but it does not tell it what to do. Too much of it around the task dilutes the instructions, so this leg lowers the focus score.",
    high: "“We launched the product in 2024 and have 40 customers.”",
    low: "“Write a post announcing the feature.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      const toks = tokens[i] ?? [];
      if (chunk.kind === "code") return 0.8;
      if (toks.length === 0) return 0;
      let hits = countWords(toks, CONTEXT_WORDS) * 0.5 + countPhrases(toks, CONTEXT_PHRASES) * 1.2;
      const pastTense = toks.filter((t) => /^[a-z]{3,}ed$/.test(t) && t !== "need").length;
      hits += pastTense * 0.6;
      if (chunk.section !== null && CONTEXT_SECTIONS.has(chunk.section)) hits += 2;
      // Long descriptive sentences without a verb of instruction are usually context.
      if (chunk.kind === "sentence" && toks.length > 28) hits += 0.8;
      return clamp01(saturate(hits, 0.45));
    });
  },
};
