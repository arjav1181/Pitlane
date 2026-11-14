import { describe, expect, it } from "vitest";
import { cutFiller, joinScriptLines, normalizeNarration, splitLongSentences } from "./narration.js";

describe("normalizeNarration", () => {
  it("spells out percent", () => {
    expect(normalizeNarration("Forty percent of the field.")).toBe("Forty percent of the field.");
    expect(normalizeNarration("40% of the field braked early.")).toBe(
      "40 percent of the field braked early.",
    );
  });

  it("spells out units", () => {
    expect(normalizeNarration("It ran at 320 km/h.")).toBe(
      "It ran at 320 kilometres per hour.",
    );
    expect(normalizeNarration("580 hp and 4.5 litres.")).toBe("580 horsepower and 4.5 litres.");
    expect(normalizeNarration("It weighed 1,200 kg.")).toBe("It weighed 1,200 kilograms.");
  });

  it("rewrites abbreviations", () => {
    expect(normalizeNarration("Rear engines, e.g. the 911, won.")).toBe(
      "Rear engines, for example the 911, won.",
    );
    expect(normalizeNarration("Porsche vs. Ferrari.")).toBe("Porsche versus Ferrari.");
  });

  it("turns a dash into a pause, not a word", () => {
    expect(normalizeNarration("The 917 — a monster — won twice.")).toBe(
      "The 917, a monster, won twice.",
    );
    expect(normalizeNarration("It won -- twice.")).toBe("It won, twice.");
  });

  it("handles ampersands, currency and degrees", () => {
    expect(normalizeNarration("R&D spent $4.5 on it.")).toBe("R and D spent 4.5 dollars on it.");
    expect(normalizeNarration("It ran at 90°C.")).toBe("It ran at 90 degrees Celsius.");
  });

  it("removes parentheses in favour of a pause", () => {
    expect(normalizeNarration("The 917 (1969) was quick.")).toBe("The 917, 1969, was quick.");
  });

  it("leaves years, decimals and model names alone", () => {
    expect(normalizeNarration("In 1969 the 917's 4.5-litre flat twelve won.")).toBe(
      "In 1969 the 917's 4.5-litre flat twelve won.",
    );
  });

  it("gives the narrator a full stop", () => {
    expect(normalizeNarration("No full stop here")).toBe("No full stop here.");
  });

  it("is idempotent", () => {
    const once = normalizeNarration("40% of the field ran at 320 km/h, e.g. the 917 & the 962.");
    expect(normalizeNarration(once)).toBe(once);
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeNarration("   ")).toBe("");
  });
});

describe("splitLongSentences", () => {
  it("leaves a short sentence alone", () => {
    expect(splitLongSentences("A short line.", 10)).toBe("A short line.");
  });

  it("breaks at a comma rather than an arbitrary word", () => {
    const line =
      "The 917 was fast, the 917 was fragile, and the drivers knew both of those things before they ever left the pits.";
    const split = splitLongSentences(line, 12);

    expect(split.length).toBeGreaterThan(line.indexOf("and the drivers"));
    // It broke on a comma, and the continuation starts with a capital.
    expect(split).toMatch(/,\s+[A-Z]/);
  });

  it("keeps every word", () => {
    const line =
      "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.";
    const split = splitLongSentences(line, 5);
    const words = (text: string) =>
      text.toLowerCase().replace(/[,.;:!?]/g, "").split(/\s+/).filter(Boolean);

    expect(words(split)).toEqual(words(line));
  });
});

describe("joinScriptLines", () => {
  it("keeps the sentence boundary between scenes", () => {
    expect(joinScriptLines(["The hook", "The middle.", "The call to action"])).toBe(
      "The hook. The middle. The call to action.",
    );
  });

  it("drops empty lines", () => {
    expect(joinScriptLines(["One.", "  ", "Two."])).toBe("One. Two.");
  });
});

describe("cutFiller", () => {
  it("deletes the adverbs that add nothing", () => {
    expect(cutFiller("He firmly set out to prove Ferrari wrong.")).toBe(
      "He set out to prove Ferrari wrong.",
    );
    expect(cutFiller("A truly legendary automotive rivalry.")).toBe("A legendary automotive rivalry.");
    expect(cutFiller("The car was completely destroyed in the crash.")).toBe(
      "The car was destroyed in the crash.",
    );
  });

  it("keeps the word when removing it would change the meaning", () => {
    expect(cutFiller("It is not really a car.")).toBe("It is not really a car.");
    expect(cutFiller("He never actually drove it.")).toBe("He never actually drove it.");
  });

  it("leaves a short line alone", () => {
    expect(cutFiller("Very fast.")).toBe("Very fast.");
    expect(cutFiller("Truly.")).toBe("Truly.");
  });

  it("runs before the narrator sees the script", () => {
    expect(normalizeNarration("He firmly set out to prove Ferrari completely wrong.")).toBe(
      "He set out to prove Ferrari wrong.",
    );
  });
});
