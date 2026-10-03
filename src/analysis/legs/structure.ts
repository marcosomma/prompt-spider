import type { LegDefinition } from "../types";
import { clamp01 } from "../text";

const MARKDOWN_MARKS = /(\*\*[^*\n]+\*\*|`[^`\n]+`|^#{1,6}\s|\|.+\|)/gm;

/**
 * Structural salience: headings, bullets, tag sections and Markdown scaffolding
 * make a chunk easy for the model to locate and attend to. Model profiles
 * decide how much XML versus Markdown scaffolding is worth.
 */
export const structure: LegDefinition = {
  id: "structure",
  label: "Structure",
  polarity: "focus",
  description: "Scaffolding that makes a chunk easy to locate: headings, bullets, numbered steps, XML sections, Markdown.",
  explainer: {
    what: "How easy this piece is to find: is it a heading, a bullet, a numbered step, or inside a tagged section like <rules>?",
    why: "Models locate and remember well-structured instructions more reliably than a sentence buried in the middle of a paragraph.",
    high: "A bullet under a “Rules:” heading.",
    low: "A long sentence in the middle of a paragraph.",
  },
  score({ chunks, profile }) {
    const { xml, markdown } = profile.structureBoost;
    return chunks.map((chunk) => {
      let score = 0;
      switch (chunk.kind) {
        case "heading":
          score = 0.75;
          break;
        case "bullet":
          // The first sentence of a bullet carries the marker; later sentences ride on it.
          // Nested bullets are a little less prominent than top-level ones.
          score = (chunk.continuation ? 0.3 : chunk.ordered ? 0.6 : 0.5) - 0.05 * chunk.depth;
          break;
        case "code":
          score = 0.45;
          break;
        case "sentence":
          score = 0.1;
          break;
      }
      if (chunk.section !== null) score += xml;
      const marks = chunk.text.match(MARKDOWN_MARKS)?.length ?? 0;
      if (marks > 0) score += markdown * Math.min(1, marks / 2);
      return clamp01(score);
    });
  },
};
