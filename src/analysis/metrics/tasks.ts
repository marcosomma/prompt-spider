import type { LegContext } from "../types";
import { contentTokens, jaccard, tokenize } from "../text";

/**
 * Task detection. A *task* is an instruction to produce or perform something
 * (write, summarise, classify…), as opposed to a *rule* about how to do it
 * (keep it short, never mention…). Tasks come in two grades:
 *
 * - `deliverable`: what the prompt is fundamentally asking for. Found in prose
 *   or under task framing ("Your job:", "I need you to…").
 * - `operation`: a production verb inside a rule list — a sub-step the model
 *   must perform on the way to the deliverable (classify each…, rank…).
 *
 * Several clauses in one chunk ("write a post and translate it") each count.
 */

export type TaskGrade = "deliverable" | "operation";

export interface TaskItem {
  readonly chunk: number;
  readonly verb: string;
  readonly grade: TaskGrade;
  /** The clause the verb heads, trimmed for display. */
  readonly clause: string;
}

const PRODUCTION_VERBS = new Set([
  "write", "create", "generate", "produce", "draft", "compose", "summarize", "summarise", "translate", "extract",
  "classify", "categorize", "categorise", "list", "enumerate", "explain", "describe", "compare", "identify", "analyze",
  "analyse", "review", "evaluate", "assess", "rank", "rate", "score", "build", "implement", "design", "plan", "fix",
  "debug", "rewrite", "convert", "transform", "refactor", "find", "search", "count", "estimate", "report", "surface",
  "outline", "propose", "recommend", "suggest", "brainstorm", "calculate", "compute", "solve", "determine", "decide",
  "label", "tag", "annotate", "detect", "flag", "grade", "judge", "verify", "validate", "audit", "map", "match", "merge",
  "sort", "filter", "group", "cluster", "caption", "paraphrase", "shorten", "expand", "elaborate", "critique", "improve",
  "optimize", "optimise", "simplify", "document", "predict", "forecast", "diagnose", "interpret", "infer", "derive",
  "prove", "demonstrate", "draw", "sketch", "code", "program", "query", "retrieve", "fetch", "answer", "respond",
  "reply", "return", "give", "provide", "tell", "show", "research", "investigate", "check", "test", "measure",
]);

/** Verbs that are tasks only when they are not shaping the output ("return only", "respond in JSON"). */
const SHAPE_SENSITIVE = new Set(["return", "respond", "reply", "answer", "give", "provide", "show", "tell"]);
const SHAPE_FOLLOWERS = new Set(["only", "with", "in", "using", "as", "a", "an", "the", "your", "exactly", "just", "no", "nothing", "plain", "valid", "one", "single", "json", "markdown", "everything", "all", "it", "them", "this", "these", "that", "those", "results", "result", "output", "both"]);

const LEADING_FILLER = new Set(["please", "maybe", "perhaps", "ideally", "optionally", "also", "then", "and", "just", "now", "finally", "first", "next", "always", "never", "kindly", "you", "should", "must", "will", "need", "to", "can", "could"]);
const NEGATORS = new Set(["not", "don't", "never", "avoid", "without", "no", "dont", "cannot", "can't", "shouldn't", "mustn't"]);

const FRAMING = [/\byour (job|task|goal|mission|role) (is|:)/i, /\b(i|we) (need|want|would like|'d like|ask) you to\b/i, /\b(can|could|would|will) you\b/i, /\bhelp me\b/i, /\bplease\b/i, /^task\b/i, /^goal\b/i, /^objective\b/i];
const CLAUSE_SPLIT = /[;,:.]|\b(?:and|then|also|plus|finally|next|afterwards|after that|as well as)\b/i;

export function detectTasks(ctx: LegContext): TaskItem[] {
  const items: TaskItem[] = [];
  for (const chunk of ctx.chunks) {
    if (chunk.kind === "code") continue;
    const framed = FRAMING.some((re) => re.test(chunk.text));
    const grade: TaskGrade = chunk.kind === "bullet" && !framed ? "operation" : "deliverable";
    for (const clause of chunk.text.split(CLAUSE_SPLIT)) {
      const toks = tokenize(clause);
      // A task needs an object: a lone verb (typically a quoted word in a prohibition) is not one.
      if (toks.length < 2) continue;
      const verb = productionHead(toks);
      if (verb) items.push({ chunk: chunk.index, verb, grade, clause: clause.replace(/\s+/g, " ").trim() });
    }
  }
  return dedupe(items);
}

/** The production verb heading a clause, skipping filler and rejecting negated or output-shaping uses. */
export function productionHead(tokens: readonly string[]): string | null {
  for (let i = 0; i < Math.min(tokens.length, 4); i += 1) {
    const token = tokens[i]!;
    if (NEGATORS.has(token)) return null;
    if (PRODUCTION_VERBS.has(token)) {
      if (SHAPE_SENSITIVE.has(token)) {
        const next = tokens[i + 1];
        if (next === undefined || SHAPE_FOLLOWERS.has(next)) return null;
      }
      return token;
    }
    if (!LEADING_FILLER.has(token)) return null;
  }
  return null;
}

/** Two task clauses with the same verb and heavily overlapping words are one task repeated. */
function dedupe(items: readonly TaskItem[]): TaskItem[] {
  const kept: TaskItem[] = [];
  const sets: Set<string>[] = [];
  for (const item of items) {
    const set = contentTokens(tokenize(item.clause));
    const duplicate = kept.some((k, i) => k.verb === item.verb && jaccard(sets[i]!, set) >= 0.5);
    if (duplicate) continue;
    kept.push(item);
    sets.push(set);
  }
  // Deliverables first, then operations, each in reading order.
  return kept.sort((a, b) => (a.grade === b.grade ? a.chunk - b.chunk : a.grade === "deliverable" ? -1 : 1));
}
