import type { LegDefinition } from "../types";
import { clamp01, countPhrases, countWords, saturate } from "../text";

/** Verbs that open an imperative instruction ("Write a…", "Avoid…"). */
const IMPERATIVE_VERBS = new Set([
  "write", "return", "use", "make", "ensure", "avoid", "list", "explain", "summarize", "summarise",
  "generate", "create", "respond", "answer", "include", "do", "don't", "never", "always", "keep", "format",
  "output", "provide", "give", "translate", "extract", "classify", "analyze", "analyse", "rewrite", "follow",
  "think", "check", "verify", "cite", "limit", "focus", "start", "end", "begin", "stop", "add", "remove",
  "describe", "compare", "identify", "produce", "draft", "compose", "review", "fix", "implement", "build",
  "design", "plan", "evaluate", "rank", "sort", "pick", "choose", "select", "highlight", "mark", "tag",
  "convert", "transform", "refactor", "test", "validate", "prioritize", "prioritise", "treat", "consider",
  "assume", "remember", "note", "act", "be", "stay", "read", "look", "find", "search", "ask", "tell", "show",
  "say", "reply", "quote", "mention", "state", "report", "label", "count", "measure", "estimate",
]);

/** Words that can precede the imperative verb without changing the mood ("Please add…", "Maybe add…"). */
const LEADING_FILLER = new Set(["please", "maybe", "perhaps", "ideally", "optionally", "also", "then", "and", "just", "now", "finally", "first", "next", "always", "never"]);

const MODALS = new Set(["must", "should", "shall", "mandatory", "required", "always", "never", "ensure"]);
const MODAL_PHRASES = ["need to", "needs to", "have to", "has to", "do not", "don't", "make sure", "be sure", "you will", "you are to", "it is essential", "under no circumstances", "at all times"];

export const directive: LegDefinition = {
  id: "directive",
  label: "Directive force",
  polarity: "focus",
  description: "Imperative verbs and modal obligation (must, never, make sure) that tell the model what to do.",
  explainer: {
    what: "How clearly this piece tells the model to do something, like a command: write, never, make sure.",
    why: "Clear commands are what the model follows first. Sentences that only describe or suggest are easy for it to skip.",
    high: "“Write a LinkedIn post.” · “Never mention competitors.”",
    low: "“We launched the product in 2024.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      const toks = tokens[i] ?? [];
      if (toks.length === 0 || chunk.kind === "code") return 0;
      let hits = countWords(toks, MODALS) + countPhrases(toks, MODAL_PHRASES);
      const head = imperativeHead(toks);
      if (head !== null) {
        hits += 1.5;
        // Imperative sentences in a bullet list are instructions even without a modal.
        if (chunk.kind === "bullet") hits += 0.5;
      } else if (toks[0] === "you" && toks[1] !== undefined && (MODALS.has(toks[1]) || toks[1] === "will")) {
        hits += 1;
      }
      return clamp01(saturate(hits));
    });
  },
};

/** Returns the imperative verb that opens the chunk, skipping leading filler, or null. */
function imperativeHead(tokens: readonly string[]): string | null {
  for (let i = 0; i < Math.min(tokens.length, 3); i += 1) {
    const token = tokens[i]!;
    if (IMPERATIVE_VERBS.has(token)) return token;
    if (!LEADING_FILLER.has(token)) return null;
  }
  return null;
}
