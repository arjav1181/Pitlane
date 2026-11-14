import { describe, expect, it } from "vitest";
import { formatCreditLine } from "./credits.js";

describe("formatCreditLine", () => {
  it("names the work, the author, the licence and the source", () => {
    const line = formatCreditLine([
      {
        label: "Bertha Benz 1889.jpg",
        author: "Unknown author",
        license: "CC BY-SA 4.0",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Bertha_Benz_1889.jpg",
      },
    ]);
    expect(line).toBe(
      'Credits: "Bertha Benz 1889.jpg", Unknown author (CC BY-SA 4.0) https://commons.wikimedia.org/wiki/File:Bertha_Benz_1889.jpg',
    );
  });

  it("credits a file used twice only once", () => {
    const credit = {
      label: "Ford Model T.jpg",
      author: "Jane Doe",
      license: "CC0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Ford_Model_T.jpg",
    };
    const line = formatCreditLine([credit, credit]);
    expect(line.match(/Ford Model T/g)).toHaveLength(1);
  });

  it("has nothing to say when nothing needs crediting", () => {
    expect(formatCreditLine([])).toBe("");
    expect(formatCreditLine(undefined)).toBe("");
  });

  it("never grows past the slice the description gives it", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      label: `Photo number ${i} of a very long caption that keeps going.jpg`,
      author: "A photographer with a long name",
      license: "CC BY-SA 4.0",
      sourceUrl: `https://commons.wikimedia.org/wiki/File:Photo_${i}.jpg`,
    }));
    const line = formatCreditLine(many);
    expect(line.length).toBeLessThanOrEqual(900);
    expect(line.endsWith("…")).toBe(true);
  });
});
