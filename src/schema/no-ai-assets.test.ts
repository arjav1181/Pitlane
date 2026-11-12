import { describe, expect, it } from "vitest";
import type { DirectorScore, VisualType } from "./director-score.js";
import { isNoAiVisualType, sanitizeScoreForNoAiAssets } from "./no-ai-assets.js";

function makeScore(types: VisualType[]): DirectorScore {
  return {
    emotional_arc: "test",
    archetype: "warm_editorial",
    music_mood: "warm_acoustic",
    scenes: types.map((visual_type, i) => ({
      visual_type,
      visual_prompt: `prompt ${i}`,
      motion: "static",
      script_line: `line ${i}`,
      transition: null,
    })),
  };
}

describe("sanitizeScoreForNoAiAssets", () => {
  it("downgrades ai_image to stock_image", () => {
    const result = sanitizeScoreForNoAiAssets(makeScore(["ai_image", "text_card", "stock_video"]));
    expect(result.score.scenes[0]!.visual_type).toBe("stock_image");
    expect(result.adjustments).toEqual([
      { sceneIndex: 0, from: "ai_image", to: "stock_image", reason: "ai_disabled" },
    ]);
  });

  it("downgrades ai_video to stock_video", () => {
    const result = sanitizeScoreForNoAiAssets(makeScore(["ai_video", "text_card", "stock_image"]));
    expect(result.score.scenes[0]!.visual_type).toBe("stock_video");
  });

  it("leaves stock and text_card scenes untouched", () => {
    const types: VisualType[] = ["stock_image", "stock_video", "text_card", "stock_image"];
    const result = sanitizeScoreForNoAiAssets(makeScore(types));
    expect(result.score.scenes.map((s) => s.visual_type)).toEqual(types);
    expect(result.adjustments).toEqual([]);
  });

  it("preserves the golden rule after downgrading", () => {
    // ai_image, stock_image, ai_image -> stock, stock, stock (invalid)
    const result = sanitizeScoreForNoAiAssets(
      makeScore(["ai_image", "stock_image", "ai_image", "text_card"]),
    );
    expect(result.score.scenes.map((s) => s.visual_type)).toEqual([
      "stock_image",
      "stock_image",
      "stock_video",
      "text_card",
    ]);
  });

  it("uses the other stock type before falling back to text_card", () => {
    const result = sanitizeScoreForNoAiAssets(
      makeScore(["stock_video", "stock_video", "ai_video", "text_card"]),
    );
    // ai_video -> stock_video would be a third in a row, so use stock_image.
    expect(result.score.scenes[2]!.visual_type).toBe("stock_image");
  });

  it("does not mutate the input score", () => {
    const original = makeScore(["ai_image", "stock_image", "ai_image"]);
    sanitizeScoreForNoAiAssets(original);
    expect(original.scenes.map((s) => s.visual_type)).toEqual([
      "ai_image",
      "stock_image",
      "ai_image",
    ]);
  });

  it("keeps every scene when rewriting", () => {
    const result = sanitizeScoreForNoAiAssets(
      makeScore(["ai_video", "ai_image", "stock_video", "text_card"]),
    );
    expect(result.score.scenes).toHaveLength(4);
    expect(result.score.scenes[3]!.script_line).toBe("line 3");
  });
});

describe("isNoAiVisualType", () => {
  it("accepts stock and text types", () => {
    expect(isNoAiVisualType("stock_image")).toBe(true);
    expect(isNoAiVisualType("stock_video")).toBe(true);
    expect(isNoAiVisualType("text_card")).toBe(true);
  });

  it("rejects AI visual types", () => {
    expect(isNoAiVisualType("ai_image")).toBe(false);
    expect(isNoAiVisualType("ai_video")).toBe(false);
  });
});
