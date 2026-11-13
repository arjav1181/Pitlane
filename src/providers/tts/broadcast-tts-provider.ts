import type { TTSProvider, TTSResult } from "../../schema/providers.js";
import { masterVoiceover } from "./mastering.js";
import { normalizeNarration } from "./narration.js";

export interface BroadcastOptions {
  /** Override the mastering step, for tests. */
  master?: (audio: Buffer) => Promise<Buffer>;
  /** Override the script normaliser, for tests. */
  normalize?: (text: string) => string;
}

/**
 * Makes any TTS provider broadcast-ready.
 *
 * Two things happen here, in this order, and they are the same for every
 * engine:
 *
 *   written script ──► normalizeNarration() ──► engine ──► masterVoiceover() ──► MP3
 *
 * The script is rewritten into something a narrator can say (units, symbols,
 * abbreviations, long sentences), and the returned audio is mastered to the
 * channel's loudness and tone. Neither step changes the length of the audio,
 * so timings returned by the engine stay valid.
 *
 * Wrap this *inside* AlignedTTSProvider: the aligner then hears the audio that
 * will actually be rendered and its timestamps match the final file.
 */
export class BroadcastTTSProvider implements TTSProvider {
  constructor(
    private inner: TTSProvider,
    private options: BroadcastOptions = {},
  ) {}

  async generate(text: string): Promise<TTSResult> {
    const normalize = this.options.normalize ?? normalizeNarration;
    const master = this.options.master ?? masterVoiceover;

    const narration = normalize(text);
    const result = await this.inner.generate(narration);
    const audio = await master(result.audio);

    return { audio, words: result.words };
  }
}
