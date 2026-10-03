import type { LegId, ModelProfile } from "./types";

/**
 * Model profiles are editorial priors, not measurements: they encode what is
 * commonly observed about each class of model (how much it sags in the middle
 * of a long prompt, how much it responds to shouting, whether it was trained
 * on XML or Markdown scaffolding). Swap or tune them freely; the engine only
 * needs the shape. The optional "self-report" leg asks the real model.
 */

const BASE_WEIGHTS: Readonly<Record<LegId, number>> = {
  directive: 1,
  constraint: 1,
  specificity: 0.85,
  emphasis: 0.6,
  outputShape: 0.9,
  roleFrame: 0.6,
  structure: 0.8,
  position: 0.6,
  reinforcement: 0.5,
  contextLoad: 0.7,
  hedging: 0.8,
  // The model's own report, when requested, outranks any single heuristic.
  selfReport: 1.5,
};

function weights(overrides: Partial<Record<LegId, number>>): Readonly<Record<LegId, number>> {
  return { ...BASE_WEIGHTS, ...overrides };
}

export const MODEL_PROFILES: readonly ModelProfile[] = [
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    vendor: "Anthropic",
    claudeApiModel: "claude-fable-5-1",
    apiThinking: "adaptive",
    legWeights: weights({ emphasis: 0.45, position: 0.45, specificity: 0.95, hedging: 0.9, reinforcement: 0.4 }),
    position: { primacy: 0.25, recency: 0.3, tau: 0.3, floor: 0.6 },
    structureBoost: { xml: 0.3, markdown: 0.15 },
    hallucinationFactor: 0.75,
    notes: [
      "Flattest position curve: the middle of a long prompt is still read carefully.",
      "Over-prescriptive prompts reduce quality; shouting (CAPS, IMPORTANT) adds little.",
      "XML-style sections are a strong locator; a hedged instruction is genuinely treated as optional.",
    ],
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    vendor: "Anthropic",
    claudeApiModel: "claude-opus-5-5",
    apiThinking: "adaptive",
    legWeights: weights({ emphasis: 0.5, position: 0.5, specificity: 0.9 }),
    position: { primacy: 0.3, recency: 0.3, tau: 0.28, floor: 0.55 },
    structureBoost: { xml: 0.3, markdown: 0.15 },
    hallucinationFactor: 0.8,
    notes: [
      "Frontier-class attention: constraints and directives dominate; emphasis helps only when rare.",
      "XML sections and numbered steps are the most reliable scaffolding.",
    ],
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    vendor: "Anthropic",
    claudeApiModel: "claude-sonnet-5-5",
    apiThinking: "adaptive",
    legWeights: weights({ emphasis: 0.7, position: 0.7, structure: 0.9, reinforcement: 0.6 }),
    position: { primacy: 0.35, recency: 0.4, tau: 0.25, floor: 0.45 },
    structureBoost: { xml: 0.3, markdown: 0.15 },
    hallucinationFactor: 0.9,
    notes: [
      "Noticeably stronger recency: the last instruction tends to win a conflict.",
      "Benefits more than Opus from explicit structure and from repeating the key constraint once.",
    ],
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    vendor: "Anthropic",
    claudeApiModel: "claude-haiku-4-5",
    apiThinking: "budget",
    legWeights: weights({ emphasis: 0.9, position: 1, structure: 1, specificity: 0.7, reinforcement: 0.8, hedging: 1 }),
    position: { primacy: 0.5, recency: 0.5, tau: 0.2, floor: 0.35 },
    structureBoost: { xml: 0.3, markdown: 0.1 },
    hallucinationFactor: 1.1,
    notes: [
      "Pronounced lost-in-the-middle sag: bury an instruction and it may be skipped.",
      "Responds strongly to emphasis and repetition; keep the prompt short and scaffolded.",
    ],
  },
  {
    id: "gpt-class",
    label: "GPT-class frontier model",
    vendor: "Generic",
    claudeApiModel: null,
    apiThinking: null,
    legWeights: weights({ emphasis: 0.7, position: 0.7, roleFrame: 0.75 }),
    position: { primacy: 0.4, recency: 0.35, tau: 0.25, floor: 0.5 },
    structureBoost: { xml: 0.1, markdown: 0.3 },
    hallucinationFactor: 0.95,
    notes: [
      "Markdown headings and bold carry more structural weight than XML tags.",
      "System-style role framing has a comparatively large effect on register.",
    ],
  },
  {
    id: "small-open",
    label: "Small open-weights (7–9B)",
    vendor: "Generic",
    claudeApiModel: null,
    apiThinking: null,
    legWeights: weights({ emphasis: 1, position: 1, reinforcement: 1, hedging: 1, constraint: 0.7, specificity: 0.6, roleFrame: 0.5 }),
    position: { primacy: 0.6, recency: 0.6, tau: 0.15, floor: 0.25 },
    structureBoost: { xml: 0.15, markdown: 0.25 },
    hallucinationFactor: 1.4,
    notes: [
      "Steep position curve: only the first and last few chunks are reliably honoured.",
      "Multiple constraints in one prompt compete; numbers and units are often dropped.",
      "Repetition and emphasis are the main levers that still work.",
    ],
  },
];

export const DEFAULT_MODEL_ID = "claude-opus-5-5";

export function getModelProfile(id: string): ModelProfile {
  const profile = MODEL_PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown model profile: ${id}`);
  return profile;
}
