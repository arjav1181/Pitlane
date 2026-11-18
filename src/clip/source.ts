import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ClipSpec } from "./spec.js";

/**
 * Getting a long video onto the disk.
 *
 * Every clip starts as somebody else's upload, and a clip tool is only as good
 * as the file it cuts from: a 360p copy of a stream produces a 360p clip, and a
 * download that silently stops halfway produces clips from the first half.
 * So the source stage is explicit about what it fetched and how long it is,
 * and it treats a failing download as a failure instead of cutting from a
 * truncated file.
 */

export interface SourceInfo {
  /** Absolute path of the downloaded file. */
  path: string;
  title: string;
  uploader?: string;
  durationSeconds: number;
  webpageUrl: string;
  wasLive: boolean;
  /** The window of the original that was fetched, in seconds. */
  window: { start: number; end: number };
}

export interface SourceOptions {
  onLog?: (message: string) => void;
  /** Abort a download that takes longer than this. Defaults to 45 minutes. */
  timeoutMs?: number;
  /** Replace the yt-dlp binary, for tests. */
  bin?: string;
}

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;

/**
 * Does this yt-dlp know `--js-runtimes`?
 *
 * The option arrived in late 2025; passing it to an older binary is a hard
 * error, so it is probed once and then remembered for the process.
 */
let jsRuntimeSupport: Promise<boolean> | null = null;

function supportsJsRuntime(bin: string): Promise<boolean> {
  if (!jsRuntimeSupport) {
    jsRuntimeSupport = run(bin, ["--version"], 20_000)
      .then((out) => {
        const [major = "0", minor = "0"] = out.trim().split(".");
        return Number(major) > 2025 || (Number(major) === 2025 && Number(minor) >= 10);
      })
      .catch(() => false);
  }
  return jsRuntimeSupport;
}

/** yt-dlp error text that means "try another player client" rather than "fail". */
const RETRYABLE = [
  /403/i,
  /forbidden/i,
  /unable to download video data/i,
  /nsig/i,
  /fragment/i,
  /requested format is not available/i,
  /page needs to be reloaded/i,
  /no video formats found/i,
];

/** Error text that no retry will fix. */
const FATAL = [
  /video unavailable/i,
  /private video/i,
  /this video is not available/i,
  /sign in to confirm/i,
  /account.*terminated/i,
  /copyright/i,
  /removed by the uploader/i,
  /unsupported url/i,
];

const DIRECT_MEDIA = /\.(mp4|webm|mov|m4v|mkv|flv|ts)$/i;

/**
 * A URL that is already a video file.
 *
 * yt-dlp's generic extractor downloads the page that contains the link before
 * it downloads the link, which is both pointless and a rate-limit magnet for
 * a plain CDN URL. Such a URL is fetched directly instead.
 */
export function isDirectMediaUrl(url: string): boolean {
  try {
    return DIRECT_MEDIA.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export class SourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}

function isYoutube(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith("youtube.com") || host === "youtu.be" || host.endsWith("youtube-nocookie.com")
    );
  } catch {
    return false;
  }
}

/**
 * The part of the source to fetch.
 *
 * `maxSourceMinutes` is not decoration: transcription cost scales with the
 * downloaded length, and an eight-hour stream would occupy the worker for most
 * of a day. The window is resolved once, recorded in the job, and every clip
 * timestamp is relative to it.
 */
export function sourceWindow(
  spec: ClipSpec,
  durationSeconds: number | null,
): { start: number; end: number } {
  const start = Math.max(0, spec.startSeconds ?? 0);
  const capEnd = start + spec.maxSourceMinutes * 60;
  const declaredEnd = spec.endSeconds ?? (durationSeconds ?? capEnd);
  const end = Math.max(start + 1, Math.min(declaredEnd, capEnd));
  return { start, end };
}

export function downloadArgs(
  spec: ClipSpec,
  outputTemplate: string,
  window: { start: number; end: number },
  durationSeconds: number | null,
  playerClient?: string,
  jsRuntime = false,
): string[] {
  const args = [
    "--no-playlist",
    "--no-progress",
    "--no-update",
    "--newline",
    "--no-part",
    "--force-overwrites",
    "--socket-timeout",
    "20",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "-o",
    outputTemplate,
  ];

  // YouTube signs its formats with a JavaScript challenge. A yt-dlp recent
  // enough to know `--js-runtimes` can use the Node already in this image;
  // an older one is left alone rather than failed on an unknown option.
  if (isYoutube(spec.sourceUrl) && jsRuntime) {
    args.push("--js-runtimes", "node");
  }

  if (isYoutube(spec.sourceUrl) && playerClient) {
    args.push("--extractor-args", `youtube:player_client=${playerClient}`);
  }

  // A datacenter IP can be refused by YouTube's media servers even when the
  // metadata call succeeds. Both escape hatches are environment configuration
  // rather than code: a proxy the operator already pays for, and a cookies
  // file exported from a signed-in browser.
  const proxy = process.env["OPENREELS_YTDLP_PROXY"];
  if (proxy) args.push("--proxy", proxy);
  const cookies = process.env["OPENREELS_YTDLP_COOKIES"];
  if (cookies) args.push("--cookies", cookies);

  if (spec.liveFromStart) args.push("--live-from-start");

  const wholeFile = durationSeconds !== null && window.end >= durationSeconds - 1;
  if (!wholeFile || window.start > 0) {
    args.push(
      "--download-sections",
      `*${window.start.toFixed(0)}-${window.end.toFixed(0)}`,
      "--force-keyframes-at-cuts",
    );
  }

  args.push(spec.sourceUrl);
  return args;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${stderr}\n${stdout}`.trim() || error.message;
        reject(Object.assign(error, { stderr: detail }));
        return;
      }
      resolve(stdout);
    });
  });
}

interface ProbeMetadata {
  title?: string;
  uploader?: string;
  duration?: number;
  is_live?: boolean;
  webpage_url?: string;
}

async function probe(bin: string, url: string): Promise<ProbeMetadata> {
  try {
    const out = await run(
      bin,
      ["-J", "--no-playlist", "--no-warnings", "--no-update", "--socket-timeout", "20", url],
      120_000,
    );
    return JSON.parse(out) as ProbeMetadata;
  } catch (err) {
    // A live stream can refuse the metadata probe and still download, and a
    // title is not worth failing the job over.
    const message = err instanceof Error ? (err as Error & { stderr?: string }).stderr ?? err.message : "";
    if (FATAL.some((pattern) => pattern.test(message))) {
      throw new SourceUnavailableError(firstLine(message));
    }
    return {};
  }
}

/** The line that explains the failure, not the warning above it. */
function firstLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const error = lines.find((line) => /^(ERROR|error:)/.test(line));
  const useful = lines.filter(
    (line) =>
      !/^WARNING/i.test(line) &&
      !/^You installed|strongly recommended|suppress this warning|older than 90 days/i.test(line),
  );
  return (error ?? useful[useful.length - 1] ?? lines[lines.length - 1] ?? "The downloader did not say why").slice(
    0,
    300,
  );
}

/** The file yt-dlp actually wrote, which is never exactly the template. */
function findOutput(dir: string): string | null {
  const files = fs
    .readdirSync(dir)
    .filter((name) => /\.(mp4|mkv|webm|mov)$/i.test(name))
    .map((name) => path.join(dir, name))
    .filter((file) => {
      try {
        return fs.statSync(file).size > 1024;
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  return files[0] ?? null;
}

export async function probeDuration(bin: string, file: string): Promise<number | null> {
  try {
    const out = await run(
      bin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      30_000,
    );
    const value = Number(out.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Download the source, retrying the player clients YouTube serves differently.
 *
 * A plain download is tried first because it is the one that keeps the best
 * quality. The 403 that a signed-out YouTube client returns is a signature
 * problem, not a permissions problem, and a different player client usually
 * has a working one.
 */
export async function downloadSource(
  spec: ClipSpec,
  workDir: string,
  options: SourceOptions = {},
): Promise<SourceInfo> {
  const bin = options.bin ?? "yt-dlp";
  const log = options.onLog ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  fs.mkdirSync(workDir, { recursive: true });

  if (isDirectMediaUrl(spec.sourceUrl)) {
    return downloadDirect(spec, workDir, { log, timeoutMs });
  }

  const meta = await probe(bin, spec.sourceUrl);
  const declaredDuration =
    typeof meta.duration === "number" && Number.isFinite(meta.duration) && meta.duration > 0
      ? meta.duration
      : null;
  const window = sourceWindow(spec, declaredDuration);

  log(
    `Source: ${meta.title ?? spec.sourceUrl} (${declaredDuration ? `${Math.round(declaredDuration)}s` : "live or unknown length"})`,
  );

  const clients = isYoutube(spec.sourceUrl) ? [undefined, "default,web_safari", "android_vr,web", "tv"] : [undefined];
  const jsRuntime = isYoutube(spec.sourceUrl) ? await supportsJsRuntime(bin) : false;
  let lastError = "";

  for (const [index, client] of clients.entries()) {
    // Each attempt gets a clean directory: a half-written container from the
    // previous client must never be mistaken for a finished download.
    const attemptDir = path.join(workDir, `download-${index}`);
    fs.mkdirSync(attemptDir, { recursive: true });
    const template = path.join(attemptDir, "source.%(ext)s");
    const args = downloadArgs(spec, template, window, declaredDuration, client, jsRuntime);

    try {
      log(`Downloading${client ? ` (player client: ${client})` : ""}…`);
      await run(bin, args, timeoutMs);
      const file = findOutput(attemptDir);
      if (!file) throw new Error("The downloader finished without writing a video file");
      const duration = (await probeDuration("ffprobe", file)) ?? window.end - window.start;
      if (duration < 2) throw new Error(`The downloaded file is only ${duration.toFixed(1)}s long`);
      log(`Downloaded ${Math.round(duration)}s of source`);
      return {
        path: file,
        title: meta.title ?? path.basename(spec.sourceUrl),
        ...(meta.uploader ? { uploader: meta.uploader } : {}),
        durationSeconds: duration,
        webpageUrl: meta.webpage_url ?? spec.sourceUrl,
        wasLive: meta.is_live === true || spec.liveFromStart,
        window,
      };
    } catch (err) {
      const detail =
        err instanceof Error
          ? ((err as Error & { stderr?: string }).stderr ?? err.message)
          : String(err);
      lastError = detail;
      const fatal = FATAL.find((pattern) => pattern.test(detail));
      if (fatal) throw new SourceUnavailableError(firstLine(detail));
      const retryable = RETRYABLE.some((pattern) => pattern.test(detail));
      const hasNext = index < clients.length - 1;
      if (!retryable || !hasNext) break;
      log(`Download failed (${firstLine(detail)}); trying another player client`);
    }
  }

  throw new SourceUnavailableError(
    `Could not download the source: ${firstLine(lastError) || "unknown downloader error"}`,
  );
}

async function curl(url: string, output: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "curl",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--connect-timeout",
        "20",
        "--max-time",
        String(Math.round(timeoutMs / 1000)),
        "--output",
        output,
        url,
      ],
      { timeout: timeoutMs + 30_000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`curl failed: ${String(stderr).trim().slice(0, 400) || error.message}`));
          return;
        }
        resolve();
      },
    );
  });
}

/**
 * Fetch a URL that is already a video file.
 *
 * The download is the whole file, then trimmed to the requested window when
 * the source is longer than the cap. Trimming after the fact costs a stream
 * copy and keeps the plain-HTTP path free of range-request guesswork.
 */
async function downloadDirect(
  spec: ClipSpec,
  workDir: string,
  options: { log: (message: string) => void; timeoutMs: number },
): Promise<SourceInfo> {
  const extension = (/\.[a-z0-9]+$/i.exec(new URL(spec.sourceUrl).pathname)?.[0] ?? ".mp4").toLowerCase();
  const raw = path.join(workDir, `source-original${extension}`);
  const log = options.log;

  log("Downloading the video file directly…");
  await curl(spec.sourceUrl, raw, options.timeoutMs);

  const duration = await probeDuration("ffprobe", raw);
  if (!duration) {
    throw new SourceUnavailableError("The downloaded file has no readable duration");
  }

  const window = sourceWindow(spec, duration);
  let finalPath = raw;

  if (window.start > 0 || window.end < duration - 0.5) {
    const trimmed = path.join(workDir, `source-trimmed${extension}`);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          String(window.start),
          "-i",
          raw,
          "-t",
          String(window.end - window.start),
          "-c",
          "copy",
          "-y",
          trimmed,
        ],
        { timeout: 30 * 60 * 1000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`ffmpeg trim failed: ${String(stderr).trim().slice(0, 400)}`));
            return;
          }
          resolve();
        },
      );
    });
    finalPath = trimmed;
    log(`Trimmed the source to ${Math.round(window.end - window.start)}s`);
  }

  return {
    path: finalPath,
    title: path.basename(new URL(spec.sourceUrl).pathname, extension).replace(/[-_]+/g, " "),
    durationSeconds: Math.min(duration, window.end) - window.start,
    webpageUrl: spec.sourceUrl,
    wasLive: false,
    window,
  };
}
