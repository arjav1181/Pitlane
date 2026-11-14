import { getArchetype } from "../../config/archetype-registry.js";
import type { ArchetypeConfig } from "../../schema/archetype";
import type { DirectorScore, Scene, TransitionType } from "../../schema/director-score";
import type { WordTimestamp } from "../../schema/providers";

export interface SceneProps {
  visualType: string;
  assetSrc: string | null;
  motion: string;
  visualPrompt: string;
  scriptLine: string;
  durationInFrames: number;
  words: WordTimestamp[];
  colorPalette?: ArchetypeConfig["colorPalette"];
  textCardFont?: string;
  motionIntensity?: number;
  startFrom?: number;
  sourceDurationInSeconds?: number;
  transition: TransitionType;
  transitionDurationFrames: number;
  /** Position of this scene in the short, for the chapter marker. */
  sceneIndex?: number;
  sceneCount?: number;
  /** Whether the sound cues were copied next to the render. */
  sfxAvailable?: boolean;
}

export interface CompositionProps {
  scenes: SceneProps[];
  captionStyle: string;
  voiceoverSrc: string | null;
  musicSrc: string | null;
  // Absolute word timestamps for the entire voiceover (timeline-centric captions + music ducking)
  allWords: WordTimestamp[];
  // Caption theming from archetype
  captionAccentColor: string;
  captionChunkSize: number;
  /** Whether the sound cues were copied next to the render. */
  sfxAvailable?: boolean;
  captionLingerS: number;
}

export interface ResolvedAssets {
  sceneAssets: (string | null)[];
  voiceoverPath: string | null;
  musicPath: string | null;
  sceneWords: WordTimestamp[][]; // per-scene words (for duration calculation only)
  allWords: WordTimestamp[]; // full absolute timestamps from TTS
  sceneSourceDurations: (number | null)[]; // source video durations in seconds (stock_video and ai_video)
}

export function mapScoreToProps(
  score: DirectorScore,
  assets: ResolvedAssets,
  fps: number = 30,
): CompositionProps {
  const archetype = getArchetype(score.archetype);

  const scenes: SceneProps[] = score.scenes.map((scene, i) => {
    const words = assets.sceneWords[i] ?? [];
    // Duration = voiceover duration for this scene, minimum 2 seconds
    const lastWord = words[words.length - 1];
    const firstWord = words[0];
    const voiceoverDuration = lastWord && firstWord ? lastWord.end - firstWord.start : 3;
    const durationSeconds = Math.max(voiceoverDuration + 0.5, 2);
    const durationInFrames = Math.round(durationSeconds * fps);

    // Detect AI fallback: if the score says stock/ai_video but the asset is a PNG,
    // the resolver fell back to AI image generation.
    const assetSrc = assets.sceneAssets[i] ?? null;
    let visualType = scene.visual_type;
    let motion = scene.motion;
    if (
      (visualType === "stock_video" || visualType === "stock_image" || visualType === "ai_video") &&
      assetSrc?.endsWith("-ai.png")
    ) {
      visualType = "ai_image";
      // ai_video scenes use motion="static" since the video provides motion.
      // On fallback to still image, force Ken Burns zoom so it's not completely static.
      if (motion === "static") {
        motion = "zoom_in";
      }
    }

    ({ visualType, motion } = reconcileVisualType(visualType, assetSrc, motion));

    // No asset (stock miss with AI fallback disabled, generation failure, etc.)
    // renders as a procedural text card instead of a blank frame.
    let visualPrompt = scene.visual_prompt;
    if (visualType !== "text_card" && !assetSrc) {
      visualType = "text_card";
      // A stock scene's prompt is a search query ("modern luxury mercedes benz
      // factory"). Printing it on the fallback card leaks the machinery and
      // reads as a caption nobody wrote, so the card shows the line instead.
      visualPrompt = "";
    }

    return {
      visualType,
      assetSrc,
      motion,
      visualPrompt,
      scriptLine: scene.script_line,
      durationInFrames,
      words, // per-scene words kept for scene duration calc, not used for captions
      colorPalette: archetype.colorPalette,
      textCardFont: archetype.textCardFont,
      motionIntensity: archetype.motionIntensity,
      startFrom: 0,
      sourceDurationInSeconds: assets.sceneSourceDurations[i] ?? undefined,
      transition: scene.transition ?? archetype.defaultTransition ?? "none",
      transitionDurationFrames: archetype.transitionDurationFrames ?? 15,
      sceneIndex: i,
      sceneCount: score.scenes.length,
    };
  });

  return {
    scenes,
    captionStyle: archetype.captionStyle,
    voiceoverSrc: assets.voiceoverPath,
    musicSrc: assets.musicPath,
    allWords: assets.allWords,
    captionAccentColor: archetype.colorPalette.accent,
    captionChunkSize: archetype.captionChunkSize ?? 5,
    captionLingerS: archetype.captionLingerS ?? 0.3,
  };
}


/** File extensions that are a picture rather than a moving picture. */
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v"];

/**
 * Make the scene type tell the truth about the asset it was given.
 *
 * A `stock_video` scene can end up with a still: the resolver tries an image
 * when no clip can be found, and a Wikimedia result can be a photograph rather
 * than footage. The renderer picks its player from the type, so a JPEG handed
 * to the video player waits on a frame that never arrives and the whole render
 * times out at the delayRender budget. The asset decides, not the plan.
 */
export function reconcileVisualType(
  visualType: Scene["visual_type"],
  assetSrc: string | null,
  motion: Scene["motion"],
): { visualType: Scene["visual_type"]; motion: Scene["motion"] } {
  if (!assetSrc) return { visualType, motion };
  const lower = assetSrc.toLowerCase();
  const isImage = IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
  const isVideo = VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));

  if (visualType === "stock_video" && isImage) {
    return {
      visualType: "stock_image",
      // A still needs a move, or the scene reads as a frozen frame.
      motion: motion === "static" ? "zoom_in" : motion,
    };
  }
  if (visualType === "stock_image" && isVideo) {
    return { visualType: "stock_video", motion };
  }
  return { visualType, motion };
}

export function getTotalDurationInFrames(props: CompositionProps, fps: number = 30): number {
  const sceneDuration = props.scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
  const transitionOverlap = props.scenes.reduce((sum, s, i) => {
    if (i < props.scenes.length - 1 && s.transition !== "none") {
      return sum + s.transitionDurationFrames;
    }
    return sum;
  }, 0);

  const adjusted = sceneDuration - transitionOverlap;

  // Voiceover is the spine — composition must be at least as long as voiceover.
  // If overlap causes a deficit, extend the last scene to fill the visual gap.
  const voiceoverEnd = props.allWords[props.allWords.length - 1]?.end ?? 0;
  const minFrames = Math.ceil(voiceoverEnd * fps);

  // WARNING: This mutates props.scenes[last].durationInFrames to prevent black frames.
  // Only call once per render pass. Calling twice on the same props will grow the last scene unboundedly.
  const lastScene = props.scenes[props.scenes.length - 1];
  if (adjusted < minFrames && lastScene) {
    const deficit = minFrames - adjusted;
    // Guard: don't extend ai_video scenes past their source duration to prevent looping.
    // AI-generated video clips create visible seams when looped, unlike stock footage.
    if (lastScene.visualType === "ai_video" && lastScene.sourceDurationInSeconds) {
      const maxFrames = Math.ceil(lastScene.sourceDurationInSeconds * fps);
      const originalDuration = lastScene.durationInFrames;
      const cappedDuration = Math.min(originalDuration + deficit, maxFrames);
      lastScene.durationInFrames = cappedDuration;
      return sceneDuration - transitionOverlap + (cappedDuration - originalDuration);
    }
    lastScene.durationInFrames += deficit;
    return minFrames;
  }

  return adjusted;
}
