/**
 * Bake the Kokoro narrator into the image.
 *
 * Kokoro is a local neural voice (82M parameters, ONNX, quantised) that is a
 * clear step up from Piper: steadier phrasing, real intonation, and a voice
 * that does not sound like it is reading a list of facts. It needs two things
 * that must exist before the first render:
 *
 *   1. the model files, downloaded by transformers.js into its own cache
 *   2. the voice files, which kokoro-js reads from `node_modules/kokoro-js/voices`
 *
 * This script fetches the voices, loads the model, and synthesises a test
 * line. If the engine cannot speak at build time, the build fails here rather
 * than in a scheduled render at 3am.
 *
 *   node scripts/prefetch-kokoro.mjs
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VOICES_DIR = resolve(REPO_ROOT, "node_modules/kokoro-js/voices");
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_BASE = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices`;

/** The voices the channel uses, plus fallbacks. */
const VOICES = ["am_michael", "bm_lewis", "af_heart"];

mkdirSync(VOICES_DIR, { recursive: true });

for (const voice of VOICES) {
  const target = join(VOICES_DIR, `${voice}.bin`);
  try {
    if (statSync(target).size > 1024) {
      console.log(`voice ready: ${voice}`);
      continue;
    }
  } catch {
    /* not downloaded yet */
  }

  const response = await fetch(`${VOICE_BASE}/${voice}.bin`);
  if (!response.ok) throw new Error(`Could not fetch voice ${voice}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(target, buffer);
  console.log(`voice fetched: ${voice} (${Math.round(buffer.length / 1024)} KB)`);
}

const { KokoroTTS } = await import("kokoro-js");
const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8" });

const started = Date.now();
const audio = await tts.generate("The narrator is ready, and the engine works.", {
  voice: "am_michael",
});
const seconds = (Date.now() - started) / 1000;
const spoken = audio.audio.length / audio.sampling_rate;

if (!Number.isFinite(spoken) || spoken < 0.5) {
  throw new Error(`Kokoro produced no usable audio (${spoken.toFixed(2)}s)`);
}

console.log(
  `Kokoro is ready: ${spoken.toFixed(1)}s of audio in ${seconds.toFixed(1)}s ` +
    `(real time factor ${(seconds / spoken).toFixed(2)}).`,
);
