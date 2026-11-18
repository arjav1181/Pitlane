import { describe, expect, it } from "vitest";
import type { DirectorScore, Scene } from "../schema/director-score.js";
import {
  capTextCards,
  enforceFootageOpening,
  enforceMotionContinuity,
  enforceTransitionDiscipline,
  moveClosingConclusionToFootage,
} from "./score-guards.js";

const card = (script: string, prompt = "A heading"): Scene => ({
  visual_type: "text_card",
  visual_prompt: prompt,
  motion: "static",
  script_line: script,
  transition: null,
});

const shot = (script: string): Scene => ({
  visual_type: "stock_image",
  visual_prompt: "a car",
  motion: "zoom_in",
  script_line: script,
  transition: null,
});

const scoreOf = (scenes: Scene[]): DirectorScore => ({
  emotional_arc: "curiosity-to-wisdom",
  archetype: "vintage_snapshot",
  music_mood: "warm_acoustic",
  scenes,
});

describe("capTextCards", () => {
  it("leaves a video with two cards alone", () => {
    const score = scoreOf([card("Open."), shot("A car."), card("Comment below.")]);
    const result = capTextCards(score);
    expect(result.merged).toEqual([]);
    expect(result.score.scenes).toHaveLength(3);
  });

  it("folds a middle card into the scene before it", () => {
    // Three cards in eight scenes is a slideshow. The middle one is a section
    // title, and its line works as the end of the scene before it.
    const score = scoreOf([
      card("The first car."),
      shot("A workshop."),
      card("The repairs."),
      shot("A road."),
      card("Join the conversation."),
    ]);
    const result = capTextCards(score);

    expect(result.merged).toEqual([2]);
    expect(result.score.scenes.map((s) => s.visual_type)).toEqual([
      "text_card",
      "stock_image",
      "stock_image",
      "text_card",
    ]);
    expect(result.score.scenes[1]!.script_line).toBe("A workshop. The repairs.");
  });

  it("folds every card between the hook and the ending", () => {
    const score = scoreOf([
      card("Hook."),
      card("One."),
      card("Two."),
      shot("A car."),
      card("Ending."),
    ]);
    const result = capTextCards(score);
    expect(result.merged).toEqual([1, 2]);
    expect(result.score.scenes.map((s) => s.visual_type)).toEqual(["text_card", "stock_image", "text_card"]);
    // Both folded lines land on the picture scene that follows them, in the
    // order they were written.
    expect(result.score.scenes[1]!.script_line).toBe("One. Two. A car.");
  });

  it("does not lose the words of a card it removes", () => {
    const score = scoreOf([card("Hook."), shot("A car."), card("A fact worth hearing."), card("Ending.")]);
    const before = score.scenes.map((s) => s.script_line).join(" ");
    const result = capTextCards(score);
    const after = result.score.scenes.map((s) => s.script_line).join(" ");
    expect(after.split(/\s+/).sort()).toEqual(before.split(/\s+/).sort());
  });

  it("keeps the limit configurable", () => {
    const score = scoreOf([card("A."), shot("B."), card("C.")]);
    // With one card allowed, the ending is the one worth keeping; the opening
    // card becomes a picture scene so its line is still spoken.
    const one = capTextCards(score, 1);
    expect(one.score.scenes.map((s) => s.visual_type)).toEqual(["stock_image", "text_card"]);
    expect(one.score.scenes[0]!.script_line).toBe("A. B.");
    // With none allowed, both cards go and their words stay.
    const none = capTextCards(score, 0);
    expect(none.score.scenes.every((s) => s.visual_type === "stock_image")).toBe(true);
    expect(none.score.scenes.map((s) => s.script_line).join(" ")).toContain("C.");
  });
});

describe("enforceMotionContinuity", () => {
  const moving = (motion: Scene["motion"], type: Scene["visual_type"] = "stock_image"): Scene => ({
    ...shot("A car."),
    visual_type: type,
    motion,
  });

  it("turns a zoom-out in the middle of a film into a push", () => {
    const score = scoreOf([moving("zoom_in"), moving("zoom_out"), moving("zoom_in")]);
    const result = enforceMotionContinuity(score);
    expect(result.flipped).toEqual([1]);
    expect(result.score.scenes[1]!.motion).toBe("zoom_in");
  });

  it("keeps a pull that opens a new chapter after a card", () => {
    const score = scoreOf([moving("zoom_in"), card("Chapter."), moving("zoom_out")]);
    expect(enforceMotionContinuity(score).flipped).toEqual([]);
  });

  it("keeps the arrival pull on the last footage before the closing card", () => {
    const score = scoreOf([moving("zoom_in"), moving("zoom_out"), card("Question?")]);
    expect(enforceMotionContinuity(score).flipped).toEqual([]);
  });

  it("leaves pans and static scenes alone", () => {
    const score = scoreOf([moving("pan_left"), moving("static"), moving("zoom_in")]);
    const result = enforceMotionContinuity(score);
    expect(result.flipped).toEqual([]);
    expect(result.score.scenes.map((s) => s.motion)).toEqual(["pan_left", "static", "zoom_in"]);
  });
});

describe("enforceTransitionDiscipline", () => {
  const withTransition = (visual: Scene["visual_type"], transition: Scene["transition"]): Scene => ({
    ...shot("A car."),
    visual_type: visual,
    transition,
  });

  it("turns a tour of effects into cuts", () => {
    const score = scoreOf([
      withTransition("stock_image", "wipe"),
      withTransition("stock_image", "slide_left"),
      withTransition("stock_image", "flip"),
    ]);
    const result = enforceTransitionDiscipline(score);
    expect(result.score.scenes.map((s) => s.transition)).toEqual(["none", "none", "none"]);
    expect(result.reset).toEqual([0, 1, 2]);
  });

  it("keeps the crossfade into a text card", () => {
    const score = scoreOf([withTransition("stock_image", "crossfade"), card("The point.")]);
    const result = enforceTransitionDiscipline(score);
    expect(result.score.scenes[0]!.transition).toBe("crossfade");
    expect(result.reset).toEqual([]);
  });

  it("cuts a crossfade between two shots", () => {
    const score = scoreOf([
      withTransition("stock_image", "crossfade"),
      withTransition("stock_video", "none"),
    ]);
    const result = enforceTransitionDiscipline(score);
    expect(result.score.scenes[0]!.transition).toBe("none");
  });

  it("makes a null transition explicit so no archetype default can fire", () => {
    const score = scoreOf([shot("A car."), card("The point.")]);
    const result = enforceTransitionDiscipline(score);
    expect(result.score.scenes[0]!.transition).toBe("none");
    expect(result.reset).toEqual([]);
  });
});

describe("moveClosingConclusionToFootage", () => {
  it("puts the answer on the last shot and leaves only the question on the card", () => {
    const score = scoreOf([
      shot("The RS200 was built for domination."),
      shot("At Rally Portugal it ploughed into the crowd."),
      card("The Ford RS200 carried the highest death toll. Which car was the deadliest? Comment below."),
    ]);

    const result = moveClosingConclusionToFootage(score);
    expect(result.moved).toEqual([1]);
    expect(result.score.scenes[1]!.script_line).toContain("The Ford RS200 carried the highest death toll.");
    expect(result.score.scenes[2]!.script_line).toBe(
      "Which car was the deadliest? Comment below.",
    );
    // The caller's score must not be edited in place.
    expect(score.scenes[2]!.script_line).toContain("The Ford RS200");
  });

  it("leaves a card that only asks alone", () => {
    const score = scoreOf([shot("A car."), card("Which one would you pick? Comment below.")]);
    expect(moveClosingConclusionToFootage(score).moved).toEqual([]);
  });

  it("never empties the card when every sentence is a statement", () => {
    const score = scoreOf([shot("A car."), card("It was fast. It was also lethal.")]);
    const result = moveClosingConclusionToFootage(score);
    expect(result.score.scenes[1]!.script_line).toBe("It was also lethal.");
    expect(result.score.scenes[0]!.script_line).toContain("It was fast.");
  });

  it("does nothing when the film does not end on a card", () => {
    const score = scoreOf([card("A heading."), shot("The answer.")]);
    expect(moveClosingConclusionToFootage(score).moved).toEqual([]);
  });
});

describe("enforceFootageOpening", () => {
  it("moves the opening card's line onto the first shot", () => {
    const score = scoreOf([card("The car with no clutch."), shot("It had pedals.")]);
    const result = enforceFootageOpening(score);
    expect(result.merged).toBe(true);
    expect(result.score.scenes).toHaveLength(1);
    expect(result.score.scenes[0]!.visual_type).toBe("stock_image");
    expect(result.score.scenes[0]!.script_line).toBe("The car with no clutch. It had pedals.");
  });

  it("leaves a film that already opens on a picture alone", () => {
    const score = scoreOf([shot("A car."), card("The point.")]);
    const result = enforceFootageOpening(score);
    expect(result.merged).toBe(false);
    expect(result.score).toBe(score);
  });

  it("does not reorder two cards in a row", () => {
    const score = scoreOf([card("One."), card("Two."), shot("Three.")]);
    const result = enforceFootageOpening(score);
    expect(result.merged).toBe(false);
    expect(result.score.scenes).toHaveLength(3);
  });

  it("handles a film that is only a card", () => {
    const score = scoreOf([card("Only.")]);
    expect(enforceFootageOpening(score).merged).toBe(false);
  });
});
