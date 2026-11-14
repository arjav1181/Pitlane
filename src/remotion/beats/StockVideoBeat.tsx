import type React from "react";
import {
  interpolate,
  Loop,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { SceneProps } from "../lib/score-to-props";
import { SceneGrade } from "./SceneGrade";

/** Slowest a clip may be stretched before looping reads better than slow motion. */
const MIN_PLAYBACK_RATE = 0.65;

/**
 * How a clip fills its scene.
 *
 * A six-second clip in a seven-second scene used to loop, and the restart is a
 * visible jump in the middle of a shot. Stretching it instead is a gentle slow
 * motion that no one notices, as long as the stretch stays modest. A clip that
 * would have to play at a crawl still loops.
 */
export function videoTiming(
  sourceDurationInSeconds: number | null | undefined,
  sceneDurationSeconds: number,
  visualType: string,
  fps: number,
): { playbackRate: number; needsLoop: boolean; loopDurationInFrames: number } {
  const source = sourceDurationInSeconds ?? null;

  // An AI clip is generated at the scene length and shows a seam when looped.
  // Without a known length there is nothing to plan against, so play once.
  if (source == null || visualType === "ai_video" || source >= sceneDurationSeconds) {
    return {
      playbackRate: 1,
      needsLoop: false,
      loopDurationInFrames: Math.round(sceneDurationSeconds * fps),
    };
  }

  const rate = source / sceneDurationSeconds;
  if (rate >= MIN_PLAYBACK_RATE) {
    // Stretch the clip to the scene: no seam, and a slow move suits a car.
    return {
      playbackRate: rate,
      needsLoop: false,
      loopDurationInFrames: Math.round(sceneDurationSeconds * fps),
    };
  }

  // Far too short to stretch: loop it at normal speed.
  return {
    playbackRate: 1,
    needsLoop: true,
    loopDurationInFrames: Math.floor(source * fps),
  };
}

export const StockVideoBeat: React.FC<SceneProps> = ({
  assetSrc,
  sourceDurationInSeconds,
  visualType,
  colorPalette,
  motion,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const sceneDurationSeconds = durationInFrames / fps;
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;

  // A still frame of a car on a road looks like a screenshot. A slow move
  // across the shot is the difference between footage and a picture of
  // footage, and it costs nothing to render.
  const scale = (() => {
    switch (motion) {
      case "zoom_in":
        return interpolate(progress, [0, 1], [1, 1.1]);
      case "zoom_out":
        return interpolate(progress, [0, 1], [1.1, 1]);
      case "pan_left":
      case "pan_right":
        return 1.08;
      default:
        // Even a static shot gets a breath of movement.
        return interpolate(progress, [0, 1], [1.02, 1.07]);
    }
  })();

  const timing = videoTiming(sourceDurationInSeconds, sceneDurationSeconds, visualType, fps);

  const video = assetSrc ? (
    <OffthreadVideo
      src={assetSrc}
      playbackRate={timing.playbackRate}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${scale})`,
      }}
      muted
    />
  ) : null;

  return (
    <SceneGrade colorPalette={colorPalette}>
      {video &&
        (timing.needsLoop ? (
          <Loop durationInFrames={timing.loopDurationInFrames}>{video}</Loop>
        ) : (
          video
        ))}
    </SceneGrade>
  );
};
