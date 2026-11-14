import type React from "react";
import { CAPTION_FONTS } from "../lib/fonts";
import type { CaptionStyleProps } from "./CaptionWrapper";

/**
 * Clean caption style: white text with a strong shadow.
 *
 * The size is set for a phone. A 1080-pixel frame is shown about seven
 * centimetres wide, so 44 pixels of type is a caption you have to look at
 * rather than read: the viewer's eye leaves the picture to decode it. At 58
 * pixels, the words land in one glance and the picture stays the subject.
 *
 * The weight stays constant on purpose. Growing the type as a word is spoken
 * makes the whole line reflow and the words jump sideways, which reads as a
 * glitch rather than as emphasis. The active word is already the brightest
 * thing on the line; that is enough.
 */
export const Clean: React.FC<CaptionStyleProps> = ({ wordStates, onLight }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 10,
      padding: "0 48px",
    }}
  >
    {wordStates.map((ws) => {
      const spoken = ws.state !== "unspoken";
      return (
        <span
          key={`${ws.word.word}-${ws.globalIndex}`}
          style={{
            fontSize: 58,
            fontWeight: 800,
            letterSpacing: "-0.5px",
            // On a light card the words are dark, with a light shadow to
            // lift them. White on cream cannot be read.
            // On cream, 0.55 alpha reads as a watermark: the words that have
            // not been spoken yet look disabled rather than pending. 0.74
            // keeps the active word clearly ahead while the rest of the line
            // stays legible, which is what a viewer needs to read ahead.
            color: onLight
              ? ws.state === "active"
                ? "#111111"
                : `rgba(17,17,17,${spoken ? 0.92 : 0.74})`
              : ws.state === "active"
                ? "#FFFFFF"
                : `rgba(255,255,255,${spoken ? 0.92 : 0.74})`,
            fontFamily: CAPTION_FONTS.inter,
            textShadow: onLight
              ? "0 2px 10px rgba(255,255,255,0.55)"
              : "0 3px 14px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.9)",
          }}
        >
          {ws.word.word}
        </span>
      );
    })}
  </div>
);
