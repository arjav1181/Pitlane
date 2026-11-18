/**
 * Burned captions.
 *
 * Short-form video is watched muted more often than not, so the words are not
 * decoration - they are the sound. The rules come from what the platforms
 * actually reward: two to three words on screen, one thought at a time, a
 * highlight that follows the voice so the eye is pulled along, and a heavy
 * outline so the text survives any footage underneath it.
 *
 * The output is ASS rather than an ffmpeg `drawtext` chain because ASS gives
 * word-level karaoke timing in a single event, which is both cheaper to render
 * and exactly the effect a clip channel expects.
 */

import type { TranscriptWord } from "./transcript.js";

export interface CaptionLine {
  start: number;
  end: number;
  words: TranscriptWord[];
}

export interface CaptionOptions {
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
  /** Distance from the bottom of the frame to the caption block. */
  marginV?: number;
  /** A line burned at the top for the first seconds of the clip. */
  hook?: string;
  /** Small handle in the lower corner, for attribution. */
  watermark?: string;
}

const MAX_WORDS = 3;
const MAX_CHARS = 26;
const SENTENCE_END = /[.!?]$/;
const CLAUSE_END = /[,;:]$/;

/** Drop characters a caption font cannot draw, which would render as boxes. */
export function stripUnsupported(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, "")
    .trim();
}

/**
 * Group words into caption lines.
 *
 * A line ends on a sentence, on a comma if it is already long enough, or when
 * the next word would push it past the character budget. Breaking on time
 * alone produces lines that end mid-phrase ("the car was | going too"), which
 * is harder to read than a slightly uneven line.
 */
export function chunkWords(words: TranscriptWord[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    lines.push({ start: first.start, end: last.end, words: current });
    current = [];
  };

  for (const word of words) {
    const text = stripUnsupported(word.word);
    if (!text) continue;
    const clean = { ...word, word: text };
    const previous = current[current.length - 1];
    const gap = previous ? clean.start - previous.end : 0;
    const length = current.reduce((sum, w) => sum + w.word.length + 1, 0) + text.length;

    if (current.length > 0 && (gap > 0.7 || current.length >= MAX_WORDS || length > MAX_CHARS)) {
      flush();
    }
    current.push(clean);

    if (SENTENCE_END.test(text) && current.length >= 2) {
      flush();
    } else if (CLAUSE_END.test(text) && current.length >= MAX_WORDS - 1) {
      flush();
    }
  }
  flush();

  return lines;
}

/** ASS times are `H:MM:SS.cc`, with centisecond precision and no rounding up. */
export function assTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.min(99, Math.floor((total - Math.floor(total)) * 100));
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

/** `#RRGGBB` to ASS's `&HAABBGGRR`, which is stored backwards and opaque by default. */
export function assColor(hex: string, alpha = 0): string {
  const clean = hex.replace("#", "").trim();
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  const pad = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
  return `&H${pad(a)}${pad(b)}${pad(g)}${pad(r)}`;
}

export function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/** Scale a line's karaoke timing to the words it actually contains. */
function karaoke(line: CaptionLine): string {
  const parts: string[] = [];
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i]!;
    const next = line.words[i + 1];
    const until = next ? next.start : word.end;
    const centis = Math.max(1, Math.round((until - word.start) * 100));
    parts.push(`{\\k${centis}}${escapeAss(word.word)}`);
  }
  return parts.join(" ");
}

export function buildAss(words: TranscriptWord[], options: CaptionOptions): string {
  const {
    width,
    height,
    fontName = "Liberation Sans",
    fontSize = Math.round(width * 0.072),
    marginV = Math.round(height * 0.27),
    hook,
    watermark,
  } = options;

  const hookSize = Math.round(width * 0.058);
  const watermarkSize = Math.round(width * 0.03);
  const outline = Math.max(4, Math.round(width * 0.0055));

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Spoken words are white, unspoken words are dim: the eye follows the
    // bright word, which is the whole point of karaoke captions.
    `Style: Caption,${fontName},${fontSize},${assColor("#FFFFFF")},${assColor("#FFFFFF", 110)},${assColor("#000000")},${assColor("#000000", 160)},-1,0,0,0,100,100,0,0,1,${outline},0,2,60,60,${marginV},1`,
    `Style: Hook,${fontName},${hookSize},${assColor("#FFC53D")},${assColor("#FFC53D")},${assColor("#000000")},${assColor("#000000", 130)},-1,0,0,0,100,100,0,0,1,${Math.max(4, outline - 1)},1,8,70,70,${Math.round(height * 0.16)},1`,
    `Style: Mark,${fontName},${watermarkSize},${assColor("#FFFFFF", 105)},${assColor("#FFFFFF", 105)},${assColor("#000000", 120)},${assColor("#000000", 180)},0,0,0,0,100,100,0,0,1,2,0,2,60,60,${Math.round(height * 0.075)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events: string[] = [];

  if (hook && hook.trim()) {
    events.push(
      `Dialogue: 1,${assTime(0.15)},${assTime(3.4)},Hook,,0,0,0,,{\\fad(140,220)}${escapeAss(stripUnsupported(hook).toUpperCase())}`,
    );
  }

  for (const line of chunkWords(words)) {
    const start = Math.max(0, line.start - 0.05);
    const end = Math.max(start + 0.4, line.end + 0.22);
    events.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,{\\fad(60,40)}${karaoke(line)}`,
    );
  }

  if (watermark && watermark.trim()) {
    const last = words[words.length - 1]?.end ?? 10;
    events.push(
      `Dialogue: 2,${assTime(0)},${assTime(Math.max(last + 1, 1))},Mark,,0,0,0,,${escapeAss(stripUnsupported(watermark))}`,
    );
  }

  return [...header, ...events].join("\n") + "\n";
}
