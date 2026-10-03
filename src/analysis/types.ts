/**
 * Core data model shared by the analysis engine, the 3D scene and the UI.
 *
 * Vocabulary
 * - A *chunk* is a span of the prompt (sentence, bullet, heading, code block).
 * - A *leg* is one analysis. Every leg scores every chunk, so the spider has
 *   `legs × chunks` nodes and each leg "touches" each chunk exactly once.
 * - *Focus* is the composite, model-weighted estimate of how much a chunk
 *   steers the model's behaviour, normalised to [0, 1] across the prompt.
 */

export type ChunkKind = "heading" | "bullet" | "code" | "sentence";

export interface Chunk {
  /** Zero-based reading order. */
  readonly index: number;
  /** Exact text of the span, `prompt.slice(start, end)`. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly kind: ChunkKind;
  /** Zero-based paragraph (block separated by blank lines) the chunk belongs to. */
  readonly paragraph: number;
  /** Innermost enclosing XML/HTML-style tag name, lower-cased, when the prompt uses tags. */
  readonly section: string | null;
  /** True for numbered bullets (`1.`, `2)`), false otherwise. */
  readonly ordered: boolean;
  /** Nesting level of a bullet (0 = top level); 0 for everything else. */
  readonly depth: number;
  /** True when this chunk is a later sentence of a bullet that started in an earlier chunk. */
  readonly continuation: boolean;
}

export type LegId =
  | "directive"
  | "constraint"
  | "specificity"
  | "emphasis"
  | "outputShape"
  | "roleFrame"
  | "structure"
  | "position"
  | "reinforcement"
  | "contextLoad"
  | "hedging"
  /** Optional leg produced by asking the model itself (see llmJudge.ts). */
  | "selfReport";

/** `focus` legs raise the task weight of a chunk; `dilute` legs lower it. */
export type LegPolarity = "focus" | "dilute";

export interface LegContext {
  readonly prompt: string;
  readonly chunks: readonly Chunk[];
  /** Lower-cased word tokens per chunk, aligned with `chunks`. */
  readonly tokens: readonly (readonly string[])[];
  readonly profile: ModelProfile;
}

/** Plain-language explanation of a leg, written for people who do not build prompts for a living. */
export interface LegExplainer {
  /** What the leg looks at, in one or two short sentences. */
  readonly what: string;
  /** Why it changes how the model behaves. */
  readonly why: string;
  /** An example piece of prompt that scores high. */
  readonly high: string;
  /** An example piece of prompt that scores low. */
  readonly low: string;
}

export interface LegDefinition {
  readonly id: LegId;
  readonly label: string;
  readonly polarity: LegPolarity;
  /** One sentence shown in the UI legend. */
  readonly description: string;
  readonly explainer: LegExplainer;
  /** Returns one score in [0, 1] per chunk, aligned with `ctx.chunks`. */
  score(ctx: LegContext): number[];
}

export interface PositionCurve {
  /** Extra weight of the very first chunk (primacy). */
  readonly primacy: number;
  /** Extra weight of the very last chunk (recency). */
  readonly recency: number;
  /** Decay length, as a fraction of the chunk count. Larger = flatter. */
  readonly tau: number;
  /** Weight a chunk keeps in the middle of a long prompt. */
  readonly floor: number;
}

export interface ModelProfile {
  readonly id: string;
  readonly label: string;
  readonly vendor: string;
  /** Can this profile be asked to self-report through the Claude API? */
  readonly claudeApiModel: string | null;
  /** How the API model exposes thinking: adaptive (4.6+), a token budget (older), or none. */
  readonly apiThinking: "adaptive" | "budget" | null;
  /** Relative sensitivity of the model to each leg. 1 = baseline. */
  readonly legWeights: Readonly<Record<LegId, number>>;
  readonly position: PositionCurve;
  /** Extra structure credit for XML-style tags and Markdown scaffolding. */
  readonly structureBoost: { readonly xml: number; readonly markdown: number };
  /** Multiplier on the hallucination-risk estimate; 1 = frontier baseline. */
  readonly hallucinationFactor: number;
  /** Short editorial notes shown with the profile. */
  readonly notes: readonly string[];
}

export interface LegResult {
  readonly id: LegId;
  readonly label: string;
  readonly polarity: LegPolarity;
  readonly description: string;
  readonly explainer: LegExplainer;
  /** Model weight applied to this leg. */
  readonly weight: number;
  /** Raw scores in [0, 1], one per chunk. */
  readonly scores: readonly number[];
}

export type InsightSeverity = "info" | "warn";

export interface Insight {
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly detail: string;
  /** Chunk indices the insight refers to, for highlighting. */
  readonly chunks: readonly number[];
}

export type MetricId = "taskCount" | "complexity" | "hallucinationRisk";

/** Visual tone of a metric band. Status tones always ship with a label, never colour alone. */
export type MetricTone = "good" | "neutral" | "warning" | "serious";

export interface MetricFactor {
  readonly label: string;
  /** Human-readable value, e.g. "3 chunks", "0.42". */
  readonly value: string;
  /** Signed contribution to the metric score; sign is what the UI shows. */
  readonly contribution: number;
  /** Chunks that are the evidence for this factor. */
  readonly chunks: readonly number[];
}

/**
 * A prompt-level measurement. Unlike a leg it has one value for the whole
 * prompt, but it still points at the chunks that produced it.
 */
export interface Metric {
  readonly id: MetricId;
  readonly label: string;
  /** Short display value, e.g. "1", "high", "≈ 35%". */
  readonly display: string;
  /** Normalised score in [0, 1] used for the band and any gauge. */
  readonly score: number;
  readonly band: { readonly label: string; readonly tone: MetricTone };
  readonly summary: string;
  readonly factors: readonly MetricFactor[];
  /** Union of the evidence chunks, for highlighting the whole metric. */
  readonly chunks: readonly number[];
  /** Caveat shown in small print, when the metric is an estimate. */
  readonly caveat?: string;
}

export interface Analysis {
  readonly prompt: string;
  readonly profile: ModelProfile;
  readonly chunks: readonly Chunk[];
  readonly legs: readonly LegResult[];
  /** Composite focus per chunk, normalised to [0, 1] across the prompt. */
  readonly focus: readonly number[];
  /** Composite before normalisation; useful for comparing prompts. */
  readonly focusRaw: readonly number[];
  /** Chunk indices sorted by focus, highest first. */
  readonly ranking: readonly number[];
  readonly insights: readonly Insight[];
  readonly metrics: readonly Metric[];
}
