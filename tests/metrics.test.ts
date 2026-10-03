import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis/engine";
import { detectTasks } from "../src/analysis/metrics";
import { getModelProfile } from "../src/analysis/models";
import { tokenize } from "../src/analysis/text";
import type { Analysis, LegContext, Metric, MetricId } from "../src/analysis/types";
import { COMPLEX_PROMPT, OVERLOADED_PROMPT, SOCIAL_PROMPT } from "./fixtures";
import { decomposeSubtasks, countByKind } from "../src/analysis/metrics";

const MODEL = "claude-opus-5-5";

function metric(analysis: Analysis, id: MetricId): Metric {
  return analysis.metrics.find((m) => m.id === id)!;
}

function ctxOf(prompt: string): LegContext {
  const a = analyze(prompt, MODEL);
  return { prompt, chunks: a.chunks, tokens: a.chunks.map((c) => tokenize(c.text)), profile: getModelProfile(MODEL) };
}

describe("task detection", () => {
  it("finds one deliverable in the sample prompt and treats rules as rules", () => {
    const tasks = detectTasks(ctxOf(SOCIAL_PROMPT));
    expect(tasks.filter((t) => t.grade === "deliverable").map((t) => t.verb)).toEqual(["write"]);
    expect(tasks.some((t) => t.verb === "return")).toBe(false); // "Return only the post text" shapes output
  });

  it("counts coordinated clauses as separate deliverables", () => {
    const tasks = detectTasks(ctxOf("Write a LinkedIn post about our launch, then translate it into Italian, and also draft three tweet variants."));
    expect(tasks.map((t) => t.verb)).toEqual(["write", "translate", "draft"]);
  });

  it("ignores negated and bare quoted verbs", () => {
    const tasks = detectTasks(ctxOf('Never use "should", "recommend", or propose specific edits.\nDo not summarize the document.'));
    expect(tasks).toEqual([]);
  });

  it("grades production verbs inside rule lists as operations", () => {
    const tasks = detectTasks(ctxOf("Your job: surface the material gaps.\n\nRules:\n- RANK findings most-material-first.\n- CLASSIFY each gap as missing or incorrect."));
    expect(tasks.map((t) => [t.verb, t.grade])).toEqual([
      ["surface", "deliverable"],
      ["rank", "operation"],
      ["classify", "operation"],
    ]);
  });
});

describe("sub-task decomposition", () => {
  it("finds the implied steps behind a single-deliverable specification", () => {
    const a = analyze(COMPLEX_PROMPT, MODEL);
    const subtasks = decomposeSubtasks(ctxOf(COMPLEX_PROMPT), detectTasks(ctxOf(COMPLEX_PROMPT)), a.legs);
    const kinds = countByKind(subtasks);
    expect(subtasks.length).toBeGreaterThanOrEqual(30);
    expect(kinds.get("compose")).toBeGreaterThanOrEqual(8); // the JSON schema fields
    expect(kinds.get("select")).toBeGreaterThanOrEqual(3); // only if…, never promise…, use integrations only if…
    expect(kinds.get("tool")).toBe(1); // search_docs
    expect(kinds.get("format")).toBe(1);
    expect(subtasks.some((s) => s.kind === "transform" && s.label.startsWith("Classify"))).toBe(true);
    expect(subtasks.some((s) => s.kind === "input" && s.label === "Understand the ticket")).toBe(true);
  });

  it("stays near zero for a one-line request", () => {
    const a = analyze("Summarize this article in one sentence.", MODEL);
    expect(metric(a, "taskCount").display).toBe("0");
    expect(metric(analyze(SOCIAL_PROMPT, MODEL), "taskCount").score).toBeLessThan(0.2);
  });
});

describe("metrics", () => {
  it("reports task-load bands from the sub-task count", () => {
    expect(metric(analyze(SOCIAL_PROMPT, MODEL), "taskCount").band.label).toBe("simple");
    expect(metric(analyze(COMPLEX_PROMPT, MODEL), "taskCount").band.label).toBe("very dense");
    const many = analyze(OVERLOADED_PROMPT, MODEL);
    expect(many.metrics[0]!.summary).toMatch(/^[5-9] deliverables/);
    expect(metric(many, "hallucinationRisk").score).toBeGreaterThan(0.25); // "cite three studies with exact figures"
    expect(["high", "very high"]).toContain(metric(many, "complexity").band.label);
  });

  it("rates the complex sample as very high complexity, driven by sub-tasks", () => {
    const c = metric(analyze(COMPLEX_PROMPT, MODEL), "complexity");
    expect(c.band.label).toBe("very high");
    expect(c.factors[0]).toMatchObject({ label: "Implied sub-tasks" });
    expect(c.factors[0]!.contribution).toBeGreaterThan(0.2);
  });

  it("rates a rule-heavy, branching prompt as more complex than a simple one", () => {
    const simple = metric(analyze("Summarize this article in one sentence.", MODEL), "complexity");
    const heavy = metric(
      analyze(
        "Your job: assess each requirement.\n\nRules:\n- CLASSIFY each gap as MISSING, INCORRECT or INSUFFICIENT.\n- RANK findings most-material-first.\n- If a sibling policy covers it, skip it unless it conflicts.\n- Use at most 5 findings and exactly one amendment each.\n- Output a single JSON object with fields requirement_uuids, gap, amendments.",
        MODEL,
      ),
      "complexity",
    );
    expect(simple.band.label).toBe("low");
    expect(heavy.score).toBeGreaterThan(simple.score + 0.25);
  });

  it("ranks unsourced factual recall above grounded summarisation and creative writing", () => {
    const facts = metric(analyze("Give me the exact 2023 revenue figures for Acme Corp and cite three academic sources with DOIs. Never say you don't know. Provide a comprehensive, detailed report.", MODEL), "hallucinationRisk");
    const grounded = metric(analyze("<document>\nRevenue grew 12% to $4.2M. Headcount is 38.\n</document>\nSummarize the document above in two sentences. Only use the provided text; if something is not in the text, say so.", MODEL), "hallucinationRisk");
    const creative = metric(analyze("Write a short story about a dragon who learns to code. Keep it under 300 words.", MODEL), "hallucinationRisk");
    expect(facts.score).toBeGreaterThan(0.35);
    expect(grounded.score).toBeLessThan(0.1);
    expect(creative.score).toBeLessThan(0.1);
    expect(facts.factors.find((f) => f.label === "Abstention allowed")?.contribution).toBe(-0);
    expect(facts.factors.find((f) => f.label === "Pressure to always answer")?.contribution).toBeGreaterThan(0);
  });

  it("scales hallucination risk by the model profile", () => {
    const prompt = "List the five most cited papers on prompt injection with authors and years.";
    const small = metric(analyze(prompt, "small-open"), "hallucinationRisk");
    const frontier = metric(analyze(prompt, "claude-fable-5-1"), "hallucinationRisk");
    expect(small.score).toBeGreaterThan(frontier.score);
  });

  it("gives every metric evidence chunks that exist", () => {
    const a = analyze(SOCIAL_PROMPT, MODEL);
    for (const m of a.metrics) {
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(m.score).toBeLessThanOrEqual(1);
      for (const c of m.chunks) expect(a.chunks[c]).toBeDefined();
    }
  });
});
