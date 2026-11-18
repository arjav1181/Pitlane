/**
 * Cutting one vertical clip with ffmpeg.
 *
 * The renderer does three things in one pass and nothing else: it shapes the
 * frame to 9:16, it burns the captions, and it normalises the audio. Every
 * extra filter is another encode decision that has to be tuned per source, and
 * a clip should look like the source it came from, framed for a phone.
 */

export interface ClipRenderOptions {
  input: string;
  output: string;
  /** Absolute seconds in the downloaded source. */
  start: number;
  end: number;
  fit: "blur" | "crop";
  /** Path to the ASS file, or null to skip captions. */
  captionsPath: string | null;
  /** Directory holding the caption font, when it is not a system font. */
  fontsDir?: string;
  width?: number;
  height?: number;
  fps?: number;
}

export const CLIP_WIDTH = 1080;
export const CLIP_HEIGHT = 1920;
export const CLIP_FPS = 30;

/**
 * Escape a path for use inside an ffmpeg filter argument.
 *
 * A filter graph is a small language of its own: a colon separates options, a
 * comma separates filters, and a quote starts a string. A path with any of
 * those characters in it silently reinterprets the graph, so escape them and
 * wrap the result in quotes.
 */
export function escapeFilterPath(filePath: string): string {
  const escaped = filePath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
  return `'${escaped}'`;
}

function verticalBase(width: number, height: number, fit: "blur" | "crop"): string {
  if (fit === "crop") {
    return (
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,setsar=1[base]`
    );
  }
  // The blurred fill is darkened and desaturated so it never competes with the
  // real frame sitting on top of it. `decrease` keeps the whole source visible,
  // which is right for wide footage where the subject is not centred.
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},gblur=sigma=${Math.round(width / 30)},` +
    `eq=brightness=-0.09:saturation=0.8[bgv];` +
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgv];` +
    `[bgv][fgv]overlay=(W-w)/2:(H-h)/2,setsar=1[base]`
  );
}

export function buildFilterGraph(options: {
  fit: "blur" | "crop";
  captionsPath: string | null;
  fontsDir?: string;
  width?: number;
  height?: number;
  fps?: number;
}): string {
  const width = options.width ?? CLIP_WIDTH;
  const height = options.height ?? CLIP_HEIGHT;
  const fps = options.fps ?? CLIP_FPS;
  const parts = [verticalBase(width, height, options.fit)];

  if (options.captionsPath) {
    const fonts = options.fontsDir ? `:fontsdir=${escapeFilterPath(options.fontsDir)}` : "";
    parts.push(
      `[base]ass=filename=${escapeFilterPath(options.captionsPath)}${fonts},fps=${fps}[v]`,
    );
  } else {
    parts.push(`[base]fps=${fps}[v]`);
  }

  return parts.join(";");
}

export function buildClipArgs(options: ClipRenderOptions): string[] {
  const duration = Math.max(0.1, options.end - options.start);
  const filterGraph = buildFilterGraph({
    fit: options.fit,
    captionsPath: options.captionsPath,
    ...(options.fontsDir ? { fontsDir: options.fontsDir } : {}),
    ...(options.width ? { width: options.width } : {}),
    ...(options.height ? { height: options.height } : {}),
    ...(options.fps ? { fps: options.fps } : {}),
  });

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    options.start.toFixed(3),
    "-i",
    options.input,
    "-t",
    duration.toFixed(3),
    "-filter_complex",
    filterGraph,
    "-map",
    "[v]",
    "-map",
    "0:a:0?",
    "-af",
    "loudnorm=I=-14:TP=-1.5:LRA=11",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-y",
    options.output,
  ];
}

/** A still from one second in, which is past any fade-up from black. */
export function buildPosterArgs(input: string, output: string, at: number): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    Math.max(0.2, at).toFixed(3),
    "-i",
    input,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    output,
  ];
}

/** The first `n` seconds of a clip, used as an animated preview in listings. */
export function buildPreviewArgs(input: string, output: string, seconds = 6): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-t",
    seconds.toFixed(2),
    "-i",
    input,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-vf",
    "scale=540:-2",
    "-an",
    "-movflags",
    "+faststart",
    "-y",
    output,
  ];
}
