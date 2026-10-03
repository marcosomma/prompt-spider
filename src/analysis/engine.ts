import { chunkPrompt } from "./chunker";
import { LEGS } from "./legs";
import { getModelProfile } from "./models";
import { excerpt, normalize, tokenize } from "./text";
import { computeMetrics } from "./metrics";
import type { Analysis, Chunk, Insight, LegContext, LegDefinition, LegResult, ModelProfile } from "./types";

export interface AnalyzeOptions {
  /**
   * Extra legs appended after the built-in ones, for example a model
   * self-report obtained through the API. Each must score every chunk.
   */
  readonly extraLegs?: readonly LegDefinition[];
}

/**
 * Runs every leg over every chunk and folds the results into a composite
 * focus estimate. Pure and synchronous: the same prompt and profile always
 * give the same analysis.
 */
export function analyze(prompt: string, modelId: string, options: AnalyzeOptions = {}): Analysis {
  const profile = getModelProfile(modelId);
  const chunks = chunkPrompt(prompt);
  const ctx: LegContext = {
    prompt,
    chunks,
    tokens: chunks.map((c) => tokenize(c.text)),
    profile,
  };

  const definitions = [...LEGS, ...(options.extraLegs ?? [])];
  const legs = definitions.map((leg) => runLeg(leg, ctx));
  const focusRaw = composite(legs, chunks.length);
  const focus = normalize(focusRaw);
  const ranking = chunks.map((c) => c.index).sort((a, b) => focus[b]! - focus[a]!);

  return {
    prompt,
    profile,
    chunks,
    legs,
    focus,
    focusRaw,
    ranking,
    insights: deriveInsights(chunks, legs, focus, profile),
    metrics: computeMetrics(ctx, legs),
  };
}

function runLeg(leg: LegDefinition, ctx: LegContext): LegResult {
  const scores = leg.score(ctx);
  if (scores.length !== ctx.chunks.length) {
    throw new Error(`Leg "${leg.id}" returned ${scores.length} scores for ${ctx.chunks.length} chunks`);
  }
  for (const s of scores) {
    if (!Number.isFinite(s) || s < 0 || s > 1) throw new Error(`Leg "${leg.id}" produced an out-of-range score: ${s}`);
  }
  const weight = ctx.profile.legWeights[leg.id];
  return { id: leg.id, label: leg.label, polarity: leg.polarity, description: leg.description, explainer: leg.explainer, weight, scores };
}

/** Weighted sum of focus legs minus weighted sum of diluting legs, per chunk. */
function composite(legs: readonly LegResult[], count: number): number[] {
  const out = new Array<number>(count).fill(0);
  for (const leg of legs) {
    const sign = leg.polarity === "focus" ? 1 : -1;
    for (let i = 0; i < count; i += 1) out[i]! += sign * leg.weight * leg.scores[i]!;
  }
  return out;
}

function legScores(legs: readonly LegResult[], id: string): readonly number[] | undefined {
  return legs.find((l) => l.id === id)?.scores;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Plain-language observations derived from the matrix. Each one names the
 * chunks it is about so the UI can highlight them.
 */
export function deriveInsights(
  chunks: readonly Chunk[],
  legs: readonly LegResult[],
  focus: readonly number[],
  profile: ModelProfile,
): Insight[] {
  const insights: Insight[] = [];
  const n = chunks.length;
  if (n === 0) return insights;

  const directive = legScores(legs, "directive") ?? [];
  const position = legScores(legs, "position") ?? [];
  const hedging = legScores(legs, "hedging") ?? [];
  const emphasis = legScores(legs, "emphasis") ?? [];
  const contextLoad = legScores(legs, "contextLoad") ?? [];
  const outputShape = legScores(legs, "outputShape") ?? [];
  const constraint = legScores(legs, "constraint") ?? [];
  const medianFocus = median(focus);

  const buried = chunks
    .filter((c) => directive[c.index]! >= 0.5 && position[c.index]! < 0.6 && focus[c.index]! <= medianFocus)
    .map((c) => c.index);
  if (buried.length > 0) {
    insights.push({
      severity: "warn",
      title: "Instruction buried in the middle",
      detail: `${buried.length} directive chunk${buried.length > 1 ? "s" : ""} sit${buried.length > 1 ? "" : "s"} where ${profile.label} pays the least attention. Move them to the start or the end, or give them a heading.`,
      chunks: buried,
    });
  }

  const hedged = chunks.filter((c) => directive[c.index]! >= 0.45 && hedging[c.index]! >= 0.45).map((c) => c.index);
  if (hedged.length > 0) {
    insights.push({
      severity: "warn",
      title: "Hedged instruction",
      detail: "These chunks tell the model what to do and, in the same breath, that it is optional. Decide which.",
      chunks: hedged,
    });
  }

  const totalChars = chunks.reduce((sum, c) => sum + c.text.length, 0);
  const contextChunks = chunks.filter((c) => contextLoad[c.index]! >= 0.55);
  const contextChars = contextChunks.reduce((sum, c) => sum + c.text.length, 0);
  if (totalChars > 0 && contextChars / totalChars > 0.5) {
    insights.push({
      severity: "info",
      title: "Context outweighs instructions",
      detail: `${Math.round((contextChars / totalChars) * 100)}% of the text is background or examples. Fine if intended; otherwise fence it in a tagged section so the task stands out.`,
      chunks: contextChunks.map((c) => c.index),
    });
  }

  const shouting = chunks.filter((c) => emphasis[c.index]! >= 0.5).map((c) => c.index);
  if (n >= 4 && shouting.length / n > 0.4) {
    insights.push({
      severity: "warn",
      title: "Emphasis everywhere",
      detail: "When almost every chunk is stressed, none stands out. Keep emphasis for the one or two rules that matter most.",
      chunks: shouting,
    });
  }

  const shapeMax = Math.max(...outputShape);
  if (shapeMax < 0.3) {
    insights.push({
      severity: "info",
      title: "No output shape",
      detail: "Nothing tells the model how long, in what format or in which tone to answer. It will pick defaults.",
      chunks: [],
    });
  }

  const constraintChunks = chunks.filter((c) => constraint[c.index]! >= 0.55).map((c) => c.index);
  if (constraintChunks.length >= 6 && (profile.id === "small-open" || profile.id === "claude-haiku-4-5")) {
    insights.push({
      severity: "warn",
      title: "Many hard constraints for a small model",
      detail: `${constraintChunks.length} chunks carry hard limits. ${profile.label} tends to drop some of them; prioritise or split the task.`,
      chunks: constraintChunks,
    });
  }

  const top = [...chunks].sort((a, b) => focus[b.index]! - focus[a.index]!).slice(0, Math.min(3, n));
  insights.push({
    severity: "info",
    title: "Where the model will focus",
    detail: top.map((c) => `#${c.index + 1} “${excerpt(c.text, 60)}”`).join("  ·  "),
    chunks: top.map((c) => c.index),
  });

  return insights;
}

export { excerpt };
