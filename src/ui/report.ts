import type { Analysis } from "../analysis/types";
import type { SelfReport } from "../analysis/llmJudge";
import { SUBTASK_KIND_LABELS, type SubtaskKind } from "../analysis/metrics";
import { PALETTES, rampColor, rgbToCss } from "../scene/palette";
import { escapeHtml } from "./tooltip";

/**
 * The full analysis as a printable document. Rendered into an overlay the
 * user can read on screen and save as PDF through the browser's print dialog,
 * which gives real pagination and selectable text. Always light, so it prints
 * cleanly whatever the app theme.
 */

export interface ReportInput {
  readonly analysis: Analysis;
  readonly selfReport: SelfReport | null;
  /** PNG data URL of the spider, captured on a light surface. */
  readonly spiderImage: string | null;
}

export function buildReportHtml({ analysis, selfReport, spiderImage }: ReportInput): string {
  const ramp = PALETTES.light.focusRamp;
  const date = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const taskMetric = analysis.metrics.find((m) => m.id === "taskCount");
  const otherMetrics = analysis.metrics.filter((m) => m.id !== "taskCount");

  const metricsTiles = analysis.metrics
    .map(
      (m) => `<div class="rp-tile" data-tone="${m.band.tone}">
        <div class="rp-tile-value">${escapeHtml(m.display)}</div>
        <div class="rp-tile-label">${escapeHtml(m.label)}</div>
        <div class="rp-tile-band">${escapeHtml(m.band.label)}</div>
      </div>`,
    )
    .join("");

  const subtaskRows = taskMetric
    ? taskMetric.factors
        .map((f) => `<tr><td class="rp-kind">${escapeHtml(f.label)}</td><td>${escapeHtml(f.value)}</td><td class="rp-chunks">${f.chunks.map((c) => `#${c + 1}`).join(", ")}</td></tr>`)
        .join("")
    : "";

  const factorTables = otherMetrics
    .map(
      (m) => `<section class="rp-block">
        <h3>${escapeHtml(m.label)} <span class="rp-muted">${escapeHtml(m.display)} · ${escapeHtml(m.band.label)}</span></h3>
        <p>${escapeHtml(m.summary)}</p>
        <table class="rp-table">
          <thead><tr><th>Factor</th><th>Value</th><th class="rp-num">Contribution</th><th>Chunks</th></tr></thead>
          <tbody>${m.factors
            .map((f) => `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(f.value)}</td><td class="rp-num">${formatSigned(f.contribution)}</td><td class="rp-chunks">${f.chunks.slice(0, 12).map((c) => `#${c + 1}`).join(", ")}${f.chunks.length > 12 ? "…" : ""}</td></tr>`)
            .join("")}</tbody>
        </table>
        ${m.caveat ? `<p class="rp-muted">${escapeHtml(m.caveat)}</p>` : ""}
      </section>`,
    )
    .join("");

  const legend = analysis.legs
    .map(
      (l) => `<tr><td><span class="rp-dot" data-polarity="${l.polarity}"></span>${escapeHtml(l.label)}${l.polarity === "dilute" ? " ↓" : ""}</td><td class="rp-num">×${l.weight.toFixed(2)}</td><td>${escapeHtml(l.explainer.what)} ${escapeHtml(l.explainer.why)}<div class="rp-chunks">Scores high: ${escapeHtml(l.explainer.high)} · Scores low: ${escapeHtml(l.explainer.low)}</div></td></tr>`,
    )
    .join("");

  const findings = analysis.insights.length
    ? analysis.insights.map((i) => `<div class="rp-finding" data-severity="${i.severity}"><div class="rp-finding-title">${escapeHtml(i.title)}</div><div>${escapeHtml(i.detail)}</div>${i.chunks.length ? `<div class="rp-chunks">chunks ${i.chunks.map((c) => `#${c + 1}`).join(", ")}</div>` : ""}</div>`).join("")
    : `<p class="rp-muted">No findings.</p>`;

  const reasoning = selfReport
    ? `<section class="rp-block">
        <h2>Model reasoning <span class="rp-muted">${escapeHtml(selfReport.model)} · ${(selfReport.durationMs / 1000).toFixed(1)} s · ${selfReport.usage.inputTokens.toLocaleString()} in / ${selfReport.usage.outputTokens.toLocaleString()} out tokens</span></h2>
        <p class="rp-pre">${escapeHtml(selfReport.reasoning)}</p>
        ${selfReport.conflicts.length ? `<h3>Conflicts the model noticed</h3><ul>${selfReport.conflicts.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
      </section>`
    : "";

  let cursor = 0;
  let annotated = "";
  for (const chunk of analysis.chunks) {
    if (chunk.start > cursor) annotated += `<span class="rp-gap">${escapeHtml(analysis.prompt.slice(cursor, chunk.start))}</span>`;
    const focus = analysis.focus[chunk.index]!;
    annotated += `<span class="rp-chunk" style="background:${rgbToCss(rampColor(ramp, focus), 0.08 + 0.55 * focus * focus)}"><sup>${chunk.index + 1}</sup>${escapeHtml(chunk.text)}</span>`;
    cursor = chunk.end;
  }
  if (cursor < analysis.prompt.length) annotated += `<span class="rp-gap">${escapeHtml(analysis.prompt.slice(cursor))}</span>`;

  const chunkRows = analysis.chunks
    .map((c) => {
      const top = [...analysis.legs]
        .map((leg) => ({ leg, value: leg.scores[c.index]! }))
        .filter((x) => x.value >= 0.3)
        .sort((a, b) => b.value * b.leg.weight - a.value * a.leg.weight)
        .slice(0, 3)
        .map((x) => `${x.leg.label} ${x.value.toFixed(2)}`)
        .join(" · ");
      const reason = selfReport?.reasons[c.index];
      return `<tr><td class="rp-num">${c.index + 1}</td><td>${escapeHtml(c.kind)}${c.section ? ` &lt;${escapeHtml(c.section)}&gt;` : ""}</td><td class="rp-num"><span class="rp-bar" style="--w:${Math.round(analysis.focus[c.index]! * 100)}%"></span>${analysis.focus[c.index]!.toFixed(2)}</td><td>${escapeHtml(top || "–")}</td>${selfReport ? `<td>${escapeHtml(reason ?? "")}</td>` : ""}</tr>`;
    })
    .join("");

  return `
    <article class="rp">
      <header class="rp-header">
        <div>
          <h1>Prompt Spider report</h1>
          <p class="rp-muted">${escapeHtml(analysis.profile.label)} · ${analysis.chunks.length} chunks · ${analysis.legs.length} legs · ${escapeHtml(date)}</p>
        </div>
      </header>

      <section class="rp-block">
        <h2>Measurements</h2>
        <div class="rp-tiles">${metricsTiles}</div>
        ${taskMetric ? `<p>${escapeHtml(taskMetric.summary)}</p>` : ""}
      </section>

      ${spiderImage ? `<section class="rp-block rp-figure"><img src="${spiderImage}" alt="Spider of the prompt analysis" /><p class="rp-muted">Body = model · one leg per analysis · one ring per chunk in reading order outwards · a leg bends up where the chunk scores high · ↓ legs dilute the task.</p></section>` : ""}

      <section class="rp-block">
        <h2>Findings</h2>
        ${findings}
      </section>

      ${reasoning}

      <section class="rp-block">
        <h2>Prompt, shaded by focus</h2>
        <div class="rp-annotated">${annotated}</div>
      </section>

      ${taskMetric ? `<section class="rp-block rp-break"><h2>Implied sub-tasks <span class="rp-muted">${escapeHtml(taskMetric.display)} · ${escapeHtml(taskMetric.band.label)}</span></h2><table class="rp-table"><thead><tr><th>Kind</th><th>Sub-task</th><th>Chunks</th></tr></thead><tbody>${subtaskRows}</tbody></table></section>` : ""}

      ${factorTables}

      <section class="rp-block rp-break">
        <h2>Chunks</h2>
        <table class="rp-table">
          <thead><tr><th class="rp-num">#</th><th>Kind</th><th class="rp-num">Focus</th><th>Strongest legs</th>${selfReport ? "<th>Model's reason</th>" : ""}</tr></thead>
          <tbody>${chunkRows}</tbody>
        </table>
      </section>

      <section class="rp-block">
        <h2>Legs</h2>
        <table class="rp-table"><tbody>${legend}</tbody></table>
        <p class="rp-muted">Leg weights are the model profile's priors. ${escapeHtml(analysis.profile.notes.join(" "))}</p>
      </section>
    </article>`;
}

function formatSigned(value: number): string {
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}`;
}

export const SUBTASK_KINDS: readonly SubtaskKind[] = Object.keys(SUBTASK_KIND_LABELS) as SubtaskKind[];
