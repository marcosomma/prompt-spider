import { describe, expect, it } from "vitest";
import { chunkPrompt } from "../src/analysis/chunker";
import { SOCIAL_PROMPT } from "./fixtures";

describe("chunkPrompt", () => {
  it("preserves exact offsets for every chunk", () => {
    for (const chunk of chunkPrompt(SOCIAL_PROMPT)) {
      expect(SOCIAL_PROMPT.slice(chunk.start, chunk.end)).toBe(chunk.text);
    }
  });

  it("numbers chunks in reading order without overlap", () => {
    const chunks = chunkPrompt(SOCIAL_PROMPT);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    for (let i = 1; i < chunks.length; i += 1) expect(chunks[i]!.start).toBeGreaterThanOrEqual(chunks[i - 1]!.end);
  });

  it("records the enclosing tag as the section and drops bare tag lines", () => {
    const chunks = chunkPrompt(SOCIAL_PROMPT);
    const inContext = chunks.filter((c) => c.section === "context");
    expect(inContext.length).toBeGreaterThanOrEqual(3);
    expect(chunks.some((c) => c.text.startsWith("<context>"))).toBe(false);
    expect(chunks.filter((c) => c.text.startsWith("Write a LinkedIn")).every((c) => c.section === null)).toBe(true);
  });

  it("classifies headings, bullets and sentences", () => {
    const chunks = chunkPrompt(SOCIAL_PROMPT);
    expect(chunks.find((c) => c.text === "## Task")?.kind).toBe("heading");
    expect(chunks.find((c) => c.text === "Rules:")?.kind).toBe("heading");
    const bullets = chunks.filter((c) => c.kind === "bullet");
    expect(bullets).toHaveLength(5);
    expect(bullets.every((b) => !b.ordered)).toBe(true);
    expect(chunks.find((c) => c.text.startsWith("Return only"))?.kind).toBe("sentence");
  });

  it("splits sentences but not abbreviations or decimals", () => {
    const text = "Use e.g. three items. Keep it at 2.5 lines max! Then stop.";
    expect(chunkPrompt(text).map((c) => c.text)).toEqual(["Use e.g. three items.", "Keep it at 2.5 lines max!", "Then stop."]);
  });

  it("keeps a fenced code block as one chunk", () => {
    const text = "Example:\n```json\n{\"a\": 1}\n```\nDone.";
    const kinds = chunkPrompt(text).map((c) => c.kind);
    expect(kinds).toEqual(["heading", "code", "sentence"]);
  });

  it("folds wrapped bullet continuation lines", () => {
    const text = "- first line\n  continues here\n- second";
    expect(chunkPrompt(text).map((c) => c.text)).toEqual(["- first line\n  continues here", "- second"]);
  });

  it("handles numbered bullets and empty input", () => {
    expect(chunkPrompt("")).toEqual([]);
    const chunks = chunkPrompt("1. one\n2) two");
    expect(chunks.map((c) => c.ordered)).toEqual([true, true]);
  });

  it("splits a multi-sentence bullet into one chunk per sentence, flagging continuations", () => {
    const text = "- GAPS ONLY. Report a finding only where the policy is missing. Do not report satisfied ones.\n- RANK findings.";
    const chunks = chunkPrompt(text);
    expect(chunks.map((c) => [c.kind, c.continuation, c.text])).toEqual([
      ["bullet", false, "- GAPS ONLY."],
      ["bullet", true, "Report a finding only where the policy is missing."],
      ["bullet", true, "Do not report satisfied ones."],
      ["bullet", false, "- RANK findings."],
    ]);
  });

  it("records bullet nesting depth", () => {
    const text = "- CLASSIFY each gap as one of:\n    • MISSING — silent.\n    • INCORRECT — wrong.\n  Trailing note.";
    const chunks = chunkPrompt(text);
    expect(chunks.map((c) => [c.kind, c.depth])).toEqual([
      ["bullet", 0],
      ["bullet", 2],
      ["bullet", 2],
      ["sentence", 0],
    ]);
  });

  it("keeps a one-line JSON literal whole and apart from the label before it", () => {
    const text = 'Output: a SINGLE JSON object, no prose, of shape:\n{ "findings": [ { "gap": "<why. it matters>", "ids": ["a", ...] } ] }\n"ids" must be drawn from the list. Every finding needs one.';
    const chunks = chunkPrompt(text);
    expect(chunks.map((c) => c.kind)).toEqual(["heading", "code", "sentence", "sentence"]);
    expect(chunks[1]!.text.startsWith("{ ")).toBe(true);
    expect(chunks[1]!.text.endsWith("] }")).toBe(true);
  });
});
