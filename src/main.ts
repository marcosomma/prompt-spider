import "./styles.css";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { chunkPrompt } from "./analysis/chunker";
import { analyze } from "./analysis/engine";
import { LEGS } from "./analysis/legs";
import { describeApiError, requestSelfReport, selfReportLeg, type SelfReport, type SelfReportProgress } from "./analysis/llmJudge";
import { DEFAULT_MODEL_ID, getModelProfile } from "./analysis/models";
import type { Analysis } from "./analysis/types";
import { SAMPLE_PROMPTS, getSample, type SampleId } from "./samplePrompts";
import type { Theme } from "./scene/palette";
import { SpiderBuilder } from "./scene/spiderBuilder";
import { createSpiderScene } from "./scene/spiderScene";
import { EXPORT_SIZES, downloadDataUrl, exportFilename, fitAspect, isAspect, type Aspect } from "./ui/export";
import { chunkTooltipHtml, legTooltipHtml, nodeTooltipHtml, renderAnnotatedPrompt, renderInsights, renderLegend, renderMetrics, renderModelOptions, renderReasoning, setActiveChunks } from "./ui/panels";
import { buildReportHtml } from "./ui/report";
import { createRunStatus } from "./ui/runStatus";
import { createTabs } from "./ui/tabs";
import { createTooltip } from "./ui/tooltip";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const ui = {
  prompt: byId<HTMLTextAreaElement>("prompt"),
  samples: byId<HTMLElement>("samples"),
  promptView: byId<HTMLElement>("prompt-view"),
  annotated: byId<HTMLElement>("annotated"),
  editToggle: byId<HTMLButtonElement>("edit-toggle"),
  model: byId<HTMLSelectElement>("model"),
  analyze: byId<HTMLButtonElement>("analyze"),
  apiKey: byId<HTMLInputElement>("api-key"),
  useSelfReport: byId<HTMLInputElement>("use-self-report"),
  tabStrip: document.querySelector<HTMLElement>(".tabs")!,
  tabPanels: byId<HTMLElement>("tab-panels"),
  runSummary: byId<HTMLElement>("run-summary"),
  runSteps: byId<HTMLElement>("run-steps"),
  status: byId<HTMLElement>("status"),
  reasoning: byId<HTMLElement>("reasoning"),
  metrics: byId<HTMLElement>("metrics"),
  insights: byId<HTMLElement>("insights"),
  aspect: byId<HTMLSelectElement>("aspect"),
  autoRotate: byId<HTMLInputElement>("auto-rotate"),
  transparent: byId<HTMLInputElement>("transparent"),
  export: byId<HTMLButtonElement>("export"),
  report: byId<HTMLButtonElement>("report"),
  reportOverlay: byId<HTMLElement>("report-overlay"),
  reportBody: byId<HTMLElement>("report-body"),
  reportPrint: byId<HTMLButtonElement>("report-print"),
  reportClose: byId<HTMLButtonElement>("report-close"),
  stageArea: byId<HTMLElement>("stage-area"),
  canvasWrap: byId<HTMLElement>("canvas-wrap"),
  canvas: byId<HTMLCanvasElement>("scene"),
  tooltip: byId<HTMLElement>("tooltip"),
  legend: byId<HTMLElement>("legend"),
  themeToggle: byId<HTMLButtonElement>("theme-toggle"),
};

type PromptMode = "edit" | "view";

interface State {
  theme: Theme;
  mode: PromptMode;
  analysis: Analysis | null;
  spider: SpiderBuilder | null;
  soloLeg: number | null;
  /** Chunks currently lit on the spider and in the text. */
  hoveredChunks: readonly number[];
  /** Last self-report, kept so a theme change does not trigger a new API call. */
  selfReport: SelfReport | null;
}

const state: State = {
  theme: readStoredTheme(),
  mode: "edit",
  analysis: null,
  spider: null,
  soloLeg: null,
  hoveredChunks: [],
  selfReport: null,
};

document.documentElement.dataset["theme"] = state.theme;
ui.themeToggle.textContent = state.theme === "dark" ? "Light" : "Dark";
renderModelOptions(ui.model, DEFAULT_MODEL_ID);

/** Sample pills: loading one replaces the prompt and analyses it; editing the text releases the pill. */
function renderSamples(active: SampleId | null): void {
  ui.samples.innerHTML = "";
  const label = document.createElement("span");
  label.textContent = "Try:";
  ui.samples.append(label);
  for (const sample of SAMPLE_PROMPTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = sample.label;
    button.title = sample.description;
    button.setAttribute("aria-pressed", String(sample.id === active));
    button.addEventListener("click", () => loadSample(sample.id));
    ui.samples.append(button);
  }
}

function loadSample(id: SampleId): void {
  ui.prompt.value = getSample(id).text;
  renderSamples(id);
  void runAnalysis();
}

ui.prompt.value = getSample("easy").text;
renderSamples("easy");
ui.prompt.addEventListener("input", () => renderSamples(null));

const stage = createSpiderScene(ui.canvas, state.theme);
const tooltip = createTooltip(ui.tooltip);
const tabs = createTabs(ui.tabStrip, ui.tabPanels);
// The Run tab opens itself while a run is in progress or failed, and folds away when done.
const run = createRunStatus(ui.runSummary, ui.runSteps, {
  onPhase(phase) {
    tabs.setState("run", phase === "done" ? "idle" : phase);
    if (phase === "running" || phase === "error") tabs.select("run");
    else if (tabs.selected() === "run") tabs.select(null);
  },
});

const RUN_STEPS = [
  { id: "chunk", label: "Chunk prompt" },
  { id: "legs", label: "Score heuristic legs" },
  { id: "model", label: "Ask the model" },
  { id: "compose", label: "Compose focus, measurements & findings" },
] as const;

function setStatus(message: string, tone: "normal" | "error" = "normal"): void {
  ui.status.textContent = message;
  ui.status.dataset["tone"] = tone;
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("prompt-spider:theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable: fall through to the default */
  }
  return "dark";
}

function setMode(mode: PromptMode): void {
  state.mode = mode;
  ui.promptView.dataset["mode"] = mode;
  ui.prompt.hidden = mode === "view";
  ui.annotated.hidden = mode === "edit";
  ui.editToggle.hidden = state.analysis === null;
  ui.editToggle.textContent = mode === "view" ? "Edit" : "Show analysis";
  if (mode === "edit") ui.prompt.focus();
}

/** Draws an analysis everywhere: spider, annotated prompt, measurements, legend, findings. */
function present(analysis: Analysis): void {
  state.analysis = analysis;
  state.soloLeg = null;
  state.hoveredChunks = [];
  state.spider?.dispose();
  state.spider = new SpiderBuilder(stage.scene, analysis, state.theme);
  stage.frame(state.spider.geometry.outerRadius);

  renderAnnotatedPrompt(ui.annotated, analysis, state.theme, {
    onEnter: (chunk, event) => {
      setHoveredChunk(chunk, false);
      tooltip.show(event.clientX, event.clientY, chunkTooltipHtml(analysis, chunk, state.selfReport?.reasons[chunk] || undefined));
    },
    onLeave: () => {
      tooltip.hide();
      setHoveredChunk(null, false);
    },
  });
  renderLegend(ui.legend, analysis, state.soloLeg, legendHandlers);
  renderMetrics(ui.metrics, analysis.metrics, (chunks) => setHoveredChunks(chunks ?? [], false));
  renderReasoning(ui.reasoning, state.selfReport);
  tabs.setVisible("reasoning", state.selfReport !== null);
  renderInsights(ui.insights, analysis.insights, (chunks) => setHoveredChunks(chunks ?? [], chunks !== null && chunks.length > 0));
  const warnings = analysis.insights.filter((i) => i.severity === "warn").length;
  tabs.setBadge("findings", analysis.insights.length ? String(analysis.insights.length) : null, warnings > 0 ? "warn" : undefined);
  setMode("view");
}

function setHoveredChunks(chunks: readonly number[], scroll: boolean): void {
  const same = chunks.length === state.hoveredChunks.length && chunks.every((c, i) => c === state.hoveredChunks[i]);
  if (same && !scroll) return;
  state.hoveredChunks = chunks;
  state.spider?.highlightChunks(chunks);
  setActiveChunks(ui.annotated, chunks, scroll);
}

function setHoveredChunk(chunk: number | null, scroll: boolean): void {
  setHoveredChunks(chunk === null ? [] : [chunk], scroll);
}

const legendHandlers = {
  onToggle(leg: number): void {
    if (!state.analysis) return;
    state.soloLeg = state.soloLeg === leg ? null : leg;
    state.spider?.soloLeg(state.soloLeg);
    renderLegend(ui.legend, state.analysis, state.soloLeg, legendHandlers);
  },
  onEnter(leg: number, event: MouseEvent): void {
    const result = state.analysis?.legs[leg];
    if (!result || !state.analysis) return;
    tooltip.show(event.clientX, event.clientY, legTooltipHtml(result, state.analysis.profile.label));
  },
  onLeave(): void {
    tooltip.hide();
  },
};

function describeProgress(progress: SelfReportProgress): string {
  switch (progress.phase) {
    case "connecting":
      return "connecting…";
    case "thinking":
      return "model is thinking…";
    case "rating":
      return `rated ${progress.rated} of ${progress.total} chunks…`;
    case "finishing":
      return "validating the report…";
  }
}

async function runAnalysis(): Promise<void> {
  const prompt = ui.prompt.value;
  const modelId = ui.model.value;
  const profile = getModelProfile(modelId);
  setStatus("");
  if (prompt.trim() === "") {
    setStatus("Paste a prompt first.", "error");
    return;
  }

  ui.analyze.disabled = true;
  state.selfReport = null;
  run.reset(RUN_STEPS);
  try {
    run.set("chunk", "running");
    const chunkCount = chunkPrompt(prompt).length;
    run.set("chunk", "done", `${chunkCount} chunks`);

    run.set("legs", "running");
    const base = analyze(prompt, modelId);
    run.set("legs", "done", `${LEGS.length} legs × ${chunkCount} chunks, weighted for ${profile.label}`);

    // Show the heuristic result right away; the model's report refines it when it arrives.
    present(base);

    let modelLine = "model not asked";
    if (!ui.useSelfReport.checked) {
      run.set("model", "skipped", "not requested");
    } else if (!profile.claudeApiModel) {
      run.set("model", "skipped", `${profile.label} is a generic profile with no API model`);
    } else if (ui.apiKey.value.trim() === "") {
      run.set("model", "error", "no API key given; showing heuristics only");
    } else {
      run.set("model", "running", `asking ${profile.claudeApiModel}…`);
      try {
        state.selfReport = await requestSelfReport(prompt, base.chunks, profile, ui.apiKey.value.trim(), (progress) =>
          run.set("model", "running", describeProgress(progress)),
        );
        const { model, usage, conflicts } = state.selfReport;
        modelLine = `${model} answered`;
        run.set("model", "done", `${model} · ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out tokens · ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} noted`);
      } catch (error) {
        state.selfReport = null;
        run.set("model", "error", `${describeApiError(error)} Showing heuristics only.`);
      }
    }

    run.set("compose", "running");
    const extraLegs = state.selfReport ? [selfReportLeg(state.selfReport)] : [];
    const final = extraLegs.length > 0 ? analyze(prompt, modelId, { extraLegs }) : base;
    present(final);
    const subtasks = final.metrics.find((m) => m.id === "taskCount")?.display ?? "?";
    run.set("compose", "done", `${final.legs.length} legs · ${final.insights.length} findings · ${subtasks} implied sub-tasks`);
    run.complete(`${chunkCount} chunks · ${final.legs.length} legs · ${subtasks} sub-tasks · ${modelLine}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    run.complete("Analysis failed");
  } finally {
    ui.analyze.disabled = false;
  }
}

/** Rebuilds the scene and panels for a theme without touching the stored preference. */
function renderTheme(theme: Theme): void {
  state.theme = theme;
  document.documentElement.dataset["theme"] = theme;
  ui.themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  stage.setTheme(theme);
  if (state.analysis) {
    const extraLegs = state.selfReport ? [selfReportLeg(state.selfReport)] : [];
    const mode = state.mode;
    present(analyze(state.analysis.prompt, state.analysis.profile.id, { extraLegs }));
    setMode(mode);
  }
}

function applyTheme(theme: Theme): void {
  renderTheme(theme);
  try {
    localStorage.setItem("prompt-spider:theme", theme);
  } catch {
    /* ignore */
  }
}

/** Captures the spider on a light surface for the report, restoring the current theme afterwards. */
async function captureSpiderForReport(): Promise<string | null> {
  if (!state.analysis) return null;
  const previous = state.theme;
  try {
    if (previous !== "light") renderTheme("light");
    return await stage.screenshot(1600, 900, false);
  } catch {
    return null;
  } finally {
    if (previous !== "light") renderTheme(previous);
  }
}

async function openReport(): Promise<void> {
  if (!state.analysis) {
    setStatus("Analyze a prompt before building a report.", "error");
    return;
  }
  ui.report.disabled = true;
  setStatus("Building report…");
  try {
    const spiderImage = await captureSpiderForReport();
    ui.reportBody.innerHTML = buildReportHtml({ analysis: state.analysis, selfReport: state.selfReport, spiderImage });
    ui.reportOverlay.hidden = false;
    ui.reportOverlay.scrollTop = 0;
    setStatus("");
  } catch (error) {
    setStatus(`Report failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    ui.report.disabled = false;
  }
}

async function exportPng(): Promise<void> {
  if (!state.analysis) {
    setStatus("Analyze a prompt before exporting.", "error");
    return;
  }
  const aspect = currentAspect();
  const { width, height } = EXPORT_SIZES[aspect];
  ui.export.disabled = true;
  setStatus(`Rendering ${width}×${height} PNG…`);
  try {
    const dataUrl = await stage.screenshot(width, height, ui.transparent.checked);
    downloadDataUrl(dataUrl, exportFilename(state.analysis.profile.id, aspect));
    setStatus(`Exported ${width}×${height} PNG.`);
  } catch (error) {
    setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    ui.export.disabled = false;
  }
}

// Scene hover: pick nodes, light the chunk in the text and show the leg's view of it.
stage.scene.onPointerObservable.add((info) => {
  if (!state.spider || !state.analysis) return;
  const spider = state.spider;
  const pick = () => spider.refOf(stage.scene.pick(stage.scene.pointerX, stage.scene.pointerY, (mesh) => spider.refOf(mesh) !== null)?.pickedMesh);
  if (info.type === PointerEventTypes.POINTERMOVE) {
    const ref = pick();
    if (!ref) {
      tooltip.hide();
      if (state.hoveredChunks.length > 0) setHoveredChunk(null, false);
      return;
    }
    const reason = state.analysis.legs[ref.leg]?.id === "selfReport" ? state.selfReport?.reasons[ref.chunk] || undefined : undefined;
    tooltip.show(info.event.clientX, info.event.clientY, nodeTooltipHtml(state.analysis, ref.leg, ref.chunk, reason));
    setHoveredChunk(ref.chunk, false);
  } else if (info.type === PointerEventTypes.POINTERTAP) {
    const ref = pick();
    if (ref) setHoveredChunk(ref.chunk, true);
  }
});
ui.canvas.addEventListener("pointerleave", () => {
  tooltip.hide();
  setHoveredChunk(null, false);
});

ui.analyze.addEventListener("click", () => void runAnalysis());

ui.prompt.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runAnalysis();
});
ui.editToggle.addEventListener("click", () => setMode(state.mode === "view" ? "edit" : "view"));
ui.model.addEventListener("change", () => {
  if (state.analysis) void runAnalysis();
});
ui.themeToggle.addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));
ui.autoRotate.addEventListener("change", () => stage.setAutoRotate(ui.autoRotate.checked));
function currentAspect(): Aspect {
  return isAspect(ui.aspect.value) ? ui.aspect.value : "16:9";
}

/** Keeps the canvas as large as the remaining space allows, in the chosen frame ratio. */
function layoutCanvas(): void {
  fitAspect(ui.stageArea, ui.canvasWrap, currentAspect());
  stage.resize();
}
new ResizeObserver(layoutCanvas).observe(ui.stageArea);
ui.aspect.addEventListener("change", () => {
  ui.canvasWrap.dataset["aspect"] = ui.aspect.value;
  layoutCanvas();
});
layoutCanvas();
ui.export.addEventListener("click", () => void exportPng());
ui.report.addEventListener("click", () => void openReport());
ui.reportClose.addEventListener("click", () => (ui.reportOverlay.hidden = true));
ui.reportPrint.addEventListener("click", () => window.print());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.reportOverlay.hidden) ui.reportOverlay.hidden = true;
});

if (import.meta.env.DEV) {
  // Debug handle for the browser console during development only.
  Object.assign(window, { __promptSpider: { stage, state, run, present, analyze } });
}

void runAnalysis();
