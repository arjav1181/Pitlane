import type React from "react";
import { Audio, useCurrentFrame, useVideoConfig } from "remotion";
import type { WordTimestamp } from "../../schema/providers.js";

interface MusicTrackProps {
  src: string;
  /**
   * Absolute word timestamps for the whole voiceover.
   *
   * The music dips while the narrator is speaking and comes back up in the
   * gaps. Without it the bed sits at one level under the voice for the whole
   * video, which is the flattest thing in the mix.
   */
  words?: WordTimestamp[];
}

/** Music level with nothing over it. */
export const MUSIC_VOLUME = 0.16;
/** Music level while the narrator is speaking. */
export const DUCKED_VOLUME = 0.03;
/** Seconds over which the music eases into and out of the duck. */
export const RAMP_S = 0.22;

/**
 * How covered by speech a moment is: 0 in the gaps, 1 under a word.
 *
 * The window around each word is `word ± RAMP_S`, so the ramp is symmetric
 * and the music is already down when the first syllable lands. A long word
 * covers more than the ramp on both sides, so the result is clamped - without
 * that the duck can exceed 1 and the mix goes negative, which Remotion
 * rejects.
 */
export function duckAt(timeSeconds: number, words: readonly WordTimestamp[]): number {
  let duck = 0;
  for (const word of words) {
    const from = word.start - RAMP_S;
    const to = word.end + RAMP_S;
    if (timeSeconds < from || timeSeconds > to) continue;
    const depth = Math.min(timeSeconds - from, to - timeSeconds) / RAMP_S;
    if (depth > duck) duck = depth;
  }
  return Math.max(0, Math.min(1, duck));
}

/** Music level for a moment, clamped to a legal Remotion volume. */
export function musicVolumeAt(timeSeconds: number, words: readonly WordTimestamp[]): number {
  const duck = duckAt(timeSeconds, words);
  const volume = MUSIC_VOLUME + (DUCKED_VOLUME - MUSIC_VOLUME) * duck;
  return Math.max(0, Math.min(1, volume));
}

export const MusicTrack: React.FC<MusicTrackProps> = ({ src, words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const volume = musicVolumeAt(frame / fps, words ?? []);
  return <Audio src={src} volume={volume} loop />;
};
