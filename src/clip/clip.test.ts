import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assColor, assTime, buildAss, chunkWords, escapeAss, stripUnsupported } from "./captions.js";
import {
  fallbackMoments,
  formatClock,
  normalizeMoments,
  parseTimestamp,
  toMoments,
  type ClipMoment,
} from "./moments.js";
import { attributionFor, runClipPipeline } from "./pipeline.js";
import {
  buildClipArgs,
  buildFilterGraph,
  buildPosterArgs,
  escapeFilterPath,
} from "./render.js";
import type { SourceInfo } from "./source.js";
import { downloadArgs, fatalError, sourceWindow, ytdlpBinary } from "./source.js";
import { normalizeClipSpec } from "./spec.js";
import type { TranscriptWord } from "./transcript.js";

const tmpRoots: string[] = [];

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpRoots) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: a leftover temp directory does not fail the suite.
    }
  }
});

function words(count: number, step = 0.4): TranscriptWord[] {
  return Array.from({ length: count }, (_, index) => ({
    word: `word${index}`,
    start: index * step,
    end: index * step + step * 0.7,
  }));
}

describe("yt-dlp discovery", () => {
  it("explains the bot check instead of blaming the URL", () => {
    const error = fatalError(
      "ERROR: [youtube] abc: Sign in to confirm you are not a bot",
    );
    expect(error.message).toContain("OPENREELS_YTDLP_COOKIES");
    expect(error.message).toContain("OPENREELS_YTDLP_PROXY");
  });

  it("honours an explicit binary override", () => {
    const previous = process.env["OPENREELS_YTDLP_BINARY"];
    process.env["OPENREELS_YTDLP_BINARY"] = "/opt/bin/yt-dlp";
    try {
      expect(ytdlpBinary()).toBe("/opt/bin/yt-dlp");
    } finally {
      if (previous === undefined) delete process.env["OPENREELS_YTDLP_BINARY"];
      else process.env["OPENREELS_YTDLP_BINARY"] = previous;
    }
  });
});

describe("clip spec", () => {
  it("fills in the defaults a caller should not have to send", () => {
    const spec = normalizeClipSpec({ sourceUrl: "https://www.youtube.com/watch?v=abc" });
    expect(spec).toMatchObject({
      count: 3,
      minSeconds: 20,
      maxSeconds: 60,
      fit: "blur",
      captions: true,
      hook: true,
      liveFromStart: false,
      maxSourceMinutes: 60,
    });
  });

  it("rejects an inverted length window", () => {
    expect(() =>
      normalizeClipSpec({ sourceUrl: "https://example.com/v", minSeconds: 80, maxSeconds: 30 }),
    ).toThrow(/maxSeconds/);
  });

  it("rejects an end before the start", () => {
    expect(() =>
      normalizeClipSpec({
        sourceUrl: "https://example.com/v",
        startSeconds: 100,
        endSeconds: 90,
      }),
    ).toThrow(/endSeconds/);
  });

  it("rejects a source that is not a URL", () => {
    expect(() => normalizeClipSpec({ sourceUrl: "not a url" })).toThrow();
  });
});

describe("source window", () => {
  const base = normalizeClipSpec({ sourceUrl: "https://example.com/v" });

  it("caps a long source at the download limit", () => {
    expect(sourceWindow(base, 7200)).toEqual({ start: 0, end: 3600 });
  });

  it("uses the explicit window when one is given", () => {
    const spec = normalizeClipSpec({
      sourceUrl: "https://example.com/v",
      startSeconds: 100,
      endSeconds: 200,
    });
    expect(sourceWindow(spec, 7200)).toEqual({ start: 100, end: 200 });
  });

  it("never lets the explicit window outrun the cap", () => {
    const spec = normalizeClipSpec({
      sourceUrl: "https://example.com/v",
      startSeconds: 100,
      maxSourceMinutes: 5,
    });
    expect(sourceWindow(spec, 7200)).toEqual({ start: 100, end: 400 });
  });

  it("asks for a section only when it is not downloading the whole file", () => {
    const whole = downloadArgs(base, "/tmp/source.%(ext)s", { start: 0, end: 300 }, 300);
    expect(whole.join(" ")).not.toContain("--download-sections");

    const partial = downloadArgs(base, "/tmp/source.%(ext)s", { start: 0, end: 300 }, 7200);
    expect(partial.join(" ")).toContain("--download-sections *0-300");
  });

  it("asks for the section when the window starts late", () => {
    const partial = downloadArgs(base, "/tmp/source.%(ext)s", { start: 600, end: 700 }, 700);
    expect(partial.join(" ")).toContain("--download-sections *600-700");
  });
});

describe("timestamps", () => {
  it("reads mm:ss, hh:mm:ss and plain seconds", () => {
    expect(parseTimestamp("01:30")).toBe(90);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp(42)).toBe(42);
    expect(parseTimestamp("42.5")).toBe(42.5);
  });

  it("refuses values that are not a time", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("later")).toBeNull();
    expect(parseTimestamp(Number.NaN)).toBeNull();
  });

  it("formats a clock as mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(95)).toBe("01:35");
  });
});

describe("moment selection", () => {
  const spec = normalizeClipSpec({
    sourceUrl: "https://example.com/v",
    count: 2,
    minSeconds: 10,
    maxSeconds: 15,
  });

  it("converts the model's answer, dropping moments without usable times", () => {
    const moments = toMoments({
      moments: [
        { start: "00:10", end: "00:25", title: "One", hook: "Hook", score: 80, reason: "Good" },
        { start: "", end: "00:30", title: "Broken", hook: "", score: 50, reason: "" },
      ],
    });
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ start: 10, end: 25, title: "One" });
  });

  it("snaps a cut to the nearest word boundary", () => {
    const transcript = words(40);
    const moments: ClipMoment[] = [
      { start: 1.02, end: 14.9, title: "Snap", hook: "", score: 90, reason: "" },
    ];
    const [normalized] = normalizeMoments(moments, transcript, spec, 20);
    // A start never moves backwards into a word already in progress: 1.02 is
    // just after word2 began, so the cut moves forward to word3's start.
    expect(normalized!.start).toBeCloseTo(1.2, 2);
  });

  it("extends a short moment to the minimum length", () => {
    const transcript = words(60);
    const moments: ClipMoment[] = [
      { start: 0, end: 2, title: "Short", hook: "", score: 90, reason: "" },
    ];
    const [normalized] = normalizeMoments(moments, transcript, spec, 24);
    expect(normalized!.end - normalized!.start).toBeGreaterThanOrEqual(8);
  });

  it("keeps only the higher-scoring moment when two overlap", () => {
    const transcript = words(80);
    const moments: ClipMoment[] = [
      { start: 0, end: 12, title: "First", hook: "", score: 60, reason: "" },
      { start: 2, end: 14, title: "Second", hook: "", score: 90, reason: "" },
    ];
    const accepted = normalizeMoments(moments, transcript, spec, 32);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.title).toBe("Second");
  });

  it("returns no more than the requested count", () => {
    const transcript = words(200);
    const moments: ClipMoment[] = Array.from({ length: 6 }, (_, index) => ({
      start: index * 20,
      end: index * 20 + 12,
      title: `M${index}`,
      hook: "",
      score: 80 - index,
      reason: "",
    }));
    expect(normalizeMoments(moments, transcript, spec, 200)).toHaveLength(2);
  });

  it("tiles a short source so every requested clip is found", () => {
    const transcript = words(50);
    const short = normalizeClipSpec({
      sourceUrl: "https://example.com/v",
      count: 2,
      minSeconds: 8,
      maxSeconds: 12,
    });
    const fallback = fallbackMoments(transcript, short, 18);
    expect(fallback).toHaveLength(2);
    expect(fallback[0]!.end).toBeLessThanOrEqual(fallback[1]!.start + 0.01);
  });

  it("finds speech-dense windows without a model", () => {
    const transcript = words(60);
    const fallback = fallbackMoments(transcript, spec, 24);
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.length).toBeLessThanOrEqual(2);
    for (const moment of fallback) {
      expect(moment.end - moment.start).toBeGreaterThanOrEqual(8);
      expect(moment.end).toBeLessThanOrEqual(24.01);
    }
  });
});

describe("captions", () => {
  it("breaks lines on sentence ends and gaps", () => {
    const lines = chunkWords([
      { word: "The", start: 0, end: 0.2 },
      { word: "car", start: 0.25, end: 0.45 },
      { word: "stopped.", start: 0.5, end: 0.9 },
      { word: "Then", start: 2.0, end: 2.3 },
      { word: "it", start: 2.35, end: 2.45 },
      { word: "burned.", start: 2.5, end: 2.9 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.words.map((w) => w.word)).toEqual(["The", "car", "stopped."]);
  });

  it("never puts more than three words on one line", () => {
    const lines = chunkWords(words(12));
    for (const line of lines) expect(line.words.length).toBeLessThanOrEqual(3);
  });

  it("drops emoji a caption font cannot draw", () => {
    expect(stripUnsupported("fast 🚗🔥 car")).toBe("fast  car");
  });

  it("writes an ASS file with karaoke timing and a hook", () => {
    const ass = buildAss(words(6), { width: 1080, height: 1920, hook: "it burned" });
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Dialogue: 1,");
    expect(ass).toContain("IT BURNED");
    expect(ass).toMatch(/\{\\k\d+\}word0/);
  });

  it("formats ASS times and colours the way libass reads them", () => {
    expect(assTime(3661.25)).toBe("1:01:01.25");
    expect(assColor("#FFC53D")).toBe("&H003DC5FF");
    expect(assColor("#FFFFFF", 128)).toBe("&H80FFFFFF");
  });

  it("escapes braces so a caption cannot inject an override", () => {
    expect(escapeAss("a {\\b1} claim")).toBe("a \\{\\\\b1\\} claim");
  });
});

describe("render arguments", () => {
  it("builds a blurred fill without stretching the frame", () => {
    const graph = buildFilterGraph({ fit: "blur", captionsPath: "/tmp/c.ass" });
    expect(graph).toContain("split=2");
    expect(graph).toContain("gblur=sigma=36");
    expect(graph).toContain("force_original_aspect_ratio=decrease");
  });

  it("fills the frame when asked to crop", () => {
    const graph = buildFilterGraph({ fit: "crop", captionsPath: null });
    expect(graph).toContain("force_original_aspect_ratio=increase");
    expect(graph).toContain("crop=1080:1920");
  });

  it("seeks, trims and never upscales beyond the requested length", () => {
    const args = buildClipArgs({
      input: "/tmp/source.mp4",
      output: "/tmp/out.mp4",
      start: 12.5,
      end: 34.5,
      fit: "blur",
      captionsPath: "/tmp/captions.ass",
    });
    const joined = args.join(" ");
    expect(joined).toContain("-ss 12.500");
    expect(joined).toContain("-t 22.000");
    expect(joined).toContain("ass=filename='/tmp/captions.ass'");
    expect(joined).toContain("loudnorm=I=-14");
    expect(joined).toContain("-c:v libx264");
  });

  it("makes a still from one second into the clip", () => {
    const args = buildPosterArgs("/tmp/clip.mp4", "/tmp/poster.jpg", 1);
    expect(args).toContain("-frames:v");
    expect(args).toContain("1");
  });

  it("escapes a filter path that contains separators", () => {
    expect(escapeFilterPath("/tmp/a:b,c.ass")).toBe("'/tmp/a\\:b\\,c.ass'");
  });
});

function makeSourceVideo(dir: string, seconds = 24): string {
  const file = path.join(dir, "source.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      String(seconds),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-y",
      file,
    ],
    { timeout: 120_000 },
  );
  return file;
}

describe("source attribution", () => {
  it("prefers the channel handle when the source has one", () => {
    expect(attributionFor({ uploader: "@Motorsport" } as SourceInfo)).toBe("@Motorsport");
  });

  it("falls back to the source title so a direct URL is still credited on screen", () => {
    expect(
      attributionFor({ title: "Duck And Cover 1951.webm" } as SourceInfo),
    ).toBe("Duck And Cover 1951");
  });

  it("keeps a long filename inside the watermark budget", () => {
    const credit = attributionFor({ title: "A".repeat(90) } as SourceInfo);
    expect(credit.length).toBeLessThanOrEqual(48);
    expect(credit.endsWith("…")).toBe(true);
  });
});

describe("runClipPipeline", () => {
  it("downloads, transcribes, selects and renders vertical clips end to end", async () => {
    const work = tmpDir("openreels-clip-test-");
    const jobDir = path.join(work, "job");
    fs.mkdirSync(jobDir, { recursive: true });
    const video = makeSourceVideo(work, 24);

    const transcript = Array.from({ length: 60 }, (_, index) => ({
      word: `word${index}`,
      start: index * 0.4,
      end: index * 0.4 + 0.3,
    }));

    const sourceInfo: SourceInfo = {
      path: video,
      title: "Test source",
      uploader: "Test channel",
      durationSeconds: 24,
      webpageUrl: "https://example.com/watch",
      wasLive: false,
      window: { start: 0, end: 24 },
    };

    const stages: string[] = [];
    const result = await runClipPipeline({
      spec: normalizeClipSpec({
        sourceUrl: "https://example.com/watch",
        count: 1,
        minSeconds: 10,
        maxSeconds: 12,
      }),
      jobDir,
      width: 360,
      height: 640,
      download: async () => sourceInfo,
      transcriber: { transcribe: async () => transcript },
      callbacks: {
        onStageStart: (stage) => stages.push(stage),
      },
    });

    expect(stages).toEqual(["source", "transcript", "select", "render"]);
    expect(result.clips).toHaveLength(1);
    expect(result.selection).toBe("fallback");

    const clip = result.clips[0]!;
    const videoPath = path.join(jobDir, clip.path);
    expect(fs.statSync(videoPath).size).toBeGreaterThan(1000);
    expect(fs.existsSync(path.join(jobDir, clip.posterPath))).toBe(true);
    expect(fs.readFileSync(path.join(jobDir, clip.captionsPath), "utf-8")).toContain("[Events]");
    expect(clip.suggestedDescription).toContain("Clipped from: Test source");
    expect(fs.existsSync(path.join(jobDir, "clips", "clips.json"))).toBe(true);

    // The render is actually vertical, not the 640x360 source.
    const probe = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        videoPath,
      ],
      { encoding: "utf-8" },
    ).trim();
    expect(probe).toBe("360,640");
  }, 180_000);
});
