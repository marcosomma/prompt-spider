import type { Analysis, Insight, LegResult, Metric, ModelProfile } from "../analysis/types";
import type { SelfReport } from "../analysis/llmJudge";
import { MODEL_PROFILES } from "../analysis/models";
import { PALETTES, rampColor, rgbToCss, type Theme } from "../scene/palette";
import { escapeHtml } from "./tooltip";

/** DOM rendering for everything outside the 3D scene. Pure functions of the analysis. */

export function renderModelOptions(select: HTMLSelectElement, selected: string): void {
  select.innerHTML = "";
  const groups = new Map<string, ModelProfile[]>();
  for (const profile of MODEL_PROFILES) {
    const list = groups.get(profile.vendor) ?? [];
    list.push(profile);
    groups.set(profile.vendor, list);
  }
  for (const [vendor, profiles] of groups) {
    const group = document.createElement("optgroup");
    group.label = vendor;
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      option.title = profile.notes.join("\n");
      option.selected = profile.id === selected;
      group.append(option);
    }
    select.append(group);
  }
}

export interface ChunkHoverHandlers {
  onEnter(chunk: number, event: MouseEvent): void;
  onLeave(): void;
}

/**
 * Renders the prompt itself with every chunk wrapped in a span shaded by its
 * composite focus. Text between chunks (tags, blank lines) is kept, muted, so
 * the prompt reads exactly as written.
 */
export function renderAnnotatedPrompt(container: HTMLElement, analysis: Analysis, theme: Theme, handlers: ChunkHoverHandlers): void {
  container.innerHTML = "";
  const ramp = PALETTES[theme].focusRamp;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const chunk of analysis.chunks) {
    if (chunk.start > cursor) fragment.append(gapText(analysis.prompt.slice(cursor, chunk.start)));
    const focus = analysis.focus[chunk.index]!;
    const span = document.createElement("span");
    span.className = "chunk-span";
    span.dataset["chunk"] = String(chunk.index);
    // Low-focus chunks stay almost unshaded so the eye goes to what the model will act on.
    span.style.setProperty("--heat", rgbToCss(rampColor(ramp, focus), 0.04 + 0.62 * focus * focus));
    span.innerHTML = `<span class="chunk-no" aria-hidden="true">${chunk.index + 1}</span>${escapeHtml(chunk.text)}`;
    span.addEventListener("mouseenter", (event) => handlers.onEnter(chunk.index, event));
    span.addEventListener("mouseleave", handlers.onLeave);
    fragment.append(span);
    cursor = chunk.end;
  }
  if (cursor < analysis.prompt.length) fragment.append(gapText(analysis.prompt.slice(cursor)));
  container.append(fragment);
}

function gapText(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "gap-text";
  span.textContent = text;
  return span;
}

export function setActiveChunks(container: HTMLElement, chunks: readonly number[], scroll: boolean): void {
  const selected = new Set(chunks.map(String));
  let scrolled = false;
  for (const span of container.querySelectorAll<HTMLElement>(".chunk-span")) {
    const active = selected.has(span.dataset["chunk"] ?? "");
    span.dataset["active"] = String(active);
    if (active && scroll && !scrolled) {
      span.scrollIntoView({ block: "nearest", behavior: "smooth" });
      scrolled = true;
    }
  }
}

/** Tooltip body for a chunk: focus, its three strongest legs as bars, and the model's reason if any. */
export function chunkTooltipHtml(analysis: Analysis, chunk: number, reason?: string): string {
  const focus = analysis.focus[chunk]!;
  const top = [...analysis.legs]
    .map((leg) => ({ leg, value: leg.scores[chunk]! }))
    .filter((x) => x.value >= 0.15)
    .sort((a, b) => b.value * b.leg.weight - a.value * a.leg.weight)
    .slice(0, 4);
  const bars = top.length
    ? `<div class="tip-bars">${top.map((x) => `<span>${escapeHtml(x.leg.label)}</span><i data-polarity="${x.leg.polarity}" style="--w:${Math.round(x.value * 100)}%"></i><b>${x.value.toFixed(2)}</b>`).join("")}</div>`
    : `<div class="tip-text muted">No leg scores this chunk above noise.</div>`;
  const kind = analysis.chunks[chunk]!;
  return (
    `<div class="tip-head"><span>Chunk ${chunk + 1} <span class="muted">· ${kind.kind}${kind.section ? ` in &lt;${escapeHtml(kind.section)}&gt;` : ""}</span></span><span>focus ${focus.toFixed(2)}</span></div>` +
    bars +
    (reason ? `<div class="tip-reason">${escapeHtml(reason)}</div>` : "")
  );
}

/** Tooltip body for a spider node: one leg's view of one chunk. */
export function nodeTooltipHtml(analysis: Analysis, leg: number, chunk: number, reason?: string): string {
  const result = analysis.legs[leg]!;
  const text = analysis.chunks[chunk]!.text;
  return (
    `<div class="tip-head"><span>${escapeHtml(result.label)}</span><span>${result.scores[chunk]!.toFixed(2)}</span></div>` +
    `<div class="tip-text">${escapeHtml(text.length > 200 ? `${text.slice(0, 199)}…` : text)}</div>` +
    `<div class="muted" style="margin-top:4px">chunk ${chunk + 1} · focus ${analysis.focus[chunk]!.toFixed(2)} · ${escapeHtml(result.description)}</div>` +
    (reason ? `<div class="tip-reason">${escapeHtml(reason)}</div>` : "")
  );
}

export interface LegendHandlers {
  onToggle(leg: number): void;
  onEnter(leg: number, event: MouseEvent): void;
  onLeave(): void;
}

export function renderLegend(container: HTMLElement, analysis: Analysis, solo: number | null, handlers: LegendHandlers): void {
  container.innerHTML = "";
  analysis.legs.forEach((leg, k) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(solo === k));
    button.innerHTML = `<span class="swatch" data-polarity="${leg.polarity}"></span>${escapeHtml(leg.label)}${leg.polarity === "dilute" ? " ↓" : ""} <span class="weight">×${leg.weight.toFixed(2)}</span>`;
    button.addEventListener("click", () => handlers.onToggle(k));
    button.addEventListener("mouseenter", (event) => handlers.onEnter(k, event));
    button.addEventListener("mouseleave", handlers.onLeave);
    container.append(button);
  });
}

/** Tooltip body explaining a leg in plain language, with its weight for the selected model. */
export function legTooltipHtml(leg: LegResult, modelLabel: string): string {
  const { explainer } = leg;
  const effect = leg.polarity === "focus" ? "Raises the focus score" : "Lowers the focus score";
  return (
    `<div class="tip-head"><span>${escapeHtml(leg.label)}</span><span class="muted">${effect} · ×${leg.weight.toFixed(2)} for ${escapeHtml(modelLabel)}</span></div>` +
    `<div class="tip-section"><b>What it looks at</b><div>${escapeHtml(explainer.what)}</div></div>` +
    `<div class="tip-section"><b>Why it matters</b><div>${escapeHtml(explainer.why)}</div></div>` +
    `<div class="tip-examples"><div><b>Scores high</b><div>${escapeHtml(explainer.high)}</div></div><div><b>Scores low</b><div>${escapeHtml(explainer.low)}</div></div></div>` +
    `<div class="tip-foot">Click the pill to show only this leg on the spider.</div>`
  );
}

export function renderInsights(container: HTMLElement, insights: readonly Insight[], onHover: (chunks: readonly number[] | null) => void): void {
  container.innerHTML = "";
  for (const insight of insights) {
    const card = document.createElement("div");
    card.className = "insight";
    card.dataset["severity"] = insight.severity;
    card.innerHTML = `<div class="insight-title">${escapeHtml(insight.title)}</div><div class="insight-detail">${escapeHtml(insight.detail)}</div>`;
    card.addEventListener("mouseenter", () => onHover(insight.chunks));
    card.addEventListener("mouseleave", () => onHover(null));
    container.append(card);
  }
}

/** The model's own account of the prompt, shown only when a self-report exists. */
export function renderReasoning(container: HTMLElement, report: SelfReport | null): void {
  if (!report) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  const conflicts = report.conflicts.length
    ? `<h3>Conflicts the model noticed</h3><ul>${report.conflicts.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
    : `<p class="muted">No conflicting instructions reported.</p>`;
  const thinking = report.thinkingSummary ? `<details class="thinking"><summary>Thinking summary</summary><p>${escapeHtml(report.thinkingSummary)}</p></details>` : "";
  container.innerHTML = `<div class="reasoning">
    <p class="reasoning-meta">${escapeHtml(report.model)} · ${(report.durationMs / 1000).toFixed(1)} s · ${report.usage.inputTokens.toLocaleString()} in / ${report.usage.outputTokens.toLocaleString()} out tokens · per-chunk reasons are in the chunk tooltips</p>
    <p class="reasoning-text">${escapeHtml(report.reasoning)}</p>
    ${conflicts}
    ${thinking}
  </div>`;
}

/** Prompt-level measurements as stat tiles; expanding a tile lists the factors behind it. */
export function renderMetrics(container: HTMLElement, metrics: readonly Metric[], onHover: (chunks: readonly number[] | null) => void): void {
  container.innerHTML = "";
  for (const metric of metrics) {
    const tile = document.createElement("details");
    tile.className = "metric";
    tile.dataset["tone"] = metric.band.tone;
    const showContribution = metric.id !== "taskCount";
    const factors = metric.factors
      .map(
        (f) =>
          `<li class="metric-factor" data-chunks="${f.chunks.join(",")}">
            <span class="metric-factor-label">${escapeHtml(f.label)}</span>
            <span class="metric-factor-value" title="${escapeHtml(f.value)}">${escapeHtml(f.value)}</span>
            ${showContribution ? `<span class="metric-factor-weight" data-sign="${f.contribution < -0.005 ? "neg" : "pos"}">${formatContribution(f.contribution)}</span>` : ""}
          </li>`,
      )
      .join("");
    tile.innerHTML = `
      <summary class="metric-face">
        <span class="metric-value">${escapeHtml(metric.display)}</span>
        <span class="metric-label">${escapeHtml(metric.label)}</span>
        <span class="metric-band"><span class="metric-dot" aria-hidden="true"></span>${escapeHtml(metric.band.label)}</span>
      </summary>
      <div class="metric-body">
        <p class="metric-summary">${escapeHtml(metric.summary)}</p>
        <ul class="metric-factors">${factors}</ul>
        ${metric.caveat ? `<p class="hint">${escapeHtml(metric.caveat)}</p>` : ""}
      </div>`;
    const face = tile.querySelector(".metric-face")!;
    face.addEventListener("mouseenter", () => onHover(metric.chunks));
    face.addEventListener("mouseleave", () => onHover(null));
    for (const row of tile.querySelectorAll<HTMLElement>(".metric-factor")) {
      const chunks = (row.dataset["chunks"] ?? "").split(",").filter(Boolean).map(Number);
      row.addEventListener("mouseenter", () => onHover(chunks));
      row.addEventListener("mouseleave", () => onHover(null));
    }
    container.append(tile);
  }
}

function formatContribution(value: number): string {
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}`;
}
