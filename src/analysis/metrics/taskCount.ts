import type { LegContext, Metric, MetricFactor } from "../types";
import { excerpt } from "../text";
import type { TaskItem } from "./tasks";
import { SUBTASK_KIND_LABELS, countByKind, type Subtask } from "./subtasks";

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
  const summary = n === 0 ? `${head}; nothing beyond the deliverable itself is implied.` : `${head} decomposes into ${n} implied sub-task${n === 1 ? "" : "s"}: ${breakdown}.${deliverables.length > 1 ? " Several deliverables compete for attention; consider one prompt per deliverable." : ""}`;

  const factors: MetricFactor[] = [
    ...deliverables.map<MetricFactor>((t) => ({ label: `deliverable · ${t.verb}`, value: excerpt(t.clause, 70), contribution: 0, chunks: [t.chunk] })),
    ...subtasks.map<MetricFactor>((s) => ({ label: SUBTASK_KIND_LABELS[s.kind].replace(/s$/, "").replace("inputs to understand", "input").replace("output formatting", "format"), value: s.label, contribution: 0, chunks: s.chunks })),
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
  };
}
