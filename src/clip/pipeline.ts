import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LLMProvider } from "../schema/providers.js";
import { buildAss } from "./captions.js";
import {
  fallbackMoments,
  momentSystemPrompt,
  momentUserMessage,
  MomentSelectionSchema,
  normalizeMoments,
  toMoments,
  type ClipMoment,
} from "./moments.js";
import { buildClipArgs, buildPosterArgs, buildPreviewArgs, CLIP_FPS, CLIP_HEIGHT, CLIP_WIDTH } from "./render.js";
import { downloadSource, type SourceInfo } from "./source.js";
import type { ClipSpec } from "./spec.js";
import { CLIP_STAGE_NAMES, type ClipStageName } from "./stages.js";
import { textForRange, type TranscriptWord } from "./transcript.js";
import { WhisperAligner } from "../providers/tts/whisper-aligner.js";

/**
 * The clip pipeline.
 *
 *   source ──► transcript ──► select ──► render
 *   yt-dlp      whisper        llm       ffmpeg
 *
 * Each stage is reported through the same callbacks the video pipeline uses,
 * so a clip job shows up in the status API, the SSE stream and the job list
 * exactly like a render does.
 */

export { CLIP_STAGE_NAMES, type ClipStageName };

/** The credit burned into every clip, even when the source has no channel. */
export function attributionFor(source: SourceInfo): string {
  if (source.uploader?.trim()) return `@${source.uploader.trim().replace(/^@/, "")}`;
  const title = source.title.trim().replace(/\.[a-z0-9]{2,5}$/i, "");
  return title.length > 48 ? `${title.slice(0, 47).trimEnd()}…` : title;
}

export interface ClipCallbacks {
  onStageStart?(stage: ClipStageName): void;
  onStageComplete?(stage: ClipStageName, detail: string, durationSec: number): void;
  onStageError?(stage: ClipStageName, error: string): void;
  onProgress?(stage: ClipStageName, data: Record<string, unknown>): void;
  onLog?(message: string): void;
  isCancelled?(): boolean;
}

export interface ClipOutput {
  index: number;
  title: string;
  hook: string;
  /** Seconds into the downloaded source. */
  start: number;
  end: number;
  /** Seconds into the original upload, including the download window offset. */
  sourceStart: number;
  sourceEnd: number;
  durationSeconds: number;
  score: number;
  reason: string;
  /** Paths relative to the job directory. */
  path: string;
  posterPath: string;
  previewPath: string;
  captionsPath: string;
  suggestedTitle: string;
  suggestedDescription: string;
}

export interface ClipPipelineResult {
  kind: "clip";
  title: string;
  source: {
    url: string;
    webpageUrl: string;
    title: string;
    uploader?: string;
    durationSeconds: number;
    wasLive: boolean;
    window: { start: number; end: number };
  };
  clips: ClipOutput[];
  transcript: { words: number; language: string };
  selection: "model" | "fallback" | "mixed";
  width: number;
  height: number;
  fps: number;
  warnings: string[];
}

export interface ClipPipelineOptions {
  spec: ClipSpec;
  /** Absolute path of the job directory; output goes below it. */
  jobDir: string;
  llm?: LLMProvider;
  callbacks?: ClipCallbacks;
  /** For tests: replace the whisper aligner. */
  transcriber?: { transcribe(audio: Buffer): Promise<TranscriptWord[]> };
  /** For tests: replace the downloader with a local file. */
  download?: (spec: ClipSpec, workDir: string) => Promise<SourceInfo>;
  /** For tests and previews: render at a smaller size. */
  width?: number;
  height?: number;
  fps?: number;
  /** For tests: keep the downloaded source instead of deleting it. */
  keepSource?: boolean;
}

class CancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "CancelledError";
  }
}

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`${bin} failed: ${String(stderr).trim().slice(0, 800) || error.message}`));
        return;
      }
      resolve();
    });
  });
}

let sharedAligner: WhisperAligner | null = null;

function aligner(): WhisperAligner {
  if (!sharedAligner) sharedAligner = new WhisperAligner();
  return sharedAligner;
}

/** Where the caption font lives on this machine, when it is not a system font. */
function captionFontsDir(): string | undefined {
  const candidates = [
    process.env["OPENREELS_CAPTION_FONTS"],
    "/usr/share/fonts/truetype/liberation",
    "/usr/share/fonts/truetype/dejavu",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((dir) => fs.existsSync(dir));
}

async function extractAudio(sourcePath: string, outPath: string): Promise<void> {
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      sourcePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-y",
      outPath,
    ],
    10 * 60 * 1000,
  );
}

async function selectMoments(
  llm: LLMProvider | undefined,
  words: TranscriptWord[],
  spec: ClipSpec,
  duration: number,
  log: (message: string) => void,
): Promise<{ moments: ClipMoment[]; selection: "model" | "fallback" | "mixed" }> {
  if (!llm) {
    log("No language model configured; selecting moments by speech density");
    return { moments: fallbackMoments(words, spec, duration), selection: "fallback" };
  }

  try {
    const result = await llm.generate({
      systemPrompt: momentSystemPrompt(spec),
      userMessage: momentUserMessage(words, duration, spec),
      schema: MomentSelectionSchema,
    });
    const chosen = normalizeMoments(toMoments(result.data), words, spec, duration);
    if (chosen.length === 0) {
      log("The editor model found no usable moment; falling back to speech density");
      return { moments: fallbackMoments(words, spec, duration), selection: "fallback" };
    }

    if (chosen.length >= spec.count) return { moments: chosen, selection: "model" };

    // A model that returns two moments for a three-clip request is not wrong,
    // it just found two. Top up with non-overlapping density windows rather
    // than shipping fewer clips than the caller asked for.
    const extra = fallbackMoments(words, spec, duration).filter(
      (candidate) =>
        !chosen.some(
          (moment) =>
            Math.min(moment.end, candidate.end) - Math.max(moment.start, candidate.start) > 0.5,
        ),
    );
    const moments = [...chosen, ...extra].slice(0, spec.count).sort((a, b) => a.start - b.start);
    return { moments, selection: "mixed" };
  } catch (err) {
    log(`Editor model failed (${err instanceof Error ? err.message : String(err)}); using speech density`);
    return { moments: fallbackMoments(words, spec, duration), selection: "fallback" };
  }
}

function captionAttribution(source: SourceInfo): string {
  const parts = [source.title];
  if (source.uploader) parts.push(source.uploader);
  return `Clipped from: ${source.title}${source.uploader ? ` — ${source.uploader}` : ""} (${source.webpageUrl})`;
}

/**
 * Cut the clips.
 *
 * A failed render is reported and skipped; the job only fails when nothing
 * could be cut. That matters on a long source: one corrupt moment should not
 * throw away the two clips that rendered perfectly.
 */
export async function runClipPipeline(options: ClipPipelineOptions): Promise<ClipPipelineResult> {
  const { spec, jobDir, callbacks = {}, keepSource } = options;
  const width = options.width ?? CLIP_WIDTH;
  const height = options.height ?? CLIP_HEIGHT;
  const fps = options.fps ?? CLIP_FPS;
  const log = (message: string) => callbacks.onLog?.(message);
  const checkCancelled = () => {
    if (callbacks.isCancelled?.()) throw new CancelledError();
  };

  const clipsDir = path.join(jobDir, "clips");
  const captionsDir = path.join(clipsDir, "captions");
  fs.mkdirSync(captionsDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "openreels-clip-"));

  const warnings: string[] = [];
  let source: SourceInfo | null = null;
  let currentStage: ClipStageName = "source";

  try {
    // ── Source ────────────────────────────────────────────────────────────
    checkCancelled();
    currentStage = "source";
    callbacks.onStageStart?.("source");
    const sourceStarted = Date.now();
    source = options.download
      ? await options.download(spec, workDir)
      : await downloadSource(spec, workDir, { onLog: log });
    callbacks.onStageComplete?.(
      "source",
      `${Math.round(source.durationSeconds)}s from ${source.uploader ?? "source"}`,
      (Date.now() - sourceStarted) / 1000,
    );

    // ── Transcript ────────────────────────────────────────────────────────
    checkCancelled();
    currentStage = "transcript";
    callbacks.onStageStart?.("transcript");
    const transcriptStarted = Date.now();
    const audioPath = path.join(workDir, "audio.wav");
    await extractAudio(source.path, audioPath);
    log(`Transcribing ${Math.round(source.durationSeconds)}s of audio (this is the slow stage)`);
    const audio = fs.readFileSync(audioPath);
    const words = options.transcriber
      ? await options.transcriber.transcribe(audio)
      : await aligner().transcribe(audio);
    if (words.length === 0) {
      throw new Error(
        "The transcript is empty: the source has no recognisable speech, so there is nothing to clip",
      );
    }
    callbacks.onStageComplete?.(
      "transcript",
      `${words.length} words`,
      (Date.now() - transcriptStarted) / 1000,
    );

    // ── Select ────────────────────────────────────────────────────────────
    checkCancelled();
    currentStage = "select";
    callbacks.onStageStart?.("select");
    const selectStarted = Date.now();
    const { moments, selection } = await selectMoments(
      options.llm,
      words,
      spec,
      source.durationSeconds,
      log,
    );
    if (moments.length === 0) {
      throw new Error("No clip-sized moment with speech was found in the source");
    }
    callbacks.onStageComplete?.(
      "select",
      `${moments.length} moments (${selection})`,
      (Date.now() - selectStarted) / 1000,
    );
    callbacks.onProgress?.("select", {
      type: "results",
      moments: moments.map((moment) => ({
        start: moment.start,
        end: moment.end,
        title: moment.title,
        score: moment.score,
      })),
    });

    // ── Render ────────────────────────────────────────────────────────────
    currentStage = "render";
    callbacks.onStageStart?.("render");
    const renderStarted = Date.now();
    const clips: ClipOutput[] = [];
    const fontsDir = captionFontsDir();

    for (const [index, moment] of moments.entries()) {
      checkCancelled();
      const number = String(index + 1).padStart(2, "0");
      const slug = slugify(moment.title, `clip-${number}`);
      const baseName = `clip-${number}-${slug}`;
      const relativeVideo = path.join("clips", `${baseName}.mp4`);
      const relativePoster = path.join("clips", `${baseName}.jpg`);
      const relativePreview = path.join("clips", `${baseName}-preview.mp4`);
      const relativeCaptions = path.join("clips", "captions", `${baseName}.ass`);

      const inside = words.filter((word) => word.start >= moment.start - 0.2 && word.end <= moment.end + 0.2);
      const relativeWords = inside.map((word) => ({
        ...word,
        start: Math.max(0, word.start - moment.start),
        end: Math.max(0, word.end - moment.start),
      }));

      const assPath = path.join(jobDir, relativeCaptions);
      if (spec.captions && relativeWords.length > 0) {
        const ass = buildAss(relativeWords, {
          width,
          height,
          ...(spec.hook && moment.hook ? { hook: moment.hook } : {}),
          // A channel handle is the strongest credit. Direct media URLs have
          // no uploader, so fall back to the source title: it is still the
          // viewer's link back to where the footage came from, burned into
          // the frame rather than buried in a description.
          ...{
            watermark: attributionFor(source),
          },
        });
        fs.writeFileSync(assPath, ass);
      }

      const videoPath = path.join(jobDir, relativeVideo);
      const captionsPath =
        spec.captions && relativeWords.length > 0 ? assPath : null;

      log(`Rendering clip ${index + 1}/${moments.length}: ${moment.title || baseName}`);
      try {
        await run(
          "ffmpeg",
          buildClipArgs({
            input: source.path,
            output: videoPath,
            start: moment.start,
            end: moment.end,
            fit: spec.fit,
            captionsPath,
            width,
            height,
            fps,
            ...(fontsDir ? { fontsDir } : {}),
          }),
          10 * 60 * 1000 + (moment.end - moment.start) * 2000,
        );

        await run(
          "ffmpeg",
          buildPosterArgs(videoPath, path.join(jobDir, relativePoster), Math.min(1, (moment.end - moment.start) / 2)),
          120_000,
        );
        await run(
          "ffmpeg",
          buildPreviewArgs(videoPath, path.join(jobDir, relativePreview)),
          180_000,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Clip ${index + 1} (${moment.title || baseName}) failed: ${message}`);
        log(`Clip ${index + 1} failed: ${message}`);
        continue;
      }

      const transcription = textForRange(inside, moment.start, moment.end);
      const suggestedDescription = [
        moment.title || transcription.slice(0, 80),
        "",
        captionAttribution(source),
        "Clip cut, captioned and reframed for vertical video.",
      ].join("\n");

      clips.push({
        index: index + 1,
        title: moment.title || `Clip ${index + 1}`,
        hook: moment.hook,
        start: moment.start,
        end: moment.end,
        sourceStart: moment.start + source.window.start,
        sourceEnd: moment.end + source.window.start,
        durationSeconds: Math.round((moment.end - moment.start) * 10) / 10,
        score: moment.score,
        reason: moment.reason,
        path: relativeVideo,
        posterPath: relativePoster,
        previewPath: relativePreview,
        captionsPath: path.relative(jobDir, assPath),
        suggestedTitle: (moment.title || transcription.slice(0, 70)).slice(0, 100),
        suggestedDescription,
      });

      callbacks.onProgress?.("render", {
        type: "clip",
        index: clips.length,
        total: moments.length,
        title: moment.title,
        path: relativeVideo,
      });
    }

    if (clips.length === 0) {
      throw new Error(`Every clip failed to render:\n${warnings.join("\n")}`);
    }

    const result: ClipPipelineResult = {
      kind: "clip",
      title: spec.title ?? source.title,
      source: {
        url: spec.sourceUrl,
        webpageUrl: source.webpageUrl,
        title: source.title,
        ...(source.uploader ? { uploader: source.uploader } : {}),
        durationSeconds: Math.round(source.durationSeconds * 10) / 10,
        wasLive: source.wasLive,
        window: source.window,
      },
      clips,
      transcript: { words: words.length, language: "en" },
      selection,
      width,
      height,
      fps,
      warnings,
    };

    fs.writeFileSync(path.join(clipsDir, "clips.json"), JSON.stringify(result, null, 2));

    callbacks.onStageComplete?.(
      "render",
      `${clips.length} clips`,
      (Date.now() - renderStarted) / 1000,
    );
    callbacks.onProgress?.("render", { type: "results", ...result });

    return result;
  } catch (err) {
    callbacks.onStageError?.(currentStage, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    if (!keepSource) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // A leftover temp directory is not worth failing a finished job over.
      }
    }
  }
}
