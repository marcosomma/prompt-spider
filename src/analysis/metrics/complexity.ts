import type { LegContext, LegResult, Metric, MetricFactor } from "../types";
import { clamp01, countPhrases, countWords, saturate } from "../text";
import type { TaskItem } from "./tasks";
import type { Subtask } from "./subtasks";

const CONDITIONALS = new Set(["if", "unless", "when", "whenever", "otherwise", "except", "whereas", "depending", "else"]);
const CONDITIONAL_PHRASES = ["only if", "in case", "as long as", "provided that", "in which case"];
const REASONING_VERBS = new Set(["analyze", "analyse", "compare", "evaluate", "assess", "rank", "classify", "justify", "reason", "judge", "infer", "derive", "prioritize", "prioritise", "weigh", "critique", "diagnose", "reconcile", "trade-off", "tradeoff", "decide", "determine", "interpret"]);
const STRUCTURE_WORDS = new Set(["json", "schema", "yaml", "xml", "fields", "field", "nested", "array", "object", "table", "columns", "sections", "template", "uuid", "ids", "id", "enum", "key", "keys"]);
const VAGUE_LONG = /\b\w{11,}\b/g;

interface Weighted {
  readonly label: string;
  readonly weight: number;
  readonly score: number;
  readonly value: string;
  readonly chunks: readonly number[];
}

/** Composite difficulty of what the prompt asks, with its breakdown. */
export function complexityMetric(ctx: LegContext, tasks: readonly TaskItem[], subtasks: readonly Subtask[], legs: readonly LegResult[]): Metric {
  const { chunks, tokens } = ctx;
  const constraint = legs.find((l) => l.id === "constraint")?.scores ?? [];
  const totalTokens = tokens.reduce((sum, t) => sum + t.length, 0);

  const deliverables = tasks.filter((t) => t.grade === "deliverable");
  const constrained = chunks.filter((c) => (constraint[c.index] ?? 0) >= 0.5).map((c) => c.index);

  const conditional: number[] = [];
  const reasoning: number[] = [];
  const structured: number[] = [];
  let conditionalHits = 0;
  let reasoningHits = 0;
  let structureHits = 0;
  let longWords = 0;
  chunks.forEach((chunk, i) => {
    const toks = tokens[i] ?? [];
    const c = countWords(toks, CONDITIONALS) + countPhrases(toks, CONDITIONAL_PHRASES);
    if (c > 0) {
      conditional.push(chunk.index);
      conditionalHits += c;
    }
    const r = countWords(toks, REASONING_VERBS);
    if (r > 0) {
      reasoning.push(chunk.index);
      reasoningHits += r;
    }
    const s = countWords(toks, STRUCTURE_WORDS) + (chunk.kind === "code" ? 3 : 0);
    if (s > 0) {
      structured.push(chunk.index);
      structureHits += s;
    }
    longWords += chunk.text.match(VAGUE_LONG)?.length ?? 0;
  });

  const parts: Weighted[] = [
    // Sub-task count is the main driver: ten implied steps ≈ 0.45, twenty ≈ 0.7, forty ≈ 0.9.
    { label: "Implied sub-tasks", weight: 0.25, score: saturate(subtasks.length, 0.06), value: String(subtasks.length), chunks: subtasks.flatMap((s) => s.chunks) },
    // Every deliverable beyond the first is a whole extra task competing for the same answer.
    { label: "Deliverables", weight: 0.2, score: saturate(Math.max(0, deliverables.length - 1), 0.5), value: String(deliverables.length), chunks: deliverables.map((t) => t.chunk) },
    { label: "Hard constraints", weight: 0.15, score: saturate(constrained.length, 0.2), value: `${constrained.length} chunks`, chunks: constrained },
    { label: "Conditional branches", weight: 0.1, score: saturate(conditionalHits, 0.3), value: String(conditionalHits), chunks: conditional },
    { label: "Reasoning demands", weight: 0.1, score: saturate(reasoningHits, 0.35), value: String(reasoningHits), chunks: reasoning },
    { label: "Output structure", weight: 0.1, score: saturate(structureHits, 0.25), value: String(structureHits), chunks: structured },
    { label: "Domain vocabulary", weight: 0.05, score: clamp01((longWords / Math.max(1, totalTokens)) * 6), value: `${longWords} long words`, chunks: [] },
    { label: "Length", weight: 0.05, score: clamp01(Math.log10(Math.max(1, totalTokens / 40)) / Math.log10(50)), value: `${totalTokens} tokens`, chunks: [] },
  ];

  const weighted = clamp01(parts.reduce((sum, p) => sum + p.weight * p.score, 0) / parts.reduce((sum, p) => sum + p.weight, 0));
  // Four or more deliverables in one prompt is at least "high" however short each one is:
  // they compete for the same answer and the model has to schedule them itself.
  const overloaded = deliverables.length >= 4;
  const score = overloaded ? Math.max(weighted, 0.5) : weighted;
  const band =
    score < 0.22
      ? { label: "low", tone: "good" as const }
      : score < 0.45
        ? { label: "moderate", tone: "neutral" as const }
        : score < 0.68
          ? { label: "high", tone: "warning" as const }
          : { label: "very high", tone: "serious" as const };

  const drivers = [...parts].sort((a, b) => b.weight * b.score - a.weight * a.score).filter((p) => p.score > 0.2).slice(0, 3);
  const summary =
    drivers.length === 0
      ? "A short, single-step request with few constraints."
      : `Driven mainly by ${drivers.map((d) => d.label.toLowerCase()).join(", ")}.${overloaded ? ` Rated at least high because ${deliverables.length} deliverables compete in one prompt.` : ""}`;

  const factors: MetricFactor[] = parts.map((p) => ({ label: p.label, value: p.value, contribution: p.weight * p.score, chunks: [...new Set(p.chunks)] }));

  return {
    id: "complexity",
    label: "Task complexity",
    display: band.label,
    score,
    band,
    summary,
    factors,
    chunks: [...new Set(parts.flatMap((p) => p.chunks))],
  };
}
