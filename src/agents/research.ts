import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { LLMProvider, LLMUsage } from "../schema/providers.js";
import { type SearchHit, webSearch } from "../providers/search/web.js";

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

/** A search function the caller can replace, for tests. */
export type SearchFn = (query: string, limit?: number) => Promise<SearchHit[]>;

/**
 * The queries worth asking.
 *
 * The topic is one of them. When the caller already has a verified fact, the
 * subject of that fact is another: a script about a car needs what the car
 * did, not what the industry did.
 */
function buildQueries(topic: string, direction?: string): string[] {
  const queries = [topic];
  const subject = direction?.match(/\b([A-Z][\w-]*(?: [A-Z][\w-]*){0,3})\b/)?.[1];
  if (subject && subject.length > 3 && !topic.includes(subject)) {
    queries.push(subject);
  }
  return queries.slice(0, 2);
}

/**
 * Research a topic.
 *
 * The search happens here, in code, and the model turns what came back into
 * a brief. That ordering matters on a headless server: a gateway cannot be
 * trusted to call a tool, but it can be trusted to read a page and summarise
 * it.
 *
 * `direction` is a fact that was already verified upstream. It is not the
 * whole brief: the stage still searches, so the script can be grounded in
 * more than the one fact the caller handed over.
 */
export async function research(
  llm: LLMProvider,
  topic: string,
  direction?: string,
  search: SearchFn = webSearch,
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

  const hits: SearchHit[] = [];
  for (const query of buildQueries(topic, direction)) {
    try {
      hits.push(...(await search(query, 5)));
    } catch (error) {
      console.warn(`[research] Search failed for "${query}": ${String(error)}`);
    }
  }

  // With nothing to read, the model answers from its own knowledge and says
  // which sources it is confident about.
  if (hits.length === 0) {
    const result = await llm.generate({
      systemPrompt:
        systemPrompt +
        "\n\nYou do not have access to web search. Use your training knowledge to provide the best possible research, and say which sources you are confident about.",
      userMessage: brief,
      schema: ResearchResult,
    });
    return { data: result.data, usage: result.usage };
  }

  const sources = hits.map((hit) => ({
    title: hit.title,
    url: hit.url,
    content: hit.content,
  }));

  const result = await llm.generate({
    systemPrompt,
    userMessage:
      `${brief}\n\nHere is what the search returned. Use it, keep the facts it states, and list the sources you used by URL:\n\n` +
      sources
        .map(
          (source) =>
            `### ${source.title}\n${source.url}\n${source.content}\n`,
        )
        .join("\n"),
    schema: ResearchResult,
  });

  // The model may drop the URLs. The search knows them, so they are put back.
  const urls = sources.map((source) => source.url).filter(Boolean);
  const listed = result.data.sources ?? [];
  const merged = [...listed];
  for (const url of urls) {
    if (!merged.includes(url)) merged.push(url);
  }

  return {
    data: { ...result.data, sources: merged.slice(0, 8) },
    usage: result.usage,
  };
}
