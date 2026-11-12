import type { DirectorScoreScene } from "@/hooks/useApi";
import { withApiKey } from "@/lib/apiKey";

/** Tracks scenes where stock/video assets fell back to AI generation. */
export type SceneFallbacks = Record<number, "ai_image" | "ai_video_to_image">;

/**
 * Construct the URL for a scene's visual asset.
 * Returns null for text_card scenes (no asset file).
 *
 * When a stock scene falls back to AI image during pipeline execution,
 * the file is saved as scene-{i}-ai.png instead of scene-{i}-stock.jpg.
 * Pass `fallbacks` so the URL points to the actual file on disk.
 */
export function getSceneAssetUrl(
  jobId: string,
  runDir: string,
  scene: DirectorScoreScene,
  index: number,
  fallbacks?: SceneFallbacks,
): string | null {
  const base = `/api/v1/jobs/${jobId}/artifacts/${runDir}/assets`;
  const fb = fallbacks?.[index];

  // Stock scenes that fell back to AI image
  if (fb === "ai_image" || fb === "ai_video_to_image") {
    return withApiKey(`${base}/scene-${index}-ai.png`);
  }

  switch (scene.visual_type) {
    case "ai_image":
      return withApiKey(`${base}/scene-${index}-ai.png`);
    case "ai_video":
      return withApiKey(`${base}/scene-${index}-ai-video.mp4`);
    case "stock_image":
      return withApiKey(`${base}/scene-${index}-stock.jpg`);
    case "stock_video":
      return withApiKey(`${base}/scene-${index}-stock.mp4`);
    case "text_card":
      return null;
  }
}

/**
 * A still frame for a scene, or null when the scene has no still.
 *
 * Video scenes have no poster frame on disk - the asset is the clip itself -
 * so a thumbnail pointing at one renders as a broken image. Only still
 * scenes can be used as a poster.
 */
export function getScenePosterUrl(
  jobId: string,
  runDir: string,
  scene: DirectorScoreScene,
  index: number,
  fallbacks?: SceneFallbacks,
): string | null {
  const url = getSceneAssetUrl(jobId, runDir, scene, index, fallbacks);
  if (!url) return null;
  return url.endsWith(".mp4") ? null : url;
}

/**
 * The first still frame of a finished short, used as its poster.
 *
 * Walks the scenes in order and returns the first one that has a still, so
 * a short whose first scene is footage still gets a picture.
 */
export function firstPosterUrl(
  jobId: string,
  runDir: string,
  scenes: DirectorScoreScene[] | undefined,
  fallbacks?: SceneFallbacks,
): string | null {
  if (!scenes) return null;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    const url = getScenePosterUrl(jobId, runDir, scene, i, fallbacks);
    if (url) return url;
  }
  return null;
}
