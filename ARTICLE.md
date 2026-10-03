# Count the cognitive tasks

Marco Somma · October 2026

## The demo era is over

For two years the most impressive thing you could show was one prompt doing everything in a single run. Paste a document, add a page of rules, get a finished answer. It worked often enough to raise money, win pilots and convince a lot of us that the hard part was behind us.

It is not. The same prompt that carries a demo is now what sits at the heart of production systems, and it is where those systems quietly break. Not loudly, with an error, but with a routing decision nobody can explain, a field filled with something plausible, a rule that was honoured on Monday and ignored on Thursday.

So the question I now ask of every prompt is not “does the model handle it?” but “how many things am I asking at once, and which of them should never have been left to probability?”

## A prompt is a compression of cognitive tasks

Every non-trivial prompt is a bundle. It asks the model to understand some material, discard part of it, take a few decisions, transform what is left, repeat that for every item, fill a set of output fields, check its own work and honour a format. We write all of that as prose, in one breath, and call it “the task”.

Counting those cognitive tasks is the single most useful thing I have found to do with a prompt before shipping it. A tool can only count the responsibilities the text spells out, and the count depends on the taxonomy it uses; that is fine, because the goal is an inventory for review, not a measurement of what happens inside the model. Not because a frontier model struggles with thirty steps in one prompt. Often it does not. I count them because the count makes the fragility of the prompt evident.

Each compressed step is a place where something can go wrong without anyone noticing: data accepted without validation, a decision encoded in an adjective, a rule the model may or may not apply to the twelfth item, a field it is forced to fill even when it has nothing to put there. In a demo these are invisible. At scale they are the system.

## One deliverable, thirty-two responsibilities

To make this concrete I built a small open-source pet project, [Prompt Spider](https://marcosomma.github.io/prompt-spider/). It splits a prompt into chunks, scores each chunk on eleven dimensions (how directive it is, how constrained, how hedged, where it sits, and so on), and then decomposes the prompt into the sub-tasks it implies. Two honest limits: the default analysis is lexical and English-only, built on word lists and patterns rather than on any understanding of meaning, so it is a reading aid, not a judge. If you add your own API key in the interface, a second analysis runs where the model itself rates how much each chunk would change what it does and explains its reasoning; that is the part that reflects an actual model rather than rules of thumb. The page ships with three sample prompts; the one that matters here is the “complex task”.

It is an ordinary production prompt: triage one support ticket and write the first reply. One deliverable. It reads cleanly, it is well structured, and a good model answers it well. The decomposition finds 32 responsibilities behind that single sentence. The figure is the tool's inventory, not a count of distinct operations the model performs: it depends on the taxonomy below, and the same demand can appear twice (classifying the ticket is a transformation and also an output field).

| Kind | Count | What the prompt actually asks |
| --- | --- | --- |
| Inputs to understand | 3 | the ticket, the plan table, the documentation behind a tool |
| Filters | 3 | “only if…”, “never promise… unless…”, “use integrations only if…” |
| Decisions | 5 | if INCIDENT then…, severity 1 only if…, if the plan lacks the feature… |
| Transformations | 5 | classify, set severity, route, answer, list the follow-ups |
| Per-item loops | 4 | every reply needs…, for BUG tickets also… |
| Output fields | 8 | classification, severity, queue, summary, reply, follow_ups, diagnostics, docs_cited |
| Verification requests | 2 | confirm against the docs, never invent a workaround |
| Tool calls | 1 | search_docs, but only when available |
| Output formatting | 1 | a single JSON object, every field required |

Nothing in that list is exotic. It is what we all write. The point is that we write it as one instruction and then measure it as one outcome: did the reply look right? Thirty-two responsibilities were discharged in between, and we observed none of them.

## Where it breaks, kind by kind

The value of the decomposition is not the number. It is that each kind of sub-task is a different kind of fragility, and each one has a known fix.

**Inputs** are where unvalidated data enters. The ticket text and the plan table go straight into the model's context. Nothing checks that the plan name exists, that the ticket is not empty, that it does not contain instructions aimed at the model. In a demo the input is the one you typed. In production it is whatever arrives.

**Filters and decisions** are business rules written in prose. “Severity 1 only if revenue-impacting and on the Team or Enterprise plan” is an if-statement. Encoded in a sentence, it is re-decided on every run. You can write cases that check its observable behaviour, but nothing enforces it independently of the model. Encoded in code, it is enforced the same way every time. The boundary matters: code can apply the severity policy consistently and still receive a wrong judgement about whether the ticket is revenue-impacting. Enforce the policy in code; test the judgement with cases.

**Transformations** are the part the model is genuinely for: judgement, classification, writing. These deserve the model. The trouble is that in a single-run prompt they share the context, and the attention, with everything else on this list.

**Loops** are silent batch processing. “Every reply needs a summary” holds for one reply in a demo. Across a thousand tickets you have no way to know how many replies got one, because you never looked at the step, only at the end.

**Output fields** are each a small opportunity to fabricate. Requiring a key is harmless: `docs_cited` can be required and empty. The pressure comes from demanding a substantive value without evidence and without a way to say unknown. A model told the field must name an article, with nothing to look at, will name one.

**Verifications and tool calls** are two different things. A logged lookup proves that retrieval happened; it does not prove that what came back supports the answer. And a single run can already emit tool-call events. The distinction that matters is between requesting verification in the prompt and checking evidence of it afterwards.

None of this is a model failure. It is a system that gave probability jobs that deterministic code does better, and then measured only the last line.

## Two other shapes of trouble

The other two samples on the page show that “complex” is not the only way a prompt gets fragile.

The **easy task** is a LinkedIn post with five rules. It decomposes into three sub-tasks. Nothing to split here, and the analysis says so: this is a prompt a single call should own. Not every prompt needs an architecture.

The **overloaded task** is two paragraphs that ask for a blog post, two translations, five tweets, a LinkedIn post, a newsletter intro, a one-line summary, SEO keywords, image prompts and a grammar review. Seven deliverables, each a short sentence, plus a playful-but-formal tone, no emojis except at least two per tweet, and three studies cited with exact figures. The sub-task count is low. The deliverable count is what breaks it: seven outputs competing for one answer, contradictory rules the model will resolve silently, and a request for precise facts with no source to draw them from. The tool's fabrication-pressure score flags it, not as a probability but as a list of pressures we wrote in ourselves: facts demanded with no source to draw from, and no permitted way to say a figure is unknown.

Three prompts, three different diagnoses: leave it alone, split it along its seams, stop asking for seven things at once. You only get the diagnosis by looking at the prompt as a structure rather than as text.

## From one prompt to cognitive units

The decomposition is also the design. The seams between kinds of sub-task are the seams along which a single-run prompt wants to be split into units, each small enough to be governed by something deterministic.

1. **Validate inputs before the model sees them.** Does the plan exist, is the ticket non-empty, is the text within the size you tested? Code, not prose.
2. **Move crisp rules into code.** Severity caps, plan entitlements, routing by named system: these are if-statements with test cases. The model should never be the thing that decides whether a Starter customer is promised a phone call.
3. **Split where splitting buys you something.** Separate calls cost latency and money and give mistakes more places to propagate. Split where you need independent enforcement, evidence, retries or measurement, and let an evaluation decide. Classifying the ticket and drafting the reply often benefit from separation; a summary and a classification can reasonably share a call.
4. **Validate every output against its schema**, and give every field an honest empty state. A required key holding an empty array or an explicit “unknown” is fine; a demanded value with no evidence behind it is where invention starts.
5. **Make loops explicit.** If every reply needs a summary, check every reply for a summary. A loop in code is observable; a loop in prose is a hope.
6. **Check evidence of verification, not the request for it.** Log the lookup, then check that what came back actually supports the answer, and mark the output unverified when it does not.

The result has more parts than the one-prompt version, and that is the point. Each part can be measured, tested, replaced and rolled back on its own. That is what scaling means, and it is what a single run can never give you however good the model gets.

## Prompt analysis as an engineering practice

We lint code, profile it and review it before it ships. Prompts, which now carry business logic, mostly get read once by the person who wrote them. Prompt analysis is the missing step, and it does not need to be sophisticated to be useful.

Before a prompt goes to production, I want three things on the table. How many deliverables it asks for, because each extra one is a question: does it need its own call, or just its own place in the output? How many sub-tasks it implies and of which kinds, because that tells me which parts belong to code, which to the model, and which need a check. And what pushes it towards fabrication: facts requested without sources, pressure to always answer, values demanded with no way to say unknown.

The answers do not tell you the prompt is wrong. They tell you where it is fragile and what to do about each fragile point: validate here, split there, allow an empty answer over there. That is a far better use of a review hour than polishing adjectives.

Start with the prompt you are most proud of. It is usually the one carrying the most.

## The question to keep

The awesome-demo era taught us what models can do when we ask for everything at once. The next era is about knowing what we asked, step by step, and deciding deliberately which steps deserve a model and which deserve a test.

So before the next prompt ships: how many things am I asking at once, where am I accepting data I never checked, and which of these decisions should never have been left to probability?

The tool is at [marcosomma.github.io/prompt-spider](https://marcosomma.github.io/prompt-spider/), open source and free, a pet project rather than a product. Paste your own prompt, open the sub-tasks tile, and count. The default pass is lexical and English-only; add an API key to let the model rate the prompt itself, or clone the repository and run it locally if you would rather keep your prompts and your key on your own machine.
