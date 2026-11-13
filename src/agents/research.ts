import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { LLMProvider, LLMUsage } from "../schema/providers.js";

const SYSTEM_PROMPT_PATH = path.join(process.cwd(), "prompts", "researcher.md");

const ResearchResult = z.object({
  summary: z.string(),
  key_facts: z.array(z.string()),
  mood: z.string(),
  sources: z.array(z.string()),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

export interface ResearchOutput {
  data: ResearchResult;
  usage: LLMUsage;
}

/**
 * Research a topic.
 *
 * `direction` is a fact that was already verified upstream. It is not the
 * whole brief: the stage still searches, so the script can be grounded in
 * more than the one fact the caller handed over, and the caller keeps the
 * benefit of a checked fact.
 */
export async function research(
  llm: LLMProvider,
  topic: string,
  direction?: string,
): Promise<ResearchOutput> {
  let systemPrompt =
    "You are a research assistant. Given a topic, search the web for current information and produce a structured research summary with key facts, mood/tone, and sources.";

  try {
    systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  } catch {
    // Use default prompt if file doesn't exist
  }

  const brief = direction?.trim()
    ? `Research this topic for a short-form video script: ${topic}\n\n` +
      `A fact that has already been verified for this video - include it and keep its source:\n${direction.trim()}`
    : `Research this topic for a short-form video script: ${topic}`;

  const result = await llm.generate({
    systemPrompt,
    userMessage: brief,
    schema: ResearchResult,
    enableWebSearch: true,
  });
  return { data: result.data, usage: result.usage };
}
