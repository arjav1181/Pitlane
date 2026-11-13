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

  // If we know the source video duration and it's shorter than the scene, loop it.
  // Exception: AI-generated video clips create visible seams when looped — play once instead.
  // Otherwise, play once with trim (endAt handles videos longer than the scene).
  const needsLoop =
    sourceDurationInSeconds != null &&
    sourceDurationInSeconds < sceneDurationSeconds &&
    visualType !== "ai_video";
  const loopDurationInFrames =
    sourceDurationInSeconds != null ? Math.floor(sourceDurationInSeconds * fps) : durationInFrames;

  const video = assetSrc ? (
    <OffthreadVideo
      src={assetSrc}
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
      {video && (needsLoop ? <Loop durationInFrames={loopDurationInFrames}>{video}</Loop> : video)}
    </SceneGrade>
  );
};
