import { afterEach, describe, expect, it, vi } from "vitest";
import { PexelsStock } from "./pexels.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("PexelsStockProvider", () => {
  it("prefers a smaller file over a huge one for the same clip", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        videos: [
          {
            id: 1,
            duration: 12,
            video_files: [
              { link: "https://cdn/huge.mp4", width: 1920, height: 1080, file_size: 689_000_000 },
              { link: "https://cdn/small.mp4", width: 1080, height: 1920, file_size: 8_000_000 },
            ],
          },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new PexelsStock("key");
    const candidates = await provider.searchVideo("dodge muscle car");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toBe("https://cdn/small.mp4");
  });

  it("keeps the only file when every variant is small enough", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        videos: [
          {
            id: 2,
            duration: 8,
            video_files: [
              { link: "https://cdn/ok.mp4", width: 1920, height: 1080, file_size: 12_000_000 },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const provider = new PexelsStock("key");
    const candidates = await provider.searchVideo("ferrari");

    expect(candidates[0]?.url).toBe("https://cdn/ok.mp4");
  });

  it("drops a clip when every variant is above the size cap", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        videos: [
          {
            id: 3,
            duration: 600,
            video_files: [
              {
                link: "https://cdn/enormous.mp4",
                width: 1920,
                height: 1080,
                file_size: 900_000_000,
              },
            ],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const provider = new PexelsStock("key");
    const candidates = await provider.searchVideo("aston martin");

    expect(candidates).toHaveLength(0);
  });
});

it("rejects a download that exceeds the cap while streaming", async () => {
  const big = Buffer.alloc(41 * 1024 * 1024, 1);
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(big);
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "video/mp4" } },
      ),
  ) as unknown as typeof fetch;

  const provider = new PexelsStock("key");
  await expect(
    provider.download({
      url: "https://cdn/big.mp4",
      width: 1080,
      height: 1920,
      id: "pexels-video-9",
    }),
  ).rejects.toThrow(/limit|too large/i);
});
