import type { LegContext, Metric, MetricFactor } from "../types";
import { excerpt } from "../text";
import type { TaskItem } from "./tasks";
import { SUBTASK_KIND_LABELS, countByKind, type Subtask, type SubtaskKind } from "./subtasks";

const KIND_SHORT: Readonly<Record<SubtaskKind, string>> = {
  input: "input",
  select: "filter",
  decide: "decision",
  transform: "transformation",
  iterate: "per-item loop",
  compose: "output field",
  verify: "verification request",
  tool: "tool call",
  format: "format",
};

/**
 * Task load: how many deliverables the prompt asks for and how many sub-tasks
 * they imply. The sub-task count is the headline, because that is what makes
 * a single-deliverable prompt hard.
 */
export function taskCountMetric(_ctx: LegContext, tasks: readonly TaskItem[], subtasks: readonly Subtask[]): Metric {
  const deliverables = tasks.filter((t) => t.grade === "deliverable");
  const n = subtasks.length;
  // Load = implied sub-tasks plus every deliverable beyond the first, which is a whole task of its own.
  const load = n + 3 * Math.max(0, deliverables.length - 1);

  const band =
    deliverables.length >= 4
      ? { label: `overloaded · ${deliverables.length} deliverables`, tone: "serious" as const }
      : load <= 4
        ? { label: deliverables.length > 1 ? `${deliverables.length} deliverables` : "simple", tone: deliverables.length > 1 ? ("neutral" as const) : ("good" as const) }
        : load <= 10
          ? { label: "moderate", tone: "neutral" as const }
          : load <= 20
            ? { label: "dense", tone: "warning" as const }
            : { label: "very dense", tone: "serious" as const };

  const byKind = countByKind(subtasks);
  const breakdown = [...byKind.entries()].map(([kind, count]) => `${count} ${SUBTASK_KIND_LABELS[kind]}`).join(", ");
  const head =
    deliverables.length === 0
      ? "No explicit deliverable was found"
      : deliverables.length === 1
        ? `1 deliverable (“${excerpt(deliverables[0]!.clause, 50)}”)`
        : `${deliverables.length} deliverables`;
  const summary =
    n === 0
      ? `${head}; nothing beyond the deliverable itself is spelled out.`
      : `${head} spells out ${n} responsibilit${n === 1 ? "y" : "ies"}: ${breakdown}.${
          deliverables.length > 1
            ? " Several deliverables share one answer; decide whether each needs its own call (independent enforcement, evidence, retries, measurement) or just its own place in the output."
            : ""
        }`;

  const factors: MetricFactor[] = [
    ...deliverables.map<MetricFactor>((t) => ({ label: `deliverable · ${t.verb}`, value: excerpt(t.clause, 70), contribution: 0, chunks: [t.chunk] })),
    ...subtasks.map<MetricFactor>((s) => ({ label: KIND_SHORT[s.kind], value: s.label, contribution: 0, chunks: s.chunks })),
  ];

  return {
    id: "taskCount",
    label: "Implied sub-tasks",
    display: String(n),
    score: Math.min(1, load / 30),
    band,
    summary,
    factors,
    chunks: [...new Set([...tasks.map((t) => t.chunk), ...subtasks.flatMap((s) => s.chunks)])],
    caveat:
      "An inventory for review, produced by this tool's taxonomy (inputs, filters, decisions, transformations, loops, output fields, checks, tools, format). The same demand can appear under two kinds, so it is not a count of distinct operations the model performs.",
  };
}
