import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoAnalysis } from "./types.js";

/**
 * AI-written narrative context via the Claude API (official SDK).
 * Opt-in: only runs with `ctx generate --ai` and an ANTHROPIC_API_KEY.
 * The structural generators stay deterministic; Claude adds the prose a
 * static analyzer cannot — what the project is *for* and how to think
 * about its architecture.
 */

export interface AiOptions {
  /** Override for tests / proxies. */
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

const SYSTEM_PROMPT = `You write concise, accurate project context for AI coding agents.
Given a structured repository analysis and its README, produce a short narrative in Markdown:
1. One paragraph: what the project is and who it is for.
2. One paragraph: how the architecture fits together (modules, data flow).
3. Three to five bullet points: what an agent should know before changing code.
No headings, no preamble, no code fences around the whole answer. Ground every claim in the provided data — do not invent features.`;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Ask Claude for a narrative overview of the analyzed repo. */
export async function generateNarrative(a: RepoAnalysis, opts: AiOptions = {}): Promise<string> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
  });

  const readmePath = join(a.root, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8").slice(0, 8000) : "(no README)";
  const { root: _root, ...analysis } = a; // the absolute path adds nothing for the model

  const response = await client.messages.create({
    model: opts.model ?? "claude-opus-4-8",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Repository analysis (JSON):\n${JSON.stringify(analysis, null, 2)}\n\nREADME.md:\n${readme}`,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) throw new Error(`Claude returned no text (stop_reason: ${response.stop_reason})`);
  return text;
}
