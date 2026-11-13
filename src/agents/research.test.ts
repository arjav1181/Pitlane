import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../schema/providers.js";
import { research } from "./research.js";

function makeLLM(): LLMProvider & { calls: Array<{ userMessage: string; enableWebSearch?: boolean }> } {
  const calls: Array<{ userMessage: string; enableWebSearch?: boolean }> = [];
  return {
    calls,
    async generate(opts: {
      userMessage: string;
      enableWebSearch?: boolean;
    }): Promise<{ data: { summary: string; key_facts: string[]; mood: string; sources: string[] }; usage: { inputTokens: number; outputTokens: number } }> {
      calls.push({ userMessage: opts.userMessage, enableWebSearch: opts.enableWebSearch });
      return {
        data: {
          summary: "The Jeep was designed for war.",
          key_facts: ["Karl Probst drew the original Jeep."],
          mood: "informative",
          sources: [],
        },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  } as unknown as LLMProvider & { calls: typeof calls };
}

describe("research", () => {
  it("searches first and gives the model what came back", async () => {
    const llm = makeLLM();
    const search = vi.fn().mockResolvedValue([
      {
        title: "Willys MB",
        url: "https://en.wikipedia.org/wiki/Willys_MB",
        content: "The Willys MB was the first Jeep.",
        source: "wikipedia" as const,
      },
    ]);

    const result = await research(llm, "How the military Jeep was designed", undefined, search);

    expect(search).toHaveBeenCalledTimes(1);
    expect(llm.calls[0]?.userMessage).toContain("Willys MB");
    expect(llm.calls[0]?.userMessage).toContain("https://en.wikipedia.org/wiki/Willys_MB");
    // The search knows the URLs, so they end up in the brief even if the
    // model forgot them.
    expect(result.data.sources).toContain("https://en.wikipedia.org/wiki/Willys_MB");
  });

  it("puts the verified fact in the brief", async () => {
    const llm = makeLLM();
    const search = vi.fn().mockResolvedValue([]);

    await research(
      llm,
      "The original Jeep",
      "Fact: Karl Probst designed the original military Jeep. Source: jeep.com",
      search,
    );

    expect(llm.calls[0]?.userMessage).toContain("Karl Probst designed the original military Jeep");
  });

  it("answers from the model's own knowledge when the search is empty", async () => {
    const llm = makeLLM();
    const search = vi.fn().mockRejectedValue(new Error("no network"));

    const result = await research(llm, "A topic with no sources", undefined, search);

    expect(result.data.key_facts).toHaveLength(1);
    expect(llm.calls[0]?.userMessage).toContain("A topic with no sources");
  });
});
