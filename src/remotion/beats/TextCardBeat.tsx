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
 *
 * The card carries a title, not the narration: the first sentence of the line,
 * so it reads as a chapter heading while the captions carry the script.
 */
export const TextCardBeat: React.FC<SceneProps> = ({
  scriptLine,
  colorPalette,
  textCardFont,
  sceneIndex,
  sceneCount,
  sfxAvailable,
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
  const lines = splitLines(firstSentence(scriptLine), 24);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: bg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 96px",
      }}
    >
      {/* The cut lands on the card */}
      {sfxAvailable && <Audio src={staticFile("sfx/impact.mp3")} volume={0.4} />}

      {/* Rule */}
      <div
        style={{
          width: 96,
          height: 4,
          backgroundColor: accent,
          transformOrigin: "left center",
          transform: `scaleX(${rule})`,
          marginBottom: 36,
        }}
      />

      {/* Words */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.025em",
                color: text,
                opacity: interpolate(lineSpring, [0, 1], [0, 1]),
                transform: `translateY(${interpolate(lineSpring, [0, 1], [20, 0])}px)`,
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
          marginTop: 44,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 20,
          letterSpacing: "0.16em",
          fontVariantNumeric: "tabular-nums",
          color: accent,
          opacity: interpolate(marker, [0, 1], [0, 0.8]),
          transform: `translateY(${interpolate(marker, [0, 1], [8, 0])}px)`,
        }}
      >
        {String((sceneIndex ?? 0) + 1).padStart(2, "0")} /{" "}
        {String(sceneCount ?? 1).padStart(2, "0")}
      </span>
    </AbsoluteFill>
  );
};

/** The part of a line that works as a heading. */
export function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const match = /^(.*?[.!?])(\s|$)/.exec(trimmed);
  return (match?.[1] ?? trimmed).replace(/[.!?]$/, "");
}

/** Break a line into a readable stack of short lines. */
export function splitLines(text: string, maxChars: number): string[] {
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
