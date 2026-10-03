import { escapeHtml } from "./tooltip";

/**
 * Run log for one analysis: a list of steps with state, detail and timing,
 * plus a one-line summary kept up to date for the tab strip.
 */

export type StepState = "pending" | "running" | "done" | "skipped" | "error";

export interface StepSpec {
  readonly id: string;
  readonly label: string;
}

export interface RunStatusEvents {
  /** Fired when a run starts, finishes, or hits its first error. */
  onPhase(phase: "running" | "done" | "error"): void;
}

export interface RunStatus {
  reset(steps: readonly StepSpec[]): void;
  set(id: string, state: StepState, detail?: string): void;
  /** Marks the run finished and shows `summary` as the folded line. */
  complete(summary: string): void;
}

interface StepNode {
  readonly element: HTMLLIElement;
  readonly detail: HTMLElement;
  readonly time: HTMLElement;
  startedAt: number | null;
  timer: number | null;
}

export function createRunStatus(summary: HTMLElement, stepsHost: HTMLElement, events: RunStatusEvents): RunStatus {
  const nodes = new Map<string, StepNode>();
  let failed = false;

  const stopTimer = (node: StepNode): void => {
    if (node.timer !== null) {
      window.clearInterval(node.timer);
      node.timer = null;
    }
  };

  return {
    reset(steps) {
      nodes.forEach(stopTimer);
      nodes.clear();
      stepsHost.innerHTML = "";
      failed = false;
      summary.textContent = "Analysing…";
      const list = document.createElement("ol");
      list.className = "run-steps";
      for (const step of steps) {
        const element = document.createElement("li");
        element.className = "run-step";
        element.dataset["state"] = "pending";
        element.innerHTML = `<span class="run-icon" aria-hidden="true"></span><span class="run-label">${escapeHtml(step.label)}</span><span class="run-detail"></span><span class="run-time"></span>`;
        list.append(element);
        nodes.set(step.id, { element, detail: element.querySelector(".run-detail")!, time: element.querySelector(".run-time")!, startedAt: null, timer: null });
      }
      stepsHost.append(list);
      events.onPhase("running");
    },
    set(id, state, detail) {
      const node = nodes.get(id);
      if (!node) return;
      const previous = node.element.dataset["state"];
      node.element.dataset["state"] = state;
      if (detail !== undefined) node.detail.textContent = detail;
      if (state === "running") summary.textContent = `${node.element.querySelector(".run-label")?.textContent ?? ""}${detail ? ` · ${detail}` : "…"}`;
      if (state === "error" && !failed) {
        failed = true;
        events.onPhase("error");
      }

      if (state === "running" && previous !== "running") {
        node.startedAt = performance.now();
        node.time.textContent = "";
        node.timer = window.setInterval(() => {
          node.time.textContent = formatSeconds(performance.now() - (node.startedAt ?? performance.now()));
        }, 250);
      } else if (state !== "running") {
        stopTimer(node);
        node.time.textContent = node.startedAt !== null && (state === "done" || state === "error") ? formatSeconds(performance.now() - node.startedAt) : "";
      }
    },
    complete(text) {
      summary.textContent = text;
      if (!failed) events.onPhase("done");
    },
  };
}

export function formatSeconds(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
