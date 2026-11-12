import type React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TEXT_CARD_FONTS } from "../lib/fonts";
import type { SceneProps } from "../lib/score-to-props";

/**
 * A title card.
 *
 * A documentary lower third rather than a poster: a rule that draws in, the
 * words that rise after it, and a chapter marker in mono. Everything sits on
 * the left so the composition has a consistent reading axis, and the palette
 * comes from the archetype so the card belongs to the film around it.
 */
export const TextCardBeat: React.FC<SceneProps> = ({
  scriptLine,
  colorPalette,
  textCardFont,
  sceneIndex,
  sceneCount,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bg = colorPalette?.background ?? "#141414";
  const accent = colorPalette?.accent ?? "#c8a96e";
  const text = colorPalette?.text ?? "#f2efe8";

  // The rule draws first, the words follow it.
  const rule = spring({ frame: frame - 2, fps, config: { damping: 18, stiffness: 120 } });
  const marker = spring({ frame: frame - 16, fps, config: { damping: 20, stiffness: 90 } });

  const family = (textCardFont && TEXT_CARD_FONTS[textCardFont]) ?? "Inter, sans-serif";

  // Break the line into a short stack rather than one long paragraph.
  const lines = splitLines(scriptLine, 26);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${bg} 0%, ${shade(bg, -0.06)} 100%)`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 96px",
      }}
    >
      {/* The cut lands on the card */}
      <Audio src={staticFile("sfx/impact.mp3")} volume={0.4} />

      {/* Rule */}
      <div
        style={{
          width: 96,
          height: 5,
          borderRadius: 3,
          backgroundColor: accent,
          transformOrigin: "left center",
          transform: `scaleX(${rule})`,
          marginBottom: 34,
        }}
      />

      {/* Words */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((line, i) => {
          const lineSpring = spring({
            frame: frame - 10 - i * 4,
            fps,
            config: { damping: 18, stiffness: 120 },
          });
          return (
            <span
              key={i}
              style={{
                display: "block",
                fontFamily: family,
                fontSize: 66,
                fontWeight: 700,
                lineHeight: 1.12,
                letterSpacing: "-0.02em",
                color: text,
                opacity: interpolate(lineSpring, [0, 1], [0, 1]),
                transform: `translateY(${interpolate(lineSpring, [0, 1], [22, 0])}px)`,
              }}
            >
              {line}
            </span>
          );
        })}
      </div>

      {/* Chapter marker */}
      <span
        style={{
          marginTop: 40,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 22,
          letterSpacing: "0.18em",
          color: accent,
          opacity: interpolate(marker, [0, 1], [0, 0.75]),
          transform: `translateY(${interpolate(marker, [0, 1], [10, 0])}px)`,
        }}
      >
        {String(sceneIndex ?? 0).padStart(2, "0")} / {String(sceneCount ?? 1).padStart(2, "0")}
      </span>
    </AbsoluteFill>
  );
};

/** Break a line into a readable stack of short lines. */
function splitLines(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

/** Darken or lighten a hex colour by a fraction of its own luminance. */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1]!, 16);
  const channels = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((c) => {
    const v = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
