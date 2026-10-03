import type { LegDefinition } from "../types";
import { clamp01, countPhrases, countWords, saturate } from "../text";

const ROLE_PHRASES = ["you are", "you're a", "you're an", "act as", "acting as", "as a", "as an", "your role", "your job", "your task", "your goal", "pretend to be", "imagine you", "take the role", "play the role", "in the role of", "behave like", "behave as", "the user is", "the reader is", "the audience is", "target audience", "written for", "aimed at", "speak as", "from the perspective"];
const ROLE_WORDS = new Set(["persona", "expert", "specialist", "assistant", "agent", "copilot", "coach", "mentor", "tutor", "teacher", "editor", "copywriter", "marketer", "engineer", "developer", "designer", "analyst", "lawyer", "doctor", "nurse", "scientist", "researcher", "journalist", "writer", "poet", "chef", "consultant", "manager", "founder", "ceo", "recruiter", "audience", "reader", "readers", "customer", "customers", "beginner", "beginners", "senior", "junior", "professional", "professionals"]);

/** Persona and audience framing, which sets the register for everything else. */
export const roleFrame: LegDefinition = {
  id: "roleFrame",
  label: "Role & audience",
  polarity: "focus",
  description: "Persona and audience framing: you are a…, act as…, written for…, the reader is….",
  explainer: {
    what: "Whether this piece gives the model a role or an audience: “you are a…”, “act as…”, “written for…”.",
    why: "A role sets the voice and the level of detail for the whole answer. A clear audience changes what the model treats as relevant.",
    high: "“You are a senior social media copywriter.”",
    low: "“Here is some background about us.”",
  },
  score({ chunks, tokens }) {
    return chunks.map((chunk, i) => {
      const toks = tokens[i] ?? [];
      if (chunk.kind === "code") return 0;
      const hits = countPhrases(toks, ROLE_PHRASES) * 1.5 + countWords(toks, ROLE_WORDS) * 0.7;
      return clamp01(saturate(hits));
    });
  },
};
