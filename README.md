# Prompt Spider

Live: https://marcosomma.github.io/prompt-spider/

See how a model weighs your prompt. Paste a prompt, pick a model, and get a 3D spider:
the body is the model, every leg is one analysis, and every ring is one chunk of your text
in reading order. Each leg visits every chunk once and bends upward where that chunk scores
high, so you can see at a glance where the prompt pushes the model to focus and where the
text is just along for the ride.

Built for producing visuals: dark and light themes, a turntable, PNG export in social
frames (16:9, 1:1, 4:5, 9:16) with an optional transparent background, and a full report
you can save as PDF.

## Try it

Three sample prompts sit above the text box, one per task-load band: an **easy task** (one
LinkedIn post with a few rules), a **complex task** (one deliverable that hides about thirty
sub-tasks: support-ticket triage with a JSON contract) and an **overloaded task** (seven
deliverables and contradictory rules in two paragraphs). Loading one analyses it; editing the
text releases the pill.

## Deploy

The repository deploys itself to GitHub Pages on every push to `master` through
`.github/workflows/deploy.yml`: install, test, build with the base path set to
`/<repository name>/` (or `/` for a `<user>.github.io` repository), then publish `dist/`.
In the repository settings, under *Pages*, set the source to **GitHub Actions** once. The
app is static; the optional Claude API call goes from the visitor's browser to
api.anthropic.com with the visitor's own key, so no server or secret is involved.

To build for a sub-path locally: `BASE_PATH=/prompt-spider/ pnpm build`.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5180
pnpm test       # vitest
pnpm build      # type-check + production bundle in dist/
```

## How the analysis works

1. **Chunking** (`src/analysis/chunker.ts`) splits the prompt into headings, bullets, code
   blocks and sentences, keeping exact character offsets. A bullet that holds several
   sentences becomes one chunk per sentence (later ones are marked as continuations), nested
   bullets keep their depth, one-line JSON literals are kept whole as code, and bare XML-style
   tag lines such as `<context>` are not chunks; they label the chunks inside them as a
   *section*.
2. **Legs** (`src/analysis/legs/`) are independent analyses. Each returns one score in
   `[0, 1]` per chunk. Nine raise the task weight of a chunk, two lower it:

   | Leg | Polarity | What it measures |
   | --- | --- | --- |
   | Directive force | focus | imperative verbs, must / never / make sure |
   | Constraint tightness | focus | numbers with units, only / except / no more than |
   | Specificity | focus | names, numbers, quoted strings, identifiers vs vague filler |
   | Emphasis | focus | CAPS, **bold**, exclamation marks, IMPORTANT |
   | Output shaping | focus | format, length, tone, language instructions |
   | Role & audience | focus | "you are a…", "act as…", "written for…" |
   | Structure | focus | headings, bullets, numbered steps, tag sections, Markdown |
   | Position | focus | primacy / recency curve from the model profile |
   | Reinforcement | focus | how often other chunks echo this one |
   | Context load | dilute | background, examples, data: things to know, not to do |
   | Hedging | dilute | maybe, if possible, try to, etc. |

3. **Model profiles** (`src/analysis/models.ts`) weight the legs and set the position curve.
   They are editorial priors about model classes (how much a model sags in the middle of a
   long prompt, how much it responds to shouting, whether XML or Markdown scaffolding is the
   stronger locator), not measurements. Tune them freely.
4. **Composite focus** = weighted sum of focus legs minus weighted sum of diluting legs,
   min–max normalised across the prompt. Insights are derived from the same matrix:
   buried instructions, hedged instructions, context outweighing the task, emphasis
   everywhere, missing output shape.

### Measurements

Three prompt-level gauges sit above the insights, each with a band, a one-line summary and
an expandable list of the factors behind it. Hovering a tile or a factor lights the chunks
that produced it on the spider and in the list.

- **Implied sub-tasks** is the headline: how many responsibilities the prompt spells out
  beyond the deliverable itself. It is an inventory produced by a fixed taxonomy, useful for
  review; the same demand can appear under two kinds (classifying the ticket is a
  transformation and also an output field), so it is not a count of distinct operations the
  model performs.
  The detector first finds *deliverables* (what the prompt fundamentally asks for: "Write a
  post", "surface the gaps"; coordinated clauses count separately, negated and output-shaping
  verbs do not), then extracts the implied sub-tasks by kind: inputs to understand (the
  policy, the requirements, the blocks…), filters ("skip…", "only where…"), decisions
  (if/when/unless), transformations (classify, rank, merge, state…), per-item loops ("each
  gap", "every finding"), output fields (keys of the JSON schema and quoted identifiers),
  verifications, tool calls (backticked names) and the output format. A LinkedIn-post prompt
  yields 3; a compliance gap-analysis specification yields about 44. Bands: simple (≤4),
  moderate (≤10), dense (≤20), very dense. Four or more deliverables band as *overloaded*
  whatever the sub-task count, and raise complexity to at least *high*.
- **Task complexity** is a weighted mix in which the sub-task count carries a quarter of the
  weight, followed by hard constraints, reasoning demands, deliverables, conditional
  branches, output structure, length and domain vocabulary. Bands: low, moderate, high, very
  high.
- **Fabrication pressure** is a heuristic score (0–100, shown with its band) built from
  wording features that push a model to fabricate (unsourced facts requested, specific
  entities without material, pressure to always answer, values demanded with no empty or
  unknown option, long open-ended output, speculation, judgement-heavy analysis) minus the
  features that pull the other way (grounding material provided, an explicit way to abstain, a
  creative task where invention is wanted), scaled by the model profile. It is not a
  calibrated probability and the tile says so: use it to find what to fix, not to predict a
  failure rate.

### Asking the model itself

Open *Ask the model itself*, paste an Anthropic API key and tick the box. The selected
Claude model is asked, through structured output, to rate how strongly each chunk drives
what it would actually do, with a one-line reason per chunk, a whole-prompt reasoning
paragraph, and a list of instructions it sees as conflicting. The ratings are drawn as a
twelfth leg, *Model self-report*, with a higher weight than any heuristic; the reasoning
and conflicts appear in a *Model reasoning* panel and each chunk shows its reason. The
call is streamed, so the run status reports live progress ("rated 12 of 46 chunks…"),
then the model served, token usage and duration. Adaptive thinking is requested with a
summarised display and shown when the model returns one. The key stays in the tab's memory
and is sent only to `api.anthropic.com`, directly from the browser. Generic profiles
(GPT-class, small open-weights) have no API model and skip this step.

### Run status

Every analysis shows four steps with state, detail and timing: chunk the prompt, score the
heuristic legs, ask the model (done, skipped with a reason, or failed with the API error,
in which case the heuristics still render), and compose focus and insights.

## Reading the page

The page is built to fit one screen: the prompt, the findings and an opened measurement
tile scroll inside their own boxes, and the spider takes whatever height is left in the
chosen frame ratio. Below about 980px wide the columns stack and the page scrolls normally.

- **Left:** the prompt. After an analysis it is shown as written, with each chunk shaded by its
  composite focus (unshaded = the model will barely act on it) and numbered to match the rings.
  Hover a chunk for its focus, its strongest legs and, when the model was asked, its own reason.
  *Edit* switches back to the textarea. Below it a tab strip (Run · Model · Findings ·
  Reasoning) shows one panel at a time in a fixed-height area; click the active tab to collapse
  it and give the prompt the full height. The Run tab opens itself while a run is in progress
  or has failed and folds away when done; the strip's right edge keeps a one-line summary.
- **Right:** the three measurements, the spider, and the leg legend.

## Exporting

- **Export PNG** renders the live canvas at the chosen frame's pixel size (for example
  1080×1920 for 9:16) by temporarily raising the render resolution, then downloads it.
  Tick *Transparent* for a PNG with no background.
- **Report / PDF** opens the whole analysis as a document: the three measurements, the spider
  captured on a light surface, findings, the model's reasoning when it was asked, the prompt
  shaded by focus, the sub-task list, the factor tables behind complexity and fabrication
  pressure, a per-chunk table and the leg legend. *Save as PDF / Print* uses the browser's print
  dialog, which gives real pagination and selectable text; choose "Save as PDF" there.

## Reading the spider

- **Body**: the model. **Legs**: analyses, clockwise from the top; legs marked ↓ dilute.
- **Rings**: chunks, numbered 1…N from the body outwards, in reading order.
- **Node height and size**: the chunk's score on that leg. **Colour**: blue ramp for focus
  legs, orange ramp for diluting legs; score is also carried by size so colour is never the
  only channel.
- Hover a node or a chunk in the list to light the chunk's ring on every leg. Click a leg
  name to isolate it.

## Layout

```
src/
  analysis/     pure TypeScript, no DOM: chunker, legs, model profiles, engine, LLM judge
  scene/        Babylon.js: palette, scene/camera/export wrapper, spider builder
  ui/           DOM panels, tooltip, export helpers
  main.ts       wiring
tests/          vitest: chunk offsets, leg invariants, engine behaviour on a sample prompt
```

The analysis layer has no browser dependency and is fully unit-tested; the engine enforces
that every leg returns exactly one in-range score per chunk, so the spider can never have a
leg that misses a chunk.

## License

MIT, see `LICENSE`.
