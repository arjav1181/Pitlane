import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWikipedia } from "./wikipedia.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchWikipedia", () => {
  it("returns extracts and source URLs for the hits", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          search: [{ pageid: 123, title: "Porsche 917" }],
        },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "123": {
              pageid: 123,
              title: "Porsche 917",
              extract: "The Porsche 917 is a mid-engined sports car produced by Porsche.",
            },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchWikipedia("Porsche 917");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Porsche 917");
    expect(hits[0]?.url).toBe("https://en.wikipedia.org/wiki/Porsche_917");
    expect(hits[0]?.extract).toContain("mid-engined");
  });

  it("returns nothing when the search has no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ query: { search: [] } }) }),
    );

    expect(await searchWikipedia("nothing at all")).toEqual([]);
  });
});
