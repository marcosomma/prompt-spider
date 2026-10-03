import type { Chunk, LegContext, LegResult, Metric, MetricFactor } from "../types";
import { clamp01, countPhrases, countPhrasesUnlessNegated, countWords, rawTokens, saturate } from "../text";
import type { TaskItem } from "./tasks";

/**
 * Hallucination risk, estimated from prompt features that are known to push a
 * model towards fabricating: requests for precise facts without source
 * material, pressure to always answer, forced completeness, long open-ended
 * output. Grounding material and permission to abstain pull the other way.
 * Creative tasks scale the factual pressure down because invention is wanted.
 *
 * This is a feature-based estimate, not a measured probability.
 */

const FACT_WORDS = new Set(["cite", "citation", "citations", "source", "sources", "reference", "references", "statistics", "statistic", "figures", "figure", "data", "study", "studies", "research", "evidence", "quote", "quotes", "exact", "precise", "url", "urls", "link", "links", "doi", "date", "dates", "year", "percentage", "percent", "price", "prices", "revenue", "author", "authors", "paper", "papers", "law", "laws", "article", "articles", "regulation", "regulations", "case", "precedent", "biography", "specs", "specifications", "version", "benchmark", "benchmarks", "numbers", "stats", "facts", "fact"]);
const CERTAINTY_PHRASES = ["never say you don't know", "never say you do not know", "always answer", "always provide", "must answer", "no disclaimers", "no disclaimer", "don't hedge", "do not hedge", "be confident", "do not refuse", "never refuse", "without caveats", "no caveats", "do not say you cannot", "never leave blank", "never leave empty", "always give", "always include", "must include", "do not ask", "never ask"];
const COMPLETENESS_WORDS = new Set(["every", "each", "all", "exactly", "complete", "full", "entire", "exhaustive", "comprehensive"]);
const COMPLETENESS_PHRASES = ["at least", "no fewer than", "must have", "needs at least", "gets at least", "is required", "are required"];
const OPEN_ENDED = new Set(["detailed", "comprehensive", "in-depth", "exhaustive", "thorough", "everything", "extensive", "elaborate", "long", "lengthy"]);
const SPECULATION = new Set(["predict", "forecast", "guess", "speculate", "likely", "probably", "will", "future", "trend", "trends"]);
const GROUNDING_PHRASES = ["based on the", "from the provided", "from the text", "in the text", "in the document", "using only", "only use", "do not use outside", "from the context", "provided below", "attached", "the following document", "according to the", "from the source", "in the source", "ground in", "grounded in"];
const GROUNDING_SECTIONS = new Set(["context", "document", "documents", "data", "input", "source", "sources", "reference", "references", "text", "transcript", "notes", "examples", "example", "requirements", "policy"]);
const ABSTENTION_PHRASES = ["if you don't know", "if you do not know", "say so", "say you don't know", "i don't know", "not sure", "unsure", "not found", "return null", "leave empty", "leave it empty", "leave blank", "do not invent", "don't invent", "never invent", "do not make up", "don't make up", "never make up", "do not fabricate", "don't fabricate", "do not guess", "don't guess", "never guess", "only if you are sure", "when uncertain", "if uncertain", "verify", "double-check", "flag uncertainty", "state your confidence", "cite from the provided", "skip it", "do not report"];
const JUDGEMENT_VERBS = new Set(["assess", "evaluate", "judge", "classify", "rank", "rate", "score", "grade", "audit", "review", "diagnose", "determine", "identify", "flag", "detect", "surface"]);
const CREATIVE_WORDS = new Set(["story", "stories", "poem", "poems", "fiction", "fictional", "imagine", "brainstorm", "slogan", "slogans", "tagline", "taglines", "ad", "ads", "post", "posts", "tweet", "tweets", "caption", "captions", "creative", "invent", "fantasy", "character", "characters", "lyrics", "joke", "jokes", "pitch", "copy", "headline", "headlines", "hook", "hooks"]);

interface Signal {
  readonly label: string;
  readonly contribution: number;
  readonly value: string;
  readonly chunks: readonly number[];
}

export function hallucinationRiskMetric(ctx: LegContext, tasks: readonly TaskItem[], legs: readonly LegResult[]): Metric {
  const { chunks, tokens, profile } = ctx;
  const contextLoad = legs.find((l) => l.id === "contextLoad")?.scores ?? [];
  const taskChunks = new Set(tasks.map((t) => t.chunk));

  const tally = (words: ReadonlySet<string>, phrases: readonly string[] = [], filter: (c: Chunk) => boolean = () => true, negationAware = false) => {
    let hits = 0;
    const where: number[] = [];
    chunks.forEach((chunk, i) => {
      if (!filter(chunk)) return;
      const toks = tokens[i] ?? [];
      const h = countWords(toks, words) + (negationAware ? countPhrasesUnlessNegated(toks, phrases) : countPhrases(toks, phrases));
      if (h > 0) {
        hits += h;
        where.push(chunk.index);
      }
    });
    return { hits, where };
  };

  // Grounding: material the model can read instead of recall.
  const groundedChunks = chunks.filter((c) => (contextLoad[c.index] ?? 0) >= 0.55 || c.kind === "code" || (c.section !== null && GROUNDING_SECTIONS.has(c.section))).map((c) => c.index);
  const groundingLanguage = tally(new Set<string>(), GROUNDING_PHRASES);
  const groundedChars = groundedChunks.reduce((sum, i) => sum + chunks[i]!.text.length, 0);
  const totalChars = chunks.reduce((sum, c) => sum + c.text.length, 0);
  const groundingStrength = clamp01((totalChars ? groundedChars / totalChars : 0) * 1.5 + saturate(groundingLanguage.hits, 0.5) * 0.6);

  // "Never say you don't know" is pressure, not permission: abstention phrases are negation-aware.
  const abstention = tally(new Set<string>(), ABSTENTION_PHRASES, () => true, true);
  const judgement = tally(JUDGEMENT_VERBS, [], (c) => taskChunks.has(c.index) || c.kind === "bullet");
  const creative = tally(CREATIVE_WORDS, [], (c) => taskChunks.has(c.index) || c.kind !== "bullet");
  const creativeMode = creative.hits > 0 && tally(FACT_WORDS).hits <= 1;

  const facts = tally(FACT_WORDS, [], (c) => !groundedChunks.includes(c.index));
  const entities = (() => {
    let count = 0;
    const where: number[] = [];
    for (const chunk of chunks) {
      if (groundedChunks.includes(chunk.index) || chunk.kind === "code") continue;
      const n = rawTokens(chunk.text).filter((w, k) => k > 0 && /^[A-Z][a-z]{2,}/.test(w)).length;
      if (n > 0) {
        count += n;
        where.push(chunk.index);
      }
    }
    return { hits: count, where };
  })();
  const certainty = tally(new Set<string>(), CERTAINTY_PHRASES);
  const completeness = tally(COMPLETENESS_WORDS, COMPLETENESS_PHRASES);
  const openEnded = tally(OPEN_ENDED);
  const speculation = tally(SPECULATION, [], (c) => taskChunks.has(c.index));

  const factualScale = (1 - 0.6 * groundingStrength) * (creativeMode ? 0.35 : 1);
  const signals: Signal[] = [
    { label: "Unsourced facts requested", contribution: 0.3 * saturate(facts.hits, 0.45) * factualScale, value: `${facts.hits} cues`, chunks: facts.where },
    { label: "Specific entities without material", contribution: 0.15 * saturate(entities.hits, 0.2) * factualScale, value: `${entities.hits} names`, chunks: entities.where },
    { label: "Pressure to always answer", contribution: 0.25 * saturate(certainty.hits, 0.8), value: `${certainty.hits} phrases`, chunks: certainty.where },
    { label: "Forced completeness", contribution: 0.15 * saturate(completeness.hits, 0.3), value: `${completeness.hits} cues`, chunks: completeness.where },
    { label: "Long open-ended output", contribution: 0.1 * saturate(openEnded.hits, 0.6), value: `${openEnded.hits} cues`, chunks: openEnded.where },
    { label: "Speculation asked", contribution: 0.1 * saturate(speculation.hits, 0.6) * (creativeMode ? 0.35 : 1), value: `${speculation.hits} cues`, chunks: speculation.where },
    // Evaluative claims about material (gaps, scores, verdicts) are a classic fabrication surface.
    { label: "Judgement-heavy analysis", contribution: 0.12 * saturate(judgement.hits, 0.35) * (creativeMode ? 0.35 : 1), value: `${judgement.hits} cues`, chunks: judgement.where },
    { label: "Grounding material provided", contribution: -0.3 * groundingStrength, value: `${Math.round((totalChars ? groundedChars / totalChars : 0) * 100)}% of text`, chunks: [...groundedChunks, ...groundingLanguage.where] },
    { label: "Abstention allowed", contribution: -0.25 * saturate(abstention.hits, 0.8), value: `${abstention.hits} phrases`, chunks: abstention.where },
  ];
  if (creativeMode) signals.push({ label: "Creative task (invention wanted)", contribution: -0.1, value: `${creative.hits} cues`, chunks: creative.where });

  const base = 0.12 + signals.reduce((sum, s) => sum + s.contribution, 0);
  const score = clamp01(base * profile.hallucinationFactor);
  const band =
    score < 0.2
      ? { label: "low", tone: "good" as const }
      : score < 0.4
        ? { label: "moderate", tone: "neutral" as const }
        : score < 0.65
          ? { label: "elevated", tone: "warning" as const }
          : { label: "high", tone: "serious" as const };

  const mitigations: string[] = [];
  if (abstention.hits === 0 && !creativeMode) mitigations.push("allow “I don't know” or an empty result");
  if (groundingStrength < 0.3 && facts.hits > 0) mitigations.push("provide the source material instead of asking for recall");
  if (certainty.hits > 0) mitigations.push("drop the pressure to always answer");
  if (completeness.hits >= 3) mitigations.push("make completeness optional where data may be missing");
  const summary = `${band.label[0]!.toUpperCase()}${band.label.slice(1)} risk for ${profile.label}${creativeMode ? " (creative task, fabrication is expected)" : ""}.${mitigations.length ? ` To lower it: ${mitigations.join("; ")}.` : ""}`;

  const factors: MetricFactor[] = signals.filter((s) => Math.abs(s.contribution) > 0.004 || s.label.startsWith("Grounding") || s.label.startsWith("Abstention")).map((s) => ({ label: s.label, value: s.value, contribution: s.contribution, chunks: [...new Set(s.chunks)] }));

  return {
    id: "hallucinationRisk",
    label: "Hallucination risk",
    display: score < 0.05 ? "< 5%" : `≈ ${Math.round(score * 100)}%`,
    score,
    band,
    summary,
    factors,
    chunks: [...new Set(signals.flatMap((s) => s.chunks))],
    caveat: "Estimated from prompt features and the model profile, not a measured probability.",
  };
}
