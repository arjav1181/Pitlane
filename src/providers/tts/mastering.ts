import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Broadcast mastering for the voiceover.
 *
 * Every engine delivers a different level, a different tone and a different
 * amount of sibilance. Played back to back on one channel that reads as
 * inconsistency, so the voice is mastered once, here, regardless of where it
 * came from:
 *
 *   rumble removed   ──► high pass at 70 Hz
 *   sibilance tamed  ──► gentle de-esser
 *   level matched    ──► two-pass loudness normalisation to -14 LUFS
 *   peaks held       ──► -1.5 dBTP ceiling
 *
 * -14 LUFS is where YouTube normalises, so the short is not turned down at
 * upload. The mastering is gain- and tone-only: it never changes the length of
 * the audio, which keeps word timings from the provider and from Whisper valid.
 *
 * If ffmpeg is missing or the filters fail, the original audio is returned. A
 * render is never lost to mastering.
 */

/** Integrated loudness target (YouTube normalises here). */
export const TARGET_LUFS = envNumber("OPENREELS_VOICEOVER_LUFS", -14);
/** True peak ceiling, in dBTP. */
export const TARGET_TRUE_PEAK_DB = envNumber("OPENREELS_VOICEOVER_TRUE_PEAK_DB", -1.5);
/** Loudness range, in LU. */
export const TARGET_LRA = 11;
/** Output bitrate for the voiceover. */
export const VOICEOVER_BITRATE = "192k";

export interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

export type FfmpegRunner = (args: string[]) => Promise<{ stderr: string }>;

/** Run ffmpeg and resolve with its stderr, which is where loudnorm prints. */
export const runFfmpeg: FfmpegRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      args,
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }));
        } else {
          resolve({ stderr: stderr ?? "" });
        }
      },
    );
  });

/** Pull the measurement block out of ffmpeg's loudnorm log. */
export function parseLoudnormJson(stderr: string): LoudnormMeasurement | null {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as Partial<LoudnormMeasurement>;
    if (
      parsed.input_i == null ||
      parsed.input_tp == null ||
      parsed.input_lra == null ||
      parsed.input_thresh == null
    ) {
      return null;
    }
    return {
      input_i: String(parsed.input_i),
      input_tp: String(parsed.input_tp),
      input_lra: String(parsed.input_lra),
      input_thresh: String(parsed.input_thresh),
      target_offset: String(parsed.target_offset ?? "0"),
    };
  } catch {
    return null;
  }
}

/**
 * The measurement chain.
 *
 * The cleanup filters run before the measurement on purpose. Measuring the
 * raw signal and then filtering it changes the level, so the second pass would
 * land a LU or more under the target. Measuring what will actually be heard
 * makes the linear gain land on the target.
 */
export function buildMeasurementFilter(): string {
  return [
    "highpass=f=70",
    "deesser=i=0.35",
    `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=${TARGET_LRA}:print_format=json`,
    "aresample=44100",
  ].join(",");
}

/**
 * The filter chain. With a measurement it applies a constant gain (linear),
 * which is transparent; without one it falls back to dynamic normalisation so
 * the voice is still at the right level.
 */
export function buildMasteringFilter(measurement: LoudnormMeasurement | null): string {
  const filters = ["highpass=f=70", "deesser=i=0.35"];
  if (measurement) {
    filters.push(
      [
        `loudnorm=I=${TARGET_LUFS}`,
        `TP=${TARGET_TRUE_PEAK_DB}`,
        `LRA=${TARGET_LRA}`,
        `measured_I=${measurement.input_i}`,
        `measured_TP=${measurement.input_tp}`,
        `measured_LRA=${measurement.input_lra}`,
        `measured_thresh=${measurement.input_thresh}`,
        `offset=${measurement.target_offset}`,
        "linear=true",
      ].join(":"),
    );
  } else {
    filters.push(`loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DB}:LRA=${TARGET_LRA}`);
  }
  filters.push("aresample=44100");
  return filters.join(",");
}

/** Guess a container from the bytes so ffmpeg gets a useful file name. */
export function audioExtension(audio: Buffer): string {
  if (audio.length >= 4 && audio.toString("ascii", 0, 4) === "RIFF") return "wav";
  if (audio.length >= 4 && audio.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (audio.length >= 4 && audio.toString("ascii", 0, 4) === "fLaC") return "flac";
  if (audio.length >= 3 && audio.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (audio.length >= 2 && audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0) return "mp3";
  return "bin";
}

/**
 * Master a buffer of speech and return an MP3. Returns the input unchanged if
 * mastering cannot be done.
 */
export async function masterVoiceover(
  audio: Buffer,
  run: FfmpegRunner = runFfmpeg,
): Promise<Buffer> {
  if (audio.length === 0) return audio;

  const dir = await mkdtemp(join(tmpdir(), "voice-master-"));
  const container = audioExtension(audio);
  const inputPath = join(dir, `input.${container}`);
  // Keep the container the engine returned. The aligner reads WAV only, so a
  // WAV voice must stay WAV until after alignment; MP3 voices stay MP3.
  const outputIsWav = container === "wav";
  const outputPath = join(dir, outputIsWav ? "mastered.wav" : "mastered.mp3");

  try {
    await writeFile(inputPath, audio);

    // Pass one: measure. ffmpeg prints a JSON block to stderr and exits 0.
    let measurement: LoudnormMeasurement | null = null;
    try {
      const { stderr } = await run([
        "-hide_banner",
        "-nostats",
        "-i",
        inputPath,
        "-af",
        buildMeasurementFilter(),
        "-f",
        "null",
        "-",
      ]);
      measurement = parseLoudnormJson(stderr);
    } catch {
      // Measurement is an optimisation, not a requirement.
    }

    // Pass two: apply.
    await run([
      "-y",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-af",
      buildMasteringFilter(measurement),
      "-ac",
      "1",
      "-ar",
      "44100",
      ...(outputIsWav
        ? ["-codec:a", "pcm_s16le"]
        : ["-codec:a", "libmp3lame", "-b:a", VOICEOVER_BITRATE]),
      outputPath,
    ]);

    return await readFile(outputPath);
  } catch (error) {
    console.warn(
      `[tts] Mastering skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return audio;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
