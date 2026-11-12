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
const MUSIC_VOLUME = 0.16;
/** Music level while the narrator is speaking. */
const DUCKED_VOLUME = 0.03;
/** Seconds over which the music eases into and out of the duck. */
const RAMP_S = 0.22;

export const MusicTrack: React.FC<MusicTrackProps> = ({ src, words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // How covered by speech the current moment is: 0 in the gaps, 1 mid-word.
  let duck = 0;
  for (const word of words ?? []) {
    const from = word.start - RAMP_S;
    const to = word.end + RAMP_S;
    if (t < from || t > to) continue;
    const depth = Math.min(t - from, to - t) / RAMP_S;
    if (depth > duck) duck = depth;
  }

  const volume = MUSIC_VOLUME + (DUCKED_VOLUME - MUSIC_VOLUME) * duck;
  return <Audio src={src} volume={volume} loop />;
};
