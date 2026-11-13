import type React from "react";
import { CAPTION_FONTS } from "../lib/fonts";
import type { CaptionStyleProps } from "./CaptionWrapper";

/**
 * Clean caption style: minimalist white text with subtle shadow.
 * Active word springs slightly larger and brighter. Spoken words settle.
 */
export const Clean: React.FC<CaptionStyleProps> = ({ wordStates, onLight }) => (
  <div
    style={{
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 8,
      padding: "0 40px",
    }}
  >
    {wordStates.map((ws) => {
      const fontSize = 44 + ws.springProgress * 8; // 44 -> 52
      return (
        <span
          key={`${ws.word.word}-${ws.globalIndex}`}
          style={{
            fontSize,
            fontWeight: ws.state === "unspoken" ? 500 : 700,
            // On a light card the words are dark, with a light shadow to
            // lift them. White on cream cannot be read.
            color: onLight
              ? ws.state === "unspoken"
                ? "rgba(20,20,20,0.45)"
                : ws.state === "active"
                  ? "#141414"
                  : "rgba(20,20,20,0.8)"
              : ws.state === "unspoken"
                ? "rgba(255,255,255,0.4)"
                : ws.state === "active"
                  ? "#FFFFFF"
                  : "rgba(255,255,255,0.75)",
            fontFamily: CAPTION_FONTS.inter,
            textShadow: onLight
              ? "0 2px 10px rgba(255,255,255,0.85)"
              : "0 2px 10px rgba(0,0,0,0.7)",
          }}
        >
          {ws.word.word}
        </span>
      );
    })}
  </div>
);
