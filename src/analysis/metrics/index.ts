import type { LegContext, LegResult, Metric } from "../types";
import { detectTasks } from "./tasks";
import { decomposeSubtasks } from "./subtasks";
import { taskCountMetric } from "./taskCount";
import { complexityMetric } from "./complexity";
import { fabricationPressureMetric } from "./fabricationPressure";

/** Prompt-level measurements, computed after the legs so they can reuse leg scores. */
export function computeMetrics(ctx: LegContext, legs: readonly LegResult[]): Metric[] {
  const tasks = detectTasks(ctx);
  const subtasks = decomposeSubtasks(ctx, tasks, legs);
  return [taskCountMetric(ctx, tasks, subtasks), complexityMetric(ctx, tasks, subtasks, legs), fabricationPressureMetric(ctx, tasks, legs)];
}

export { detectTasks } from "./tasks";
export type { TaskItem, TaskGrade } from "./tasks";
export { decomposeSubtasks, SUBTASK_KIND_LABELS, countByKind } from "./subtasks";
export type { Subtask, SubtaskKind } from "./subtasks";
