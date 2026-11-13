import type { TTSProvider, TTSResult } from "../../schema/providers.js";

/**
 * Try one voice engine, then another.
 *
 * A local narrator is a single point of failure: a missing voice file, a
 * missing espeak binary or a model that will not load would end the job. The
 * fallback keeps the render alive with a second voice instead, and the render
 * reports which engine spoke.
 */
export class FallbackTTSProvider implements TTSProvider {
  constructor(
    private providers: readonly TTSProvider[],
    private names: readonly string[] = [],
  ) {}

  async generate(text: string): Promise<TTSResult> {
    if (this.providers.length === 0) {
      throw new Error("No voice engine is configured");
    }

    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]!;
      const name = this.names[i] ?? provider.constructor.name;
      try {
        const result = await provider.generate(text);
        if (i > 0) {
          console.warn(`[tts] ${name} spoke after an earlier engine failed`);
        }
        return result;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[tts] ${name} failed: ${message}`);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
