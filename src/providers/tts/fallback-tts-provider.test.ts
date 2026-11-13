import { describe, expect, it } from "vitest";
import type { TTSProvider, TTSResult } from "../../schema/providers.js";
import { FallbackTTSProvider } from "./fallback-tts-provider.js";

class FakeTTS implements TTSProvider {
  public calls = 0;
  constructor(
    private result: TTSResult,
    private fail = false,
  ) {}
  async generate(_text: string): Promise<TTSResult> {
    this.calls++;
    if (this.fail) throw new Error("engine is broken");
    return this.result;
  }
}

const result: TTSResult = { audio: Buffer.from("AUDIO"), words: [] };

describe("FallbackTTSProvider", () => {
  it("uses the first engine that works", async () => {
    const first = new FakeTTS(result);
    const second = new FakeTTS(result);

    const tts = new FallbackTTSProvider([first, second], ["kokoro", "piper"]);
    const output = await tts.generate("Hello.");

    expect(output.audio.toString()).toBe("AUDIO");
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(0);
  });

  it("falls back to the next engine when the first fails", async () => {
    const first = new FakeTTS(result, true);
    const second = new FakeTTS(result);

    const tts = new FallbackTTSProvider([first, second], ["kokoro", "piper"]);
    const output = await tts.generate("Hello.");

    expect(output.audio.toString()).toBe("AUDIO");
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
  });

  it("throws the last error when every engine fails", async () => {
    const tts = new FallbackTTSProvider(
      [new FakeTTS(result, true), new FakeTTS(result, true)],
      ["kokoro", "piper"],
    );

    await expect(tts.generate("Hello.")).rejects.toThrow("engine is broken");
  });

  it("fails clearly when no engine is configured", async () => {
    const tts = new FallbackTTSProvider([]);
    await expect(tts.generate("Hello.")).rejects.toThrow("No voice engine");
  });
});
