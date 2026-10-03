import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Chunk, LegDefinition, ModelProfile } from "./types";

/**
 * Optional leg that asks the *actual* model how much each chunk drives what it
 * would do, and why. The heuristic legs are priors; this is the model's own
 * report, with its reasoning attached.
 *
 * Runs in the browser with a key the user supplies, so the SDK's browser guard
 * is explicitly lifted. The key is kept in memory only. The call is streamed so
 * the UI can show live progress while the model rates chunks.
 */

const ChunkWeight = z.object({
  index: z.number().int().min(0).describe("Zero-based chunk index exactly as given"),
  weight: z.number().min(0).max(1).describe("How strongly this chunk shapes what you would actually do: 0 = ignorable, 1 = decisive"),
  reason: z.string().max(160).describe("One short sentence: why this weight"),
});

const Report = z.object({
  reasoning: z
    .string()
    .describe("4 to 8 sentences on how you read the prompt as a whole: what dominates, what you would de-prioritise or treat as optional, and why"),
  conflicts: z.array(z.string().max(200)).describe("Instructions that conflict with or undercut each other, one short line each; empty if none"),
  weights: z.array(ChunkWeight).describe("Exactly one entry per chunk"),
});

export type ReportShape = z.infer<typeof Report>;

export interface SelfReport {
  /** Model id the API actually served. */
  readonly model: string;
  readonly scores: readonly number[];
  readonly reasons: readonly string[];
  /** The model's whole-prompt reasoning. */
  readonly reasoning: string;
  readonly conflicts: readonly string[];
  /** Summarised extended thinking, when the model exposes it; empty otherwise. */
  readonly thinkingSummary: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly durationMs: number;
}

export type SelfReportPhase = "connecting" | "thinking" | "rating" | "finishing";

export interface SelfReportProgress {
  readonly phase: SelfReportPhase;
  /** Chunk ratings received so far (from the streamed JSON). */
  readonly rated: number;
  readonly total: number;
}

export const SELF_REPORT_LEG_ID = "selfReport" as const;

export async function requestSelfReport(
  prompt: string,
  chunks: readonly Chunk[],
  profile: ModelProfile,
  apiKey: string,
  onProgress?: (progress: SelfReportProgress) => void,
): Promise<SelfReport> {
  const model = profile.claudeApiModel;
  if (!model) throw new Error(`${profile.label} has no API model to ask.`);

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const started = performance.now();
  const total = chunks.length;
  onProgress?.({ phase: "connecting", rated: 0, total });

  const stream = client.messages.stream({
    model,
    max_tokens: 16000,
    ...thinkingParams(profile),
    output_config: { format: zodOutputFormat(Report), ...(profile.apiThinking === "adaptive" ? { effort: "medium" as const } : {}) },
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(prompt, chunks) }],
  });

  let text = "";
  let thinking = "";
  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    if (event.delta.type === "thinking_delta") {
      thinking += event.delta.thinking;
      onProgress?.({ phase: "thinking", rated: 0, total });
    } else if (event.delta.type === "text_delta") {
      text += event.delta.text;
      onProgress?.({ phase: "rating", rated: Math.min(total, countRated(text)), total });
    }
  }
  onProgress?.({ phase: "finishing", rated: total, total });

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    throw new Error(`The model declined to analyse this prompt${category ? ` (${category})` : ""}.`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The model ran out of output tokens before finishing the report.");
  }
  const finalText = message.content.find((block) => block.type === "text")?.text ?? text;
  const parsed = parseReport(finalText, total);

  return {
    model: message.model,
    scores: parsed.scores,
    reasons: parsed.reasons,
    reasoning: parsed.reasoning,
    conflicts: parsed.conflicts,
    thinkingSummary: thinking.trim(),
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    durationMs: Math.round(performance.now() - started),
  };
}

function thinkingParams(profile: ModelProfile): Pick<Anthropic.MessageCreateParams, "thinking"> {
  switch (profile.apiThinking) {
    case "adaptive":
      return { thinking: { type: "adaptive", display: "summarized" } };
    case "budget":
      return { thinking: { type: "enabled", budget_tokens: 4000 } };
    case null:
      return {};
  }
}

/** Number of chunk ratings present in a (possibly partial) streamed JSON report. */
export function countRated(partialJson: string): number {
  return partialJson.match(/"weight"\s*:/g)?.length ?? 0;
}

export interface ParsedReport {
  readonly scores: number[];
  readonly reasons: string[];
  readonly reasoning: string;
  readonly conflicts: string[];
}

/** Validates the model's JSON and aligns it to the chunk list; unrated chunks score 0. */
export function parseReport(json: string, chunkCount: number): ParsedReport {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("The model answered, but not with valid JSON.");
  }
  const result = Report.safeParse(raw);
  if (!result.success) throw new Error("The model answered, but not in the expected structure.");

  const scores = new Array<number>(chunkCount).fill(0);
  const reasons = new Array<string>(chunkCount).fill("");
  for (const item of result.data.weights) {
    if (item.index < chunkCount) {
      scores[item.index] = item.weight;
      reasons[item.index] = item.reason;
    }
  }
  return { scores, reasons, reasoning: result.data.reasoning.trim(), conflicts: result.data.conflicts.map((c) => c.trim()).filter(Boolean) };
}

/** Wraps a self-report as a leg so the engine can draw it like any other. */
export function selfReportLeg(report: SelfReport): LegDefinition {
  return {
    id: SELF_REPORT_LEG_ID,
    label: "Model self-report",
    polarity: "focus",
    description: `${report.model} rated how strongly each chunk drives what it would do.`,
    explainer: {
      what: "The model's own rating of how much each piece would change what it does, obtained by asking it through the API.",
      why: "The other legs are rules of thumb about prompts in general. This one is the model speaking for itself, so it carries more weight than any single heuristic.",
      high: "A piece the model says it would follow to the letter.",
      low: "A piece the model says it could drop without changing its answer.",
    },
    score: () => [...report.scores],
  };
}

const SYSTEM = `You are given a prompt someone intends to send to you, split into numbered chunks.
First explain, in plain language, how you read the prompt as a whole: which parts would actually govern your behaviour, which you would keep in mind but not act on, which you could drop without changing your answer, and where instructions conflict or undercut each other.
Then rate every chunk exactly once on how strongly it would shape what you actually do when answering the whole prompt, with one short reason each.
Be decisive: use the full 0–1 range and do not spread weights evenly.`;

function buildUserMessage(prompt: string, chunks: readonly Chunk[]): string {
  const list = chunks.map((c) => `[${c.index}] ${c.text.replace(/\s+/g, " ").trim()}`).join("\n");
  return `Full prompt for reference:\n<prompt>\n${prompt}\n</prompt>\n\nChunks to rate (${chunks.length}):\n${list}`;
}

export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "The API key was rejected.";
  if (error instanceof Anthropic.PermissionDeniedError) return "This key is not allowed to use that model.";
  if (error instanceof Anthropic.NotFoundError) return "Unknown model for this key.";
  if (error instanceof Anthropic.RateLimitError) return "Rate limited. Try again in a minute.";
  if (error instanceof Anthropic.BadRequestError) return `The API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Could not reach the API (network or CORS).";
  if (error instanceof Anthropic.APIError) return `API error ${error.status ?? ""}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
