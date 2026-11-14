import type { DirectorScore } from "../schema/director-score.js";

/**
 * How many procedural cards a video may contain.
 *
 * A card is a strong move the first time and a slideshow by the third. The
 * director is told the limit, but a model drifts, and the cost of drift is
 * paid on screen: three cards in eight scenes turns a documentary short into
 * a deck. This pass makes the limit true regardless of what the model wrote.
 */
export const MAX_TEXT_CARDS = 2;

export interface TextCardCapResult {
  score: DirectorScore;
  /** Indices of the cards that were folded into another scene. */
  merged: number[];
}

/**
 * Keep the first and last card, fold any others into a scene with footage.
 *
 * The first card opens the video and the last asks the question, so those are
 * the two worth keeping. A card in the middle is usually a section title; its
 * line belongs to the nearest scene that has a picture, because a card that
 * absorbs two characters' worth of narration stays on screen for ten seconds
 * and stops being a punctuation mark.
 */
export function capTextCards(score: DirectorScore, max = MAX_TEXT_CARDS): TextCardCapResult {
  const cardIndices = score.scenes
    .map((scene, index) => (scene.visual_type === "text_card" ? index : -1))
    .filter((index) => index >= 0);

  if (cardIndices.length <= max) return { score, merged: [] };

  const keep = new Set<number>();
  if (max >= 2) {
    keep.add(cardIndices[0]!);
    keep.add(cardIndices[cardIndices.length - 1]!);
  } else if (max === 1) {
    // The ending is the one that carries the question.
    keep.add(cardIndices[cardIndices.length - 1]!);
  }

  const removed = new Set(cardIndices.filter((index) => !keep.has(index)));
  const appendTo = new Map<number, string[]>();
  const prependTo = new Map<number, string[]>();
  const orphaned = new Set<number>();

  const hasFootage = (index: number) =>
    !removed.has(index) && score.scenes[index]!.visual_type !== "text_card";

  for (const index of removed) {
    let target = -1;
    let after = false;
    for (let j = index - 1; j >= 0; j--) {
      if (hasFootage(j)) {
        target = j;
        break;
      }
    }
    if (target === -1) {
      for (let j = index + 1; j < score.scenes.length; j++) {
        if (hasFootage(j)) {
          target = j;
          after = true;
          break;
        }
      }
    }
    if (target === -1) {
      orphaned.add(index);
      continue;
    }
    const bucket = after ? prependTo : appendTo;
    const list = bucket.get(target) ?? [];
    list.push(score.scenes[index]!.script_line);
    bucket.set(target, list);
  }

  const scenes: DirectorScore["scenes"] = [];
  for (const [index, scene] of score.scenes.entries()) {
    if (removed.has(index) && !orphaned.has(index)) continue;

    const line = scene.script_line;
    const before = (prependTo.get(index) ?? []).join(" ");
    const after = (appendTo.get(index) ?? []).join(" ");
    const scriptLine = [before, line, after].filter(Boolean).join(" ").trim();

    if (removed.has(index)) {
      // Nothing to fold into: turn the card into a picture scene so its line
      // is still spoken.
      scenes.push({ ...scene, visual_type: "stock_image", script_line: scriptLine });
      continue;
    }

    // Clone so the caller's score is not edited underneath it.
    scenes.push({ ...scene, script_line: scriptLine });
  }

  return { score: { ...score, scenes }, merged: [...removed] };
}
