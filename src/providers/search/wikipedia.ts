import { tool } from "ai";
import { z } from "zod";

/**
 * Wikipedia search, with no API key.
 *
 * Tavily is the better search tool, but it needs a key and a Tavily key is
 * not something a self-hosted render bay should depend on. Wikipedia's API is
 * open, stable and citable, which makes it a good default for the research
 * stage: the facts come with a source the script can quote, and the video can
 * name it.
 *
 * The tool returns the page extract as plain text plus the canonical URL, so
 * the model can quote a fact and cite the page it came from.
 */
const ENDPOINT = "https://en.wikipedia.org/w/api.php";

export interface WikipediaHit {
  title: string;
  extract: string;
  url: string;
  pageId: number;
}

async function fetchJson(params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${ENDPOINT}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Pitlane/0.4 (vertical video pipeline)" },
  });
  if (!response.ok) {
    throw new Error(`Wikipedia search failed: HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** Search Wikipedia and return a short extract for each hit. */
export async function searchWikipedia(query: string, limit = 4): Promise<WikipediaHit[]> {
  const search = await fetchJson({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    srnamespace: "0",
    format: "json",
    origin: "*",
  });

  const results = (search["query"] as { search?: Array<Record<string, unknown>> } | undefined)?.search ?? [];
  if (results.length === 0) return [];

  const pageIds = results
    .map((r) => r["pageid"])
    .filter((id): id is number => typeof id === "number")
    .join("|");

  const details = await fetchJson({
    action: "query",
    pageids: pageIds,
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exsentences: "6",
    format: "json",
    origin: "*",
  });

  const pages = (details["query"] as { pages?: Record<string, Record<string, unknown>> } | undefined)?.pages ?? {};

  const hits: WikipediaHit[] = [];
  for (const result of results) {
    const pageId = result["pageid"];
    const title = String(result["title"] ?? "");
    if (typeof pageId !== "number") continue;
    const page = pages[String(pageId)];
    const extract = String(page?.["extract"] ?? "").trim();
    if (!extract) continue;
    hits.push({
      title,
      extract,
      pageId,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    });
  }

  return hits;
}

/** Create a Wikipedia search tool for the research agent. */
export function createWikipediaSearchTools(): Record<string, unknown> {
  return {
    wikipedia_search: tool({
      description:
        "Search Wikipedia for facts about a topic. Returns page titles, plain-text extracts and the page URL. Use it to ground a script in verifiable, citable facts.",
      inputSchema: z.object({
        query: z.string().describe("Search terms, e.g. 'Porsche 917 1969 Le Mans'"),
      }),
      execute: async ({ query }) => {
        // A tool that throws ends the whole search pass, so the failure is
        // turned into an empty result instead. The model then answers with
        // what it has rather than the job dying.
        try {
          const hits = await searchWikipedia(query);
          return {
            results: hits.map((hit) => ({
              title: hit.title,
              url: hit.url,
              extract: hit.extract.slice(0, 1200),
            })),
          };
        } catch (error) {
          console.warn(`[wikipedia] search failed for "${query}": ${String(error)}`);
          return { results: [], error: "Wikipedia is not reachable right now" };
        }
      },
    }),
  };
}
