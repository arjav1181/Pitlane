import { z } from "zod";
import type { ClipSpec } from "./spec.js";
import { speechDensity, snapToWord, textForRange, type TranscriptWord } from "./transcript.js";

export interface ClipMoment {
  start: number;
  end: number;
  /** Title for the clip listing, 3-8 words. */
  title: string;
  /** The line burned at the top of the clip, 3-6 words. */
  hook: string;
  /** 0-100 prediction of how well the clip holds a viewer. */
  score: number;
  reason: string;
}

/** Transcript text with a timestamp every few words, for the selection prompt. */
export function formatTranscriptForPrompt(words: TranscriptWord[], everyWords = 12): string {
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += everyWords) {
    const chunk = words.slice(i, i + everyWords);
    const first = chunk[0];
    if (!first) continue;
    lines.push(`[${formatClock(first.start)}] ${chunk.map((w) => w.word.trim()).join(" ")}`);
  }
  return lines.join("\n");
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * What the model answers.
 *
 * Timestamps are accepted as either seconds or `mm:ss` because small models
 * drift between the two, and normalising after the fact is cheaper than a
 * retry. Everything else is permissive on purpose: a clip with a plain title
 * is still a usable clip, so a missing field must not fail the job.
 */
export const MomentSelectionSchema = z.object({
  moments: z
    .array(
      z.object({
        start: z.union([z.number(), z.string()]),
        end: z.union([z.number(), z.string()]),
        title: z.string().default(""),
        hook: z.string().default(""),
        score: z.number().default(50),
        reason: z.string().default(""),
      }),
    )
    .max(20),
});

export type MomentSelection = z.infer<typeof MomentSelectionSchema>;

/**
 * The selection prompt.
 *
 * The model is not asked for "the best parts" - that returns the loudest
 * twenty seconds. It is asked for self-contained moments with a hook, a
 * complete thought and a reason someone would stop scrolling, which is the
 * only thing that separates a clip from a random cut.
 */
export function momentSystemPrompt(spec: ClipSpec): string {
  return [
    "You are the editor of a short-form vertical video channel. You read transcripts and choose the moments that work as standalone clips.",
    "",
    "A moment must:",
    "- start at the beginning of a sentence, never mid-thought or mid-word",
    "- end on a complete thought, so the last line lands",
    "- contain a hook in the first three seconds: a number, a contradiction, a mistake, a question, a strong claim",
    "- make sense with no other context; a clip that needs the previous minute is not a clip",
    "- avoid introductions, sponsor reads, housekeeping, subscribe requests and goodbyes",
    "",
    `Each clip must be between ${Math.round(spec.minSeconds)} and ${Math.round(spec.maxSeconds)} seconds long.`,
    "Prefer spoken words over silence or music. Do not choose two moments that overlap.",
    "",
    "Score each moment 0-100 for how likely a scrolling viewer is to watch it to the end. Be honest: 70 is a good clip, 90 is exceptional, 40 is filler.",
    "Write the hook as 3-6 words that would stop a thumb - a question, a number, or a claim from the clip. It is burned on screen, so it must be true to the moment.",
    "Write the title as 3-8 words for a clip listing.",
  ].join("\n");
}

export function momentUserMessage(
  words: TranscriptWord[],
  sourceDuration: number,
  spec: ClipSpec,
): string {
  return [
    `Source length: ${formatClock(sourceDuration)}. Choose at most ${spec.count} moments.`,
    "",
    "Transcript, with the start time of each line:",
    formatTranscriptForPrompt(words),
  ].join("\n");
}

/** Read `mm:ss`, `hh:mm:ss`, or a plain number of seconds. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds;
}

/** Convert the model's answer into moments, dropping the ones without times. */
export function toMoments(selection: MomentSelection): ClipMoment[] {
  const moments: ClipMoment[] = [];
  for (const item of selection.moments) {
    const start = parseTimestamp(item.start);
    const end = parseTimestamp(item.end);
    if (start === null || end === null || end <= start) continue;
    moments.push({
      start,
      end,
      title: item.title.trim().slice(0, 80),
      hook: item.hook.trim().slice(0, 60),
      score: Math.max(0, Math.min(100, item.score)),
      reason: item.reason.trim().slice(0, 300),
    });
  }
  return moments;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Turn whatever the model returned into clips that can actually be rendered.
 *
 * Boundaries snap to words so no cut lands mid-syllable, the length window is
 * enforced by moving the end first (the hook matters more than the tail), and
 * two moments that overlap are the same moment: only the higher score survives.
 */
export function normalizeMoments(
  moments: ClipMoment[],
  words: TranscriptWord[],
  spec: ClipSpec,
  sourceDuration: number,
): ClipMoment[] {
  const usable: ClipMoment[] = [];

  for (const moment of moments) {
    let start = Math.max(0, Math.min(moment.start, sourceDuration - 1));
    let end = Math.max(0, Math.min(moment.end, sourceDuration));

    start = snapToWord(words, start, "start");
    end = snapToWord(words, end, "end");

    const minEnd = start + spec.minSeconds;
    const maxEnd = start + spec.maxSeconds;

    if (end < minEnd) {
      // Extend to the next word boundary past the minimum, so the clip ends
      // on speech rather than on silence.
      const next = words.find((w) => w.end >= minEnd);
      end = Math.min(next ? next.end + 0.3 : minEnd, Math.min(maxEnd, sourceDuration));
    }
    if (end > maxEnd) {
      const previous = [...words].reverse().find((w) => w.end <= maxEnd);
      end = previous ? previous.end + 0.2 : maxEnd;
    }
    if (end > sourceDuration) end = sourceDuration;
    if (end - start < spec.minSeconds - 2) continue;
    if (end <= start + 5) continue;

    usable.push({
      ...moment,
      start: round(start),
      end: round(end),
      title: moment.title || textForRange(words, start, end).slice(0, 60) || "Clip",
    });
  }

  const accepted: ClipMoment[] = [];
  for (const moment of [...usable].sort((a, b) => b.score - a.score)) {
    const overlaps = accepted.some(
      (other) => Math.min(other.end, moment.end) - Math.max(other.start, moment.start) > 0.5,
    );
    if (overlaps) continue;
    accepted.push(moment);
    if (accepted.length >= spec.count) break;
  }

  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Pick moments without a model.
 *
 * Used when the LLM is unavailable or answers with something unusable: a clip
 * job that found no model should still produce clips, because the transcript
 * already knows where the speech is.
 *
 * The source is split into one segment per requested clip and the densest
 * window inside each segment wins. That is the difference between a fallback
 * that covers the whole video and one that only looks at the first two minutes;
 * dense speech is not the same as a good hook, so these are honest,
 * unremarkable clips rather than none.
 */
export function fallbackMoments(
  words: TranscriptWord[],
  spec: ClipSpec,
  sourceDuration: number,
): ClipMoment[] {
  const segment = sourceDuration / spec.count;
  const target = Math.min(spec.maxSeconds, Math.max(spec.minSeconds, segment * 0.9));
  const candidates: ClipMoment[] = [];
  const step = Math.max(1, Math.min(5, target / 10));

  for (let index = 0; index < spec.count; index++) {
    const segmentStart = index * segment;
    const segmentEnd = Math.min(sourceDuration, (index + 1) * segment);
    const latestStart = Math.max(segmentStart, segmentEnd - target);

    let best: { start: number; end: number; density: number } | null = null;
    for (let start = segmentStart; start <= latestStart + 0.01; start += step) {
      const end = Math.min(start + target, segmentEnd);
      if (end - start < spec.minSeconds - 1) continue;
      const density = speechDensity(words, start, end);
      if (!best || density > best.density) best = { start, end, density };
    }
    if (!best || best.density <= 0) continue;

    const snappedStart = snapToWord(words, best.start, "start", 2);
    const snappedEnd = snapToWord(words, best.end, "end", 2);
    if (snappedEnd - snappedStart < spec.minSeconds - 2) continue;

    candidates.push({
      start: snappedStart,
      end: snappedEnd,
      title: textForRange(words, snappedStart, snappedEnd).slice(0, 60),
      hook: "",
      score: Math.round(Math.min(100, best.density * 120)),
      reason: "Selected by speech density",
    });
  }

  return normalizeMoments(candidates, words, spec, sourceDuration);
}
