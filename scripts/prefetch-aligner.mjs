/**
 * Fetch the word-alignment model into the image at build time.
 *
 * The aligner uses transformers.js, which caches to `./.cache` relative to the
 * working directory. Without this the first job after every container restart
 * spends a couple of minutes downloading several hundred megabytes, which is a
 * bad thing to do inside a scheduled render. Run from the project root:
 *
 *   node scripts/prefetch-aligner.mjs
 */
const MODEL_ID = "onnx-community/whisper-small.en_timestamped";

const { pipeline } = await import("@huggingface/transformers");

try {
  const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID);
  if (!transcriber) throw new Error("pipeline() returned nothing");
  console.log(`Alignment model ready: ${MODEL_ID}`);
} catch (error) {
  console.error(`Could not fetch ${MODEL_ID}:`, error);
  process.exit(1);
}
