import { describe, expect, it } from "vitest";
import type { DirectorScore, Scene } from "../schema/director-score.js";
import { capTextCards } from "./score-guards.js";

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
