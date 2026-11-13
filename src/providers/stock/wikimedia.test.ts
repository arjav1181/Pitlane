import { afterEach, describe, expect, it, vi } from "vitest";
import { WikimediaStock } from "./wikimedia.js";

const SEARCH_RESPONSE = {
  query: {
    pages: [
      {
        pageid: 42,
        title: "File:Porsche 917 at Le Mans.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Porsche_917.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Porsche_917_at_Le_Mans.jpg",
            thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Porsche_917.jpg/1280px-Porsche_917.jpg",
            thumbwidth: 1280,
            thumbheight: 853,
            width: 3000,
            height: 2000,
            mime: "image/jpeg",
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              Artist: { value: "<a href='#'>Jane Driver</a>" },
            },
          },
        ],
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WikimediaStock", () => {
  it("returns candidates with the licence and author attached", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SEARCH_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new WikimediaStock();
    const candidates = await provider.searchImage("Porsche 917");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe("wikimedia-42");
    expect(candidates[0]?.credit?.license).toBe("CC BY-SA 4.0");
    expect(candidates[0]?.credit?.author).toBe("Jane Driver");
    expect(candidates[0]?.credit?.sourceUrl).toContain("commons.wikimedia.org");
  });

  it("asks the API for bitmap files only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SEARCH_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    await new WikimediaStock().searchImage("Porsche 917");

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("filetype%3Abitmap");
  });

  it("keeps only video files for a video search", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: [
            {
              pageid: 7,
              title: "File:Race.webm",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/race.webm",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Race.webm",
                  width: 1280,
                  height: 720,
                  mime: "video/webm",
                },
              ],
            },
            {
              pageid: 8,
              title: "File:Photo.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/photo.jpg",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Photo.jpg",
                  width: 800,
                  height: 600,
                  mime: "image/jpeg",
                },
              ],
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new WikimediaStock().searchVideo("Le Mans race");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe("wikimedia-7");
  });
});
