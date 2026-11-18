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

export interface ClosingCardResult {
  score: DirectorScore;
  /** Indices of footage scenes that gained the answer. */
  moved: number[];
}

/**
 * The closing card asks; the last shot answers.
 *
 * A model will happily put the payoff on the card because that is where the
 * sentence naturally lands, leaving the final shot as filler and the card as a
 * paragraph. The rule for the format is the other way round: the last piece
 * of footage carries the name and the reason, and the card carries only the
 * question that makes someone comment.
 */
export function moveClosingConclusionToFootage(score: DirectorScore): ClosingCardResult {
  const scenes = score.scenes;
  if (scenes.length < 2) return { score, moved: [] };

  const lastIndex = scenes.length - 1;
  if (scenes[lastIndex]!.visual_type !== "text_card") return { score, moved: [] };

  let target = -1;
  for (let i = lastIndex - 1; i >= 0; i--) {
    if (scenes[i]!.visual_type !== "text_card") {
      target = i;
      break;
    }
  }
  if (target < 0) return { score, moved: [] };

  const parts = scenes[lastIndex]!.script_line
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { score, moved: [] };

  const isQuestion = (part: string) => part.endsWith("?");
  // A direct ask stays on the card even when it is an imperative rather than
  // a question: "Comment below." is part of the call to action, not an answer.
  const isCallToAction = (part: string) =>
    /^(comment|drop|tell|share|subscribe|follow|post|vote|reply|let)\b/i.test(part);

  const onCard = parts.filter((part) => isQuestion(part) || isCallToAction(part));
  const answer = parts.filter((part) => !isQuestion(part) && !isCallToAction(part));
  if (answer.length === 0) return { score, moved: [] };
  // Never leave a card with no words on it.
  if (onCard.length === 0) onCard.push(answer.pop()!);

  const next = scenes.map((scene, index) => {
    if (index === target) {
      return { ...scene, script_line: `${scene.script_line} ${answer.join(" ")}`.trim() };
    }
    if (index === lastIndex) {
      return { ...scene, script_line: onCard.join(" ") };
    }
    return scene;
  });

  return { score: { ...score, scenes: next }, moved: [target] };
}

/**
 * Keep the camera moving one way across a cut.
 *
 * A zoom-out answered by a zoom-in is the most common seam error in a short:
 * the eye reads the reversal as a mistake, not a transition, because the
 * outgoing shot recedes and the incoming one pushes at the same instant. Stock
 * clips carry a slow push by default, so a lone zoom-out in the middle of a
 * film is the reversal, whether or not the director meant it.
 *
 * A pull is still allowed where it means something: the first shot after a
 * card (a new chapter starts from rest) and the last footage before the closing
 * card (the arrival beat). Everywhere else the scene is turned into a push.
 */
export interface MotionContinuityResult {
  score: DirectorScore;
  /** Indices of scenes whose zoom-out was turned into a zoom-in. */
  flipped: number[];
}

export function enforceMotionContinuity(score: DirectorScore): MotionContinuityResult {
  const flipped: number[] = [];
  const scenes = score.scenes.map((scene, index) => {
    if (scene.motion !== "zoom_out") return scene;

    const previousIsCard = index === 0 || score.scenes[index - 1]!.visual_type === "text_card";
    const isLastFootage = score.scenes
      .slice(index + 1)
      .every((later) => later.visual_type === "text_card");
    if (previousIsCard || isLastFootage) return scene;

    flipped.push(index);
    return { ...scene, motion: "zoom_in" as const };
  });

  return { score: flipped.length > 0 ? { ...score, scenes } : score, flipped };
}

/**
 * Keep the cuts a film, not a showreel of effects.
 *
 * A director that reads "vary transitions" varies them scene by scene, and a
 * short with a wipe, then a slide, then a crossfade, then a flip reads as a
 * template: the eye starts watching the effect instead of the machine. A cut
 * is the default, and the only soft transition a chapter needs is a crossfade
 * into a text card - the moment the film stops showing and starts telling.
 */
export interface TransitionDisciplineResult {
  score: DirectorScore;
  /** Indices of scenes whose transition was reduced to a hard cut. */
  reset: number[];
}

export function enforceTransitionDiscipline(score: DirectorScore): TransitionDisciplineResult {
  const reset: number[] = [];
  let changed = false;
  const scenes = score.scenes.map((scene, index) => {
    const next = score.scenes[index + 1];
    const intoCard = next?.visual_type === "text_card";
    const choice = scene.transition ?? "none";

    if (choice === "crossfade" && intoCard) return scene;
    // A null transition falls back to the archetype default in the renderer,
    // and one archetype defaults to a 3D flip. The cut is made explicit here
    // so that fallback can never fire.
    if (choice === "none") {
      if (scene.transition === "none") return scene;
      changed = true;
      return { ...scene, transition: "none" as const };
    }
    reset.push(index);
    changed = true;
    return { ...scene, transition: "none" as const };
  });

  return { score: changed ? { ...score, scenes } : score, reset };
}

/**
 * Open on the film, not on a slide.
 *
 * The first frame is what the feed shows while the viewer decides whether to
 * stop scrolling, and a title card there is a rectangle where a car should be.
 * The card's narration is not lost: its line joins the first footage scene, so
 * the hook is still spoken - now over a picture, which is the thing that makes
 * someone stay.
 */
export interface FootageOpeningResult {
  score: DirectorScore;
  merged: boolean;
}

export function enforceFootageOpening(score: DirectorScore): FootageOpeningResult {
  const [first, second, ...rest] = score.scenes;
  if (!first || !second) return { score, merged: false };
  if (first.visual_type !== "text_card") return { score, merged: false };
  // Two cards in a row is the cap's problem, not this rule's.
  if (second.visual_type === "text_card") return { score, merged: false };

  const script = [first.script_line.trim(), second.script_line.trim()]
    .filter(Boolean)
    .join(" ");

  return {
    score: {
      ...score,
      scenes: [{ ...second, script_line: script }, ...rest],
    },
    merged: true,
  };
}
