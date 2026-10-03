import type { LegContext, LegResult } from "../types";
import { countPhrases, countWords, excerpt, tokenize } from "../text";
import type { TaskItem } from "./tasks";

/**
 * Sub-task decomposition. A prompt that asks for one deliverable usually
 * implies many smaller steps the model must perform on the way: material to
 * understand, things to filter out, decisions to take, transformations to
 * apply, loops over items, output fields to compose, checks to run, tools to
 * call, and a final format to honour. Counting those is what separates a
 * "write a post" prompt from a forty-step specification.
 *
 * Rules are lexical and deliberately conservative: at most one sub-task of a
 * kind per chunk, except inputs and output fields which are deduplicated by
 * name across the whole prompt.
 */

export type SubtaskKind = "input" | "select" | "decide" | "transform" | "iterate" | "compose" | "verify" | "tool" | "format";

export interface Subtask {
  readonly kind: SubtaskKind;
  readonly label: string;
  readonly chunks: readonly number[];
}

export const SUBTASK_KIND_LABELS: Readonly<Record<SubtaskKind, string>> = {
  input: "inputs to understand",
  select: "filters",
  decide: "decisions",
  transform: "transformations",
  iterate: "per-item loops",
  compose: "output fields",
  verify: "verifications",
  tool: "tool calls",
  format: "output formatting",
};

/** Source material the model must read and hold in mind; one sub-task per distinct noun. */
const INPUT_NOUNS: Readonly<Record<string, string>> = {
  document: "document", documents: "document", policy: "policy", policies: "policy", requirement: "requirements",
  requirements: "requirements", source: "source", sources: "source", transcript: "transcript", dataset: "dataset",
  email: "email", emails: "email", codebase: "codebase", spec: "spec", specification: "spec", table: "table",
  file: "file", files: "file", block: "blocks", blocks: "blocks", graph: "graph", schema: "schema",
  contract: "contract", invoice: "invoice", resume: "resume", cv: "resume", ticket: "ticket", log: "log", logs: "log",
};
const SELECT_WORDS = new Set(["skip", "ignore", "exclude", "excluding", "except", "irrelevant", "omit", "discard", "filter"]);
const SELECT_PHRASES = ["only where", "only when", "only if", "do not report", "don't report", "do not flag", "don't flag", "do not include", "don't include", "not a gap", "does not belong", "doesn't belong", "leave out", "report only", "include only"];
const DECIDE_WORDS = new Set(["if", "unless", "when", "whenever", "otherwise", "depending", "else"]);
const DECIDE_PHRASES = ["in case", "as long as", "provided that", "in which case", "according to whether"];
/** Verbs that are a step in their own right, broader than the deliverable verbs. */
const ACTION_VERBS = new Set([
  "classify", "categorize", "categorise", "rank", "rate", "score", "grade", "merge", "map", "state", "name", "describe",
  "explain", "list", "enumerate", "anchor", "add", "amend", "translate", "summarize", "summarise", "compute", "calculate",
  "count", "extract", "identify", "detect", "flag", "label", "tag", "annotate", "report", "surface", "assess", "evaluate",
  "compare", "match", "sort", "group", "cluster", "split", "convert", "transform", "rewrite", "paraphrase", "shorten",
  "expand", "draft", "write", "compose", "generate", "produce", "retrieve", "fetch", "search", "find", "determine",
  "decide", "prioritize", "prioritise", "assign", "derive", "infer", "quote", "cite", "link", "attach", "fill", "populate",
]);
/** Noun forms of actions ("Verdict mapping:", "Classification:"). */
const ACTION_NOUNS = new Set(["mapping", "classification", "ranking", "extraction", "translation", "summary", "summarization", "validation", "grounding", "merge", "deduplication", "scoring", "grading", "labeling", "labelling", "annotation", "comparison", "assignment"]);
const NEGATORS = new Set(["not", "don't", "never", "avoid", "without", "no", "dont", "cannot", "can't"]);
const LEADING_FILLER = new Set(["please", "maybe", "perhaps", "ideally", "optionally", "also", "then", "and", "just", "now", "finally", "first", "next", "always", "you", "should", "must", "will", "need", "to", "can", "could", "use", "it", "them", "what", "returns"]);
const ITERATE_WORDS = new Set(["each", "every", "per"]);
const ITERATE_PHRASES = ["for each", "for every", "for all", "one per", "across all"];
const ITERATE_SKIP = new Set(["the", "a", "an", "of", "in", "its", "their", "your", "one", "other", "such", "time", "case", "step"]);
const VERIFY_WORDS = new Set(["verify", "confirm", "sharpen", "validate", "double-check", "check", "cross-check", "recheck", "ensure", "ground"]);
const VERIFY_PHRASES = ["before finalizing", "before finalising", "before answering", "sanity check", "never invent", "do not invent", "don't invent", "would contradict"];
const TOOL_WORDS = new Set(["tool", "tools", "api", "function", "endpoint", "database", "search"]);
const BACKTICK = /`([A-Za-z_][\w.-]*)`/g;
const JSON_KEY = /"([A-Za-z_][\w-]*)"\s*:/g;
const QUOTED_IDENT = /"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g;
const SKIP_FIELDS = new Set(["type", "id", "name", "value", "items", "properties", "required"]);

export function decomposeSubtasks(ctx: LegContext, tasks: readonly TaskItem[], legs: readonly LegResult[]): Subtask[] {
  const { chunks, tokens } = ctx;
  const out: Subtask[] = [];
  const outputShape = legs.find((l) => l.id === "outputShape")?.scores ?? [];
  const deliverableChunks = new Set(tasks.filter((t) => t.grade === "deliverable").map((t) => t.chunk));

  // Inputs and output fields are prompt-wide: collect, then emit once per name.
  const inputs = new Map<string, number[]>();
  const fields = new Map<string, number[]>();
  const tools = new Map<string, number[]>();
  const loops = new Map<string, number[]>();

  chunks.forEach((chunk, i) => {
    const toks = tokens[i] ?? [];
    const text = chunk.text;

    if (chunk.kind !== "code") {
      for (const token of toks) {
        const lemma = INPUT_NOUNS[token];
        if (lemma) push(inputs, lemma, chunk.index);
      }
    }
    for (const match of text.matchAll(JSON_KEY)) push(fields, match[1]!, chunk.index);
    if (chunk.kind !== "code") for (const match of text.matchAll(QUOTED_IDENT)) push(fields, match[1]!, chunk.index);
    for (const match of text.matchAll(BACKTICK)) push(tools, match[1]!, chunk.index);
    if (chunk.kind !== "code" && countWords(toks, TOOL_WORDS) > 0 && /\btool\b/i.test(text) && tools.size === 0) push(tools, "the provided tool", chunk.index);

    for (let k = 0; k < toks.length; k += 1) {
      const token = toks[k]!;
      const next = toks[k + 1];
      if ((ITERATE_WORDS.has(token) || (token === "for" && next !== undefined && (next === "each" || next === "every"))) && next !== undefined) {
        const noun = token === "for" ? toks[k + 2] : next;
        if (noun && !ITERATE_SKIP.has(noun) && /^[a-z]+$/.test(noun)) push(loops, singular(noun), chunk.index);
      }
    }
    if (countPhrases(toks, ITERATE_PHRASES) > 0 && loops.size === 0) push(loops, "item", chunk.index);

    if (chunk.kind === "code") return;

    // Per-chunk kinds: a conditional filter is a filter, not also a decision.
    const isSelect = countWords(toks, SELECT_WORDS) + countPhrases(toks, SELECT_PHRASES) > 0;
    const isDecide = !isSelect && countWords(toks, DECIDE_WORDS) + countPhrases(toks, DECIDE_PHRASES) > 0;
    if (isSelect) out.push({ kind: "select", label: `Filter: ${excerpt(text, 70)}`, chunks: [chunk.index] });
    if (isDecide) out.push({ kind: "decide", label: `Decide: ${excerpt(text, 70)}`, chunks: [chunk.index] });

    if (!deliverableChunks.has(chunk.index)) {
      const verb = actionHead(text) ?? [...toks].find((t) => ACTION_NOUNS.has(t)) ?? null;
      if (verb) out.push({ kind: "transform", label: `${capitalize(verb)}: ${excerpt(text, 64)}`, chunks: [chunk.index] });
    }

    if (countWords(toks, VERIFY_WORDS) + countPhrases(toks, VERIFY_PHRASES) > 0) {
      out.push({ kind: "verify", label: `Verify: ${excerpt(text, 70)}`, chunks: [chunk.index] });
    }
  });

  for (const [name, where] of inputs) out.push({ kind: "input", label: `Understand the ${name}`, chunks: unique(where) });
  for (const [noun, where] of loops) out.push({ kind: "iterate", label: `For each ${noun}`, chunks: unique(where) });
  for (const [field, where] of fields) if (!SKIP_FIELDS.has(field)) out.push({ kind: "compose", label: `Compose field “${field}”`, chunks: unique(where) });
  for (const [tool, where] of tools) out.push({ kind: "tool", label: `Call ${tool}`, chunks: unique(where) });

  const formatChunks = chunks.filter((c) => c.kind === "code" || (outputShape[c.index] ?? 0) >= 0.6).map((c) => c.index);
  if (formatChunks.length > 0) out.push({ kind: "format", label: "Honour the output format", chunks: formatChunks });

  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.chunks[0] ?? 0) - (b.chunks[0] ?? 0));
}

const KIND_ORDER: readonly SubtaskKind[] = ["input", "select", "decide", "transform", "iterate", "compose", "verify", "tool", "format"];

/** The action verb heading any clause of the chunk, skipping filler and rejecting negated clauses. */
function actionHead(text: string): string | null {
  for (const clause of text.split(/[;,:.]|\b(?:and|then|also|plus|finally|next|afterwards|after that|as well as)\b/i)) {
    const toks = tokenize(clause);
    if (toks.length < 2) continue;
    for (let i = 0; i < Math.min(toks.length, 4); i += 1) {
      const token = toks[i]!;
      if (NEGATORS.has(token)) break;
      if (ACTION_VERBS.has(token)) return token;
      if (!LEADING_FILLER.has(token)) break;
    }
  }
  return null;
}

function push(map: Map<string, number[]>, key: string, chunk: number): void {
  const list = map.get(key) ?? [];
  list.push(chunk);
  map.set(key, list);
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function singular(noun: string): string {
  return noun.endsWith("s") && noun.length > 4 ? noun.slice(0, -1) : noun;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function countByKind(subtasks: readonly Subtask[]): Map<SubtaskKind, number> {
  const counts = new Map<SubtaskKind, number>();
  for (const s of subtasks) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  return counts;
}
