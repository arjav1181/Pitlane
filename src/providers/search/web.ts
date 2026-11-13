import { searchWikipedia } from "./wikipedia.js";

/**
 * A search hit.
 *
 * `url` is kept because a fact without a source is a rumour, and the script
 * can name where it came from.
 */
export interface SearchHit {
  title: string;
  url: string;
  content: string;
  source: "tavily" | "wikipedia";
}

/**
 * Search the web, with no key required.
 *
 * Tavily is used when a key is set: it is the better search. Without a key
 * the search falls back to Wikipedia, which is open, needs no account, and
 * returns pages that can be cited.
 *
 * The search is done here rather than through the model, because a model
 * behind an OpenAI-compatible gateway cannot be relied on to call tools. The
 * pipeline asks for the facts it needs and gets them.
 */
export async function webSearch(query: string, limit = 5): Promise<SearchHit[]> {
  const tavilyKey = process.env["TAVILY_API_KEY"];
  if (tavilyKey) {
    try {
      return await tavilySearch(query, tavilyKey, limit);
    } catch (error) {
      console.warn(`[search] Tavily failed (${String(error)}), using Wikipedia`);
    }
  }
  return wikipediaSearch(query, limit);
}

async function tavilySearch(query: string, apiKey: string, limit: number): Promise<SearchHit[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: limit, search_depth: "basic" }),
  });
  if (!response.ok) throw new Error(`Tavily search failed: HTTP ${response.status}`);
  const body = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (body.results ?? []).map((result) => ({
    title: result.title ?? query,
    url: result.url ?? "",
    content: (result.content ?? "").slice(0, 1500),
    source: "tavily" as const,
  }));
}

async function wikipediaSearch(query: string, limit: number): Promise<SearchHit[]> {
  const hits = await searchWikipedia(query, limit);
  return hits.map((hit) => ({
    title: hit.title,
    url: hit.url,
    content: hit.extract.slice(0, 1500),
    source: "wikipedia" as const,
  }));
}
