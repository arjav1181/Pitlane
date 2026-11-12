import type { DirectorScore, Scene, VisualType } from "./director-score.js";

/**
 * Visual types allowed when AI asset generation is disabled.
 * Stock media is still downloaded from Pexels/Pixabay and text cards are
 * rendered procedurally by Remotion, so no AI image or video provider is used.
 */
export const NO_AI_VISUAL_TYPES: readonly VisualType[] = [
  "stock_image",
  "stock_video",
  "text_card",
];

/** The stock type an AI visual type is downgraded to in no-AI-assets mode. */
const AI_TO_STOCK: Partial<Record<VisualType, VisualType>> = {
  ai_image: "stock_image",
  ai_video: "stock_video",
};

export interface NoAiAdjustment {
  sceneIndex: number;
  from: VisualType;
  to: VisualType;
  reason: "ai_disabled" | "golden_rule";
}

export interface NoAiSanitizeResult {
  score: DirectorScore;
  adjustments: NoAiAdjustment[];
}

/**
 * Rewrite a DirectorScore so it only uses stock assets and procedural text cards.
 *
 * AI visual types are downgraded to their closest stock equivalent. The mapper
 * also keeps the DIRECTOR GOLDEN RULE (no visual type three times in a row) by
 * turning a would-be third consecutive stock scene into a procedural text card.
 *
 * This is a deterministic safety net: the Creative Director is instructed not
 * to emit AI types in this mode, but replay scores and model drift can still
 * introduce them.
 */
export function sanitizeScoreForNoAiAssets(score: DirectorScore): NoAiSanitizeResult {
  const adjustments: NoAiAdjustment[] = [];
  const scenes: Scene[] = [];

  for (let i = 0; i < score.scenes.length; i++) {
    const scene = score.scenes[i]!;
    const original = scene.visual_type;
    let visualType = original;

    // 1. Downgrade AI visual types to stock equivalents.
    const stockEquivalent = AI_TO_STOCK[visualType];
    if (stockEquivalent) {
      visualType = stockEquivalent;
    }

    // 2. Preserve the golden rule after the rewrite.
    const prev1 = scenes[i - 1]?.visual_type;
    const prev2 = scenes[i - 2]?.visual_type;
    if (visualType === prev1 && prev1 === prev2) {
      // Prefer the other stock type, falling back to a procedural text card.
      const alternative =
        visualType === "stock_image"
          ? "stock_video"
          : visualType === "stock_video"
            ? "stock_image"
            : "text_card";
      visualType = alternative === prev1 ? "text_card" : alternative;
    }

    if (visualType !== original) {
      adjustments.push({
        sceneIndex: i,
        from: original,
        to: visualType,
        reason: original === "ai_image" || original === "ai_video" ? "ai_disabled" : "golden_rule",
      });
    }

    scenes.push({ ...scene, visual_type: visualType });
  }

  return {
    score: { ...score, scenes },
    adjustments,
  };
}

/** Whether a visual type is allowed when AI assets are disabled. */
export function isNoAiVisualType(visualType: VisualType): boolean {
  return NO_AI_VISUAL_TYPES.includes(visualType);
}
