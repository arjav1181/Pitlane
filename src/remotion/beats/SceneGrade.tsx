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
  /** Short credit burned into the frame, when the licence asks for one. */
  credit?: string;
}> = ({ colorPalette, children, tint = 0.1, credit }) => {
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

      {/* The credit, burned in rather than hidden in the description. It sits
          above the picture and below the caption scrim, at the top of the safe
          area where YouTube's own controls do not cover it. */}
      {credit && (
        <div
          style={{
            position: "absolute",
            top: 96,
            left: 54,
            maxWidth: "84%",
            padding: "7px 12px",
            borderRadius: 6,
            backgroundColor: "rgba(12,12,12,0.46)",
            color: "rgba(255,255,255,0.9)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 19,
            lineHeight: 1.3,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {credit}
        </div>
      )}

      {/* A scrim under the captions, so the words are always readable.
          It reaches up to the caption rail at 24%, because a gradient that
          stops at 34% leaves the words on bare footage, and white text over a
          grey road is the one place a caption disappears. */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.55) 15%, rgba(0,0,0,0.30) 26%, rgba(0,0,0,0) 40%)",
        }}
      />
    </AbsoluteFill>
  );
};
