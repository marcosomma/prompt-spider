/**
 * Sample prompts, one per task-load band, so the three measurements can be
 * compared at a glance. Also the fixtures the tests use.
 */

export type SampleId = "easy" | "complex" | "overloaded";

export interface SamplePrompt {
  readonly id: SampleId;
  readonly label: string;
  readonly description: string;
  readonly text: string;
}

const EASY = `You are a senior social media copywriter for a B2B SaaS brand.

<context>
Our company, Northwind Labs, sells a time-tracking app to small design studios.
We launched the product in 2024 and currently have 40 customers. For context, our tone has
historically been quite formal, which we are trying to change.
</context>

## Task
Write a LinkedIn post announcing our new "Focus Mode" feature.

Rules:
- Keep it under 120 words.
- Never mention competitors by name.
- Start with a question.
- Use at most 3 hashtags.
- IMPORTANT: do not use the word "revolutionary".

Maybe add an emoji or two if you think it fits, it's up to you.
Return only the post text, no preamble.`;

const COMPLEX = `You are a senior support engineer triaging incoming tickets for a B2B analytics product and drafting the first reply.

Your job: for the ticket below, decide how it should be handled and write the first response. Precision over speed: a correct routing beats a fast one.

<ticket>
Subject: Dashboard exports stopped working after the update
Hi, since yesterday every CSV export from the Revenue dashboard downloads as an empty file. Three people on my team see the same thing. We are on the Team plan and have a board meeting on Thursday. Also, is there any way to schedule exports? Thanks, Dana
</ticket>

<plans>
- Starter: email support, 48h response target, no SLA credits.
- Team: chat and email, 8h response target, SLA credits for outages over 4h.
- Enterprise: dedicated manager, 1h response target, phone escalation allowed.
</plans>

Rules:
- CLASSIFY the ticket as exactly one of:
    • BUG — the product behaves differently from its documentation.
    • QUESTION — the customer is unsure how to do something that works.
    • REQUEST — the customer asks for something the product does not do.
    • INCIDENT — several customers or a whole workspace are affected right now.
  When the ticket is an INCIDENT, do NOT troubleshoot in the reply; acknowledge it, give the status page link and the time of the next update.
- SET severity 1–4 from impact and the customer's plan. Severity 1 only if revenue-impacting and on the Team or Enterprise plan; otherwise cap it at 2.
- RESPECT PLAN ENTITLEMENTS: never promise a phone call to a Starter customer, never promise SLA credits unless the plan includes them, and if the ticket asks for a feature the plan does not include, point to the upgrade path instead of saying no.
- ROUTE to exactly one queue: billing, platform, integrations, or success. Use integrations only if a third-party system is named.
- ONE issue per ticket. If the customer bundles several issues, answer the most severe one and list the others as follow-ups, one line each.
- TONE: warm, plain English, no jargon, no apology longer than one sentence. Never say "unfortunately", never blame the customer, never promise a date you were not given.
- EVERY reply needs a one-line summary of what you understood, what happens next, and who owns it. For BUG tickets also ask for exactly the diagnostics you still need (at most 3 items) and nothing the customer already gave you.
- GROUND IN THE DOCS (only if tools are available): when a \`search_docs\` tool is provided, use it to confirm the documented behaviour before classifying as BUG, and quote the title of the article you relied on. If no tools are available, classify from the ticket alone and do not mention tools.
- Never invent a workaround you have not seen in the docs; if unsure, say what you will check and when.

Output: a SINGLE JSON object, no prose, of shape:
{ "classification": "BUG" | "QUESTION" | "REQUEST" | "INCIDENT", "severity": 1 | 2 | 3 | 4, "queue": "billing" | "platform" | "integrations" | "success", "summary": "<one line>", "reply": "<the customer-facing text>", "follow_ups": ["<one line each>", ...], "diagnostics_requested": ["<item>", ...], "docs_cited": ["<article title>", ...] }
"follow_ups" and "diagnostics_requested" may be empty arrays. Every field is required.`;

const OVERLOADED = `Write a 1,200-word blog post announcing our new mobile app, then translate it into Italian and Spanish, and also draft 5 tweets, a LinkedIn post and a 300-word newsletter intro based on it. Summarize the whole thing in one sentence for the homepage banner, propose 10 SEO keywords, generate three image prompts for the hero visual, and finally review the blog post for grammar.

Keep everything under 2,000 words in total. Use a playful tone but stay formal enough for enterprise buyers. Do not use emojis, except in the tweets where you should use at least two each. Mention our competitors by name so readers can compare, but never say anything negative about them. Cite three independent studies on mobile productivity with their exact figures. Make sure it all feels personal and handwritten, and return everything as a single JSON object.`;

export const SAMPLE_PROMPTS: readonly SamplePrompt[] = [
  { id: "easy", label: "Easy task", description: "One deliverable, a few rules: a LinkedIn post.", text: EASY },
  { id: "complex", label: "Complex task", description: "One deliverable that hides dozens of sub-tasks: support ticket triage with a JSON contract.", text: COMPLEX },
  { id: "overloaded", label: "Overloaded task", description: "Seven deliverables and contradictory rules in two paragraphs.", text: OVERLOADED },
];

export function getSample(id: SampleId): SamplePrompt {
  const sample = SAMPLE_PROMPTS.find((s) => s.id === id);
  if (!sample) throw new Error(`Unknown sample: ${id}`);
  return sample;
}

/** Default prompt shown on first load. */
export const SAMPLE_PROMPT = EASY;
