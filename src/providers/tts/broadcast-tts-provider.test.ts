import { describe, expect, it } from "vitest";
import type { TTSProvider, TTSResult } from "../../schema/providers.js";
import { BroadcastTTSProvider } from "./broadcast-tts-provider.js";

class FakeTTS implements TTSProvider {
  public received = "";
  constructor(private result: TTSResult) {}
  async generate(text: string): Promise<TTSResult> {
    this.received = text;
    return this.result;
  }
}

const words = [{ word: "hello", start: 0, end: 0.4 }];

describe("BroadcastTTSProvider", () => {
  it("normalises the script before the engine sees it", async () => {
    const inner = new FakeTTS({ audio: Buffer.from("RAW"), words: [] });
    const tts = new BroadcastTTSProvider(inner, { master: async (b) => b });

    await tts.generate("It ran at 320 km/h — with 580 hp.");

    expect(inner.received).toBe("It ran at 320 kilometres per hour, with 580 horsepower.");
  });

  it("masters the audio the engine returned", async () => {
    const inner = new FakeTTS({ audio: Buffer.from("RAW"), words: [] });
    const seen: Buffer[] = [];
    const tts = new BroadcastTTSProvider(inner, {
      master: async (audio) => {
        seen.push(audio);
        return Buffer.from("MASTERED");
      },
    });

    const result = await tts.generate("A line.");

    expect(seen[0]?.toString()).toBe("RAW");
    expect(result.audio.toString()).toBe("MASTERED");
  });

  it("keeps the engine's word timings, because mastering is gain-only", async () => {
    const inner = new FakeTTS({ audio: Buffer.from("RAW"), words });
    const tts = new BroadcastTTSProvider(inner, { master: async (b) => b });

    const result = await tts.generate("Hello.");

    expect(result.words).toEqual(words);
  });
});
