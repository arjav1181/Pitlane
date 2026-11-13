import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";

/**
 * Make a stock clip cheap to render.
 *
 * A stock library will happily hand over a four-minute 4K file. Rendering
 * that costs minutes of CPU per scene, because every frame of it has to be
 * extracted and scaled, and the finished short carries megabytes of footage
 * nobody sees. The clip is trimmed to a scene length, scaled to 720p and
 * stripped of its audio, which the narration covers anyway.
 *
 * The result loops if the scene is longer than the clip, so a short clip is
 * never a problem.
 */

/** Longest clip we keep. A scene is a handful of seconds, and every extra
 * second is another frame the renderer has to pull out of the proxy. */
const MAX_SECONDS = 6;
/** Largest file we keep without touching it. */
const MAX_BYTES = 8 * 1024 * 1024;
/** Tallest frame we keep. */
const MAX_HEIGHT = 1080;

export interface PreparedVideo {
  filePath: string;
  duration: number | null;
  /** True when the file was re-encoded. */
  prepared: boolean;
}

function probe(filePath: string): { duration: number | null; height: number | null; width: number | null } {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "default=nw=1:nk=1",
        filePath,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    const [width, height, duration] = out
      .trim()
      .split("\n")
      .map((line: string) => Number(line.trim()))
      .filter((value: number) => Number.isFinite(value));
    return {
      width: Number.isFinite(width) ? (width as number) : null,
      height: Number.isFinite(height) ? (height as number) : null,
      duration: Number.isFinite(duration) ? (duration as number) : null,
    };
  } catch {
    return { duration: null, height: null, width: null };
  }
}

/**
 * Trim, scale and silence a stock clip when it is worth doing.
 *
 * If anything goes wrong the original file is returned untouched: a slower
 * render is better than a broken one.
 */
export async function prepareStockVideo(filePath: string): Promise<PreparedVideo> {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return { filePath, duration: null, prepared: false };
  }

  const { duration, height } = probe(filePath);
  const tooLong = duration != null && duration > MAX_SECONDS + 0.5;
  const tooBig = size > MAX_BYTES;
  const tooTall = height != null && height > MAX_HEIGHT;

  if (!tooLong && !tooBig && !tooTall) {
    return { filePath, duration, prepared: false };
  }

  const output = filePath.replace(/\.[^.]+$/, "") + ".render.mp4";

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          filePath,
          "-t",
          String(MAX_SECONDS),
          "-vf",
          "scale=-2:720",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "26",
          "-pix_fmt",
          "yuv420p",
          "-an",
          "-movflags",
          "+faststart",
          output,
        ],
        { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
        (error) => (error ? reject(error) : resolve()),
      );
    });

    const prepared = probe(output);
    return { filePath: output, duration: prepared.duration ?? duration, prepared: true };
  } catch (error) {
    console.warn(`[stock] Could not prepare the clip: ${String(error)}`);
    return { filePath, duration, prepared: false };
  }
}
