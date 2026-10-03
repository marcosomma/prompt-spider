import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis/engine";
import { LEGS, positionWeight } from "../src/analysis/legs";
import { MODEL_PROFILES } from "../src/analysis/models";
import { SOCIAL_PROMPT } from "./fixtures";

const STUB = { what: "stub", why: "stub", high: "stub", low: "stub" };

describe("analyze", () => {
  it("has every leg touch every chunk exactly once, within [0, 1]", () => {
    const result = analyze(SOCIAL_PROMPT, "claude-opus-5-5");
    expect(result.legs).toHaveLength(LEGS.length);
    for (const leg of result.legs) {
      expect(leg.scores).toHaveLength(result.chunks.length);
      for (const s of leg.scores) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
    expect(result.focus).toHaveLength(result.chunks.length);
    expect(new Set(result.ranking)).toEqual(new Set(result.chunks.map((c) => c.index)));
  });

  it("is deterministic", () => {
    const a = analyze(SOCIAL_PROMPT, "claude-sonnet-5-5");
    const b = analyze(SOCIAL_PROMPT, "claude-sonnet-5-5");
    expect(a.focus).toEqual(b.focus);
  });

  it("ranks a hard rule above background context", () => {
    const result = analyze(SOCIAL_PROMPT, "claude-opus-5-5");
    const rule = result.chunks.find((c) => c.text.includes("Never mention competitors"))!;
    const context = result.chunks.find((c) => c.text.startsWith("We launched the product"))!;
    expect(result.focus[rule.index]!).toBeGreaterThan(result.focus[context.index]!);
  });

  it("scores the diluting legs high on hedged and background chunks", () => {
    const result = analyze(SOCIAL_PROMPT, "claude-opus-5-5");
    const hedging = result.legs.find((l) => l.id === "hedging")!;
    const contextLoad = result.legs.find((l) => l.id === "contextLoad")!;
    const hedged = result.chunks.find((c) => c.text.startsWith("Maybe add an emoji"))!;
    const background = result.chunks.find((c) => c.text.startsWith("We launched the product"))!;
    expect(hedging.scores[hedged.index]!).toBeGreaterThan(0.5);
    expect(contextLoad.scores[background.index]!).toBeGreaterThan(0.5);
  });

  it("produces the expected insights for the sample prompt", () => {
    const result = analyze(SOCIAL_PROMPT, "claude-opus-5-5");
    const titles = result.insights.map((i) => i.title);
    expect(titles).toContain("Hedged instruction");
    expect(titles).toContain("Where the model will focus");
    expect(titles).not.toContain("No output shape");
  });

  it("works for every model profile and for a one-line prompt", () => {
    for (const profile of MODEL_PROFILES) {
      const result = analyze("Summarise this in one sentence.", profile.id);
      expect(result.chunks).toHaveLength(1);
      expect(result.focus).toEqual([0.5]);
    }
    expect(analyze("", "claude-opus-5-5").chunks).toEqual([]);
  });

  it("gives the middle less positional weight than the ends, more so on small models", () => {
    const small = MODEL_PROFILES.find((p) => p.id === "small-open")!.position;
    const frontier = MODEL_PROFILES.find((p) => p.id === "claude-fable-5-1")!.position;
    const n = 20;
    expect(positionWeight(10, n, small)).toBeLessThan(positionWeight(0, n, small));
    expect(positionWeight(10, n, small)).toBeLessThan(positionWeight(n - 1, n, small));
    expect(positionWeight(10, n, frontier)).toBeGreaterThan(positionWeight(10, n, small));
  });

  it("gives every leg a complete plain-language explainer", () => {
    for (const leg of LEGS) {
      for (const field of ["what", "why", "high", "low"] as const) {
        expect(leg.explainer[field].length, `${leg.id}.${field}`).toBeGreaterThan(10);
      }
    }
  });

  it("accepts extra legs and rejects malformed ones", () => {
    const ok = analyze(SOCIAL_PROMPT, "claude-opus-5-5", {
      extraLegs: [{ id: "selfReport", label: "x", polarity: "focus", description: "", explainer: STUB, score: (ctx) => ctx.chunks.map(() => 1) }],
    });
    expect(ok.legs.at(-1)?.id).toBe("selfReport");
    expect(() =>
      analyze(SOCIAL_PROMPT, "claude-opus-5-5", {
        extraLegs: [{ id: "selfReport", label: "x", polarity: "focus", description: "", explainer: STUB, score: () => [2] }],
      }),
    ).toThrow();
  });
});
