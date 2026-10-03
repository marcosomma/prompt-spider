import type { LegDefinition } from "../types";
import { clamp01, countPhrases, countWords, saturate } from "../text";

const SHAPE_WORDS = new Set(["format", "formatted", "json", "yaml", "xml", "csv", "markdown", "html", "table", "tables", "bullet", "bullets", "list", "numbered", "heading", "headings", "sections", "section", "structure", "structured", "template", "schema", "fields", "field", "output", "outputs", "tone", "style", "voice", "length", "concise", "brief", "briefly", "detailed", "verbose", "step-by-step", "steps", "paragraph", "paragraphs", "sentence", "sentences", "words", "word", "title", "subtitle", "caption", "hashtags", "hashtag", "emoji", "emojis", "summary", "tl;dr", "tldr", "code", "snippet", "language", "english", "italian", "spanish", "french", "german", "portuguese", "japanese"]);
const SHAPE_PHRASES = ["return only", "respond with", "respond in", "answer in", "answer with", "reply with", "reply in", "in the form of", "in the following format", "as a list", "as a table", "as json", "formatted as", "start with", "end with", "no preamble", "no explanation", "wrap in", "code block", "one line", "single line", "plain text"];

/** How much the chunk shapes the *form* of the answer rather than its content. */
export const outputShape: LegDefinition = {
  id: "outputShape",
  label: "Output shaping",
  polarity: "focus",
  description: "Instructions about the form of the answer: format, length, tone, language, structure.",
  explainer: {
    what: "How much this piece describes the form of the answer: its length, format, tone, language or structure.",
    why: "These lines decide how the answer looks: a list, JSON, three sentences, a formal tone. Without them the model picks its own defaults.",
    high: "“Return only the post text, no preamble.” · “Answer in Italian.”",
    low: "“Our tone has historically been formal.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      const toks = tokens[i] ?? [];
      if (chunk.kind === "code") return 0.15;
      const hits = countWords(toks, SHAPE_WORDS) * 0.8 + countPhrases(toks, SHAPE_PHRASES) * 1.3;
      return clamp01(saturate(hits));
    });
  },
};
