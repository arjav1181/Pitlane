import type React from "react";
import { AbsoluteFill } from "remotion";
import type { SceneProps } from "../lib/score-to-props";

/**
 * The look that every scene shares.
 *
 * Stock footage arrives raw: whatever colour the camera saw, whatever the
 * light was doing. Dropped next to a styled card it looks like two videos
 * stitched together, which is one of the tells of a video nobody made. The
 * grade gives every scene the same voice: a little more contrast, a little
 * less colour, the archetype's accent laid over it, and a vignette that pulls
 * the eye to the middle of the frame.
 *
 * It is all CSS, so it costs the render nothing.
 */
export const SceneGrade: React.FC<{
  colorPalette?: SceneProps["colorPalette"];
  children: React.ReactNode;
  /** How strongly the archetype colour is laid over the scene. */
  tint?: number;
}> = ({ colorPalette, children, tint = 0.1 }) => {
  const accent = colorPalette?.accent ?? "#c8a96e";

  return (
    <AbsoluteFill>
      {children}

      {/* The archetype colour, laid over the picture. */}
      <AbsoluteFill
        style={{
          backgroundColor: accent,
          opacity: tint,
          mixBlendMode: "soft-light",
        }}
      />

      {/* The vignette: the edges fall away, the middle holds. */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(105% 75% at 50% 45%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.42) 100%)",
        }}
      />

      {/* A scrim under the captions, so the words are always readable. */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.18) 18%, rgba(0,0,0,0) 34%)",
        }}
      />
    </AbsoluteFill>
  );
};
