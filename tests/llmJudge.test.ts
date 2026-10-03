import { describe, expect, it } from "vitest";
import { countRated, parseReport } from "../src/analysis/llmJudge";

describe("parseReport", () => {
  const valid = JSON.stringify({
    reasoning: "  The hard rules dominate; the context is background. ",
    conflicts: ["Rule 3 asks for brevity while rule 7 asks for detail.", "  "],
    weights: [
      { index: 0, weight: 0.9, reason: "Core task" },
      { index: 2, weight: 0.1, reason: "Background" },
      { index: 7, weight: 1, reason: "Out of range index is ignored" },
    ],
  });

  it("aligns weights to the chunk list and fills unrated chunks with 0", () => {
    const report = parseReport(valid, 3);
    expect(report.scores).toEqual([0.9, 0, 0.1]);
    expect(report.reasons).toEqual(["Core task", "", "Background"]);
    expect(report.reasoning).toBe("The hard rules dominate; the context is background.");
    expect(report.conflicts).toEqual(["Rule 3 asks for brevity while rule 7 asks for detail."]);
  });

  it("rejects invalid JSON and wrong shapes with readable errors", () => {
    expect(() => parseReport("{not json", 3)).toThrow(/valid JSON/);
    expect(() => parseReport(JSON.stringify({ weights: [] }), 3)).toThrow(/expected structure/);
    expect(() => parseReport(JSON.stringify({ reasoning: "x", conflicts: [], weights: [{ index: 0, weight: 2, reason: "" }] }), 3)).toThrow(/expected structure/);
  });
});

describe("countRated", () => {
  it("counts chunk ratings in a partial stream without counting the weights array key", () => {
    expect(countRated('{"reasoning":"...","conflicts":[],"weights":[')).toBe(0);
    expect(countRated('{"weights":[{"index":0,"weight":0.9,"reason":"a"},{"index":1,"weight": 0.2')).toBe(2);
  });
});
