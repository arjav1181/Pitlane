export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface Transcript {
  words: TranscriptWord[];
  text: string;
  /** Detected language, when the transcriber reports it. */
  language?: string;
}

/** The narration inside a window, with normal spacing. */
export function textForRange(words: TranscriptWord[], start: number, end: number): string {
  return words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => w.word.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1");
}

/**
 * Round a cut point to the nearest word boundary.
 *
 * A cut in the middle of a word is the most obvious sign that a clip was
 * produced by a machine: the first syllable of the first word is missing, or
 * the last one is cut off. `mode: "start"` moves forward to the next word
 * start, `mode: "end"` moves back to the previous word end, and both fall back
 * to the original time when there is no word within the tolerance.
 */
export function snapToWord(
  words: TranscriptWord[],
  time: number,
  mode: "start" | "end",
  tolerance = 1.5,
): number {
  if (words.length === 0) return time;

  let best = time;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const word of words) {
    const point = mode === "start" ? word.start : word.end;
    const distance = Math.abs(point - time);
    if (distance > tolerance) continue;
    const acceptable = mode === "start" ? point >= time - 0.15 : point <= time + 0.15;
    if (!acceptable) continue;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }

  return best;
}

/** Words per second of actual speech, used to rank fallback windows. */
export function speechDensity(words: TranscriptWord[], start: number, end: number): number {
  if (end <= start) return 0;
  const inside = words.filter((w) => w.start >= start && w.end <= end);
  return inside.length / (end - start);
}
