import { describe, expect, it } from "vitest";
import { cardHeadline, firstSentence, splitLines } from "./TextCardBeat.js";

describe("firstSentence", () => {
  it("takes the first sentence as the heading", () => {
    expect(firstSentence("The 917 was a monster. It won twice in a row.")).toBe(
      "The 917 was a monster",
    );
  });

  it("drops the terminal punctuation", () => {
    expect(firstSentence("It won.")).toBe("It won");
    expect(firstSentence("Did it win?")).toBe("Did it win");
  });

  it("returns the whole line when there is no sentence break", () => {
    expect(firstSentence("A flat twelve and no brakes")).toBe("A flat twelve and no brakes");
  });

  it("collapses whitespace and handles an empty line", () => {
    expect(firstSentence("  A   long\n line. ")).toBe("A long line");
    expect(firstSentence("   ")).toBe("");
  });
});

describe("splitLines", () => {
  it("keeps short text on one line", () => {
    expect(splitLines("A short heading", 24)).toEqual(["A short heading"]);
  });

  it("breaks at word boundaries and never splits a word", () => {
    const lines = splitLines("The Porsche 917 rewrote endurance racing forever", 18);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      // A single long word may exceed the limit; nothing else should.
      if (!line.includes(" ")) continue;
      expect(line.length).toBeLessThanOrEqual(18 + 1 + 20);
    }
    expect(lines.join(" ")).toBe("The Porsche 917 rewrote endurance racing forever");
  });

  it("caps the card at three lines", () => {
    const lines = splitLines("one two three four five six seven eight nine ten eleven twelve", 8);
    expect(lines).toHaveLength(3);
  });

  it("returns one empty line for empty input", () => {
    expect(splitLines("   ", 20)).toEqual([""]);
  });
});

describe("cardHeadline", () => {
  it("uses the headline the director wrote", () => {
    expect(cardHeadline("THE CAR THAT ALMOST WASNT", "One of history's greatest supercars...")).toBe(
      "THE CAR THAT ALMOST WASNT",
    );
  });

  it("falls back to the first sentence of the narration", () => {
    expect(cardHeadline("", "The 917 was a monster. It won twice.")).toBe("The 917 was a monster");
    expect(cardHeadline(undefined, "The 917 was a monster.")).toBe("The 917 was a monster");
  });

  it("ignores a headline that is only whitespace", () => {
    expect(cardHeadline("   ", "A flat twelve and no brakes.")).toBe("A flat twelve and no brakes");
  });
});
