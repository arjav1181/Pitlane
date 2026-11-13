import OpenAI from "openai";
import type { TTSProvider, TTSResult } from "../../schema/providers.js";

/**
 * OpenAI TTS provider.
 *
 * Uses gpt-4o-mini-tts via the OpenAI SDK. Returns WAV audio so the
 * AlignedTTSProvider decorator can run Whisper alignment (which requires
 * WAV/PCM input), then transcode to MP3.
 *
 * Reuses the existing OPENAI_API_KEY. No additional API key needed.
 */
export class OpenAITTS implements TTSProvider {
  private client: OpenAI;
  private model: string;
  private voice: string;
  private instructions: string;

  constructor(
    model: string = "gpt-4o-mini-tts",
    apiKey?: string,
    options?: { voice?: string; instructions?: string },
  ) {
    const key = apiKey ?? process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("OPENAI_API_KEY environment variable is required for OpenAI TTS");
    this.client = new OpenAI({ apiKey: key });
    this.model = model;
    // onyx is the low, even male voice; alloy reads as a bright assistant.
    this.voice = options?.voice ?? process.env["OPENAI_TTS_VOICE"] ?? "onyx";
    this.instructions =
      options?.instructions ??
      process.env["OPENAI_TTS_INSTRUCTIONS"] ??
      "Read as a warm, measured documentary narrator: clear diction, natural " +
        "pacing, calm authority, no theatrics and no rising game-show energy.";
  }

  async generate(text: string): Promise<TTSResult> {
    let response;
    try {
      response = await this.client.audio.speech.create({
        model: this.model,
        voice: this.voice as "alloy",
        input: text,
        response_format: "wav",
        // Only the gpt-4o voices accept delivery instructions; tts-1 rejects them.
        ...(this.model.startsWith("gpt-4o") ? { instructions: this.instructions } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("rate_limit")) {
        throw new Error(`OpenAI TTS rate limited: ${msg}`);
      }
      if (msg.includes("401") || msg.includes("403") || msg.includes("invalid_api_key")) {
        throw new Error(`OpenAI TTS authentication failed: ${msg}. Check your OPENAI_API_KEY.`);
      }
      throw new Error(`OpenAI TTS API error: ${msg}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error(
        "OpenAI TTS returned no audio data. The response may be empty or the model may have refused the input.",
      );
    }

    return { audio: Buffer.from(arrayBuffer), words: [] };
  }
}
