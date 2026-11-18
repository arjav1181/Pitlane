import { describe, expect, it } from "vitest";
import { formatCreditLine, formatOnScreenCredit } from "./credits.js";

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
      'Credits: "Bertha Benz 1889.jpg", Unknown author (CC BY-SA 4.0) https://commons.wikimedia.org/wiki/File:Bertha_Benz_1889.jpg. Images and footage are cropped, colour-graded and resized for a vertical video.',
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
    expect(line.length).toBeLessThanOrEqual(1800);
    // A line that ends mid-URL is broken attribution, so every link that
    // survives is a complete file page.
    for (const url of line.match(/https:\/\/\S+/g) ?? []) {
      expect(url.replace(/\.$/, "").endsWith(".jpg")).toBe(true);
    }
  });
});


describe("formatOnScreenCredit", () => {
  it("names the author, the library and the licence", () => {
    const line = formatOnScreenCredit({
      author: "Jane Doe",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Lohner-Porsche.jpg",
    });
    expect(line).toBe("Photo: Jane Doe / Wikimedia Commons · CC BY-SA 4.0");
  });

  it("keeps the credit when the author is unknown", () => {
    const line = formatOnScreenCredit({
      author: "Unknown author",
      license: "Public domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Benz.jpg",
    });
    expect(line).toBe("Photo: Wikimedia Commons · Public domain");
  });

  it("shortens a long author instead of dropping the credit", () => {
    const line = formatOnScreenCredit({
      author: "A".repeat(80),
      license: "CC BY 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Long.jpg",
    });
    expect(line.length).toBeLessThan(90);
    expect(line).toContain("…");
  });

  it("returns nothing when there is no credit", () => {
    expect(formatOnScreenCredit(null)).toBe("");
  });
});

describe("formatOnScreenCredit for footage", () => {
  it("calls a clip footage, not a photo", () => {
    const line = formatOnScreenCredit(
      {
        author: "Jane Doe",
        license: "Pexels License",
        sourceUrl: "https://www.pexels.com/video/123",
      },
      "video",
    );
    expect(line).toBe("Footage: Jane Doe / Pexels");
  });

  it("does not name Commons for a library clip", () => {
    const line = formatOnScreenCredit({
      author: "Jane Doe",
      license: "Pexels License",
      sourceUrl: "https://www.pexels.com/video/123",
    });
    expect(line).toBe("Photo: Jane Doe / Pexels");
  });
});

describe("formatCreditLine limits", () => {
  const asset = (i: number) => ({
    author: `Author ${i}`,
    license: "CC BY-SA 4.0",
    sourceUrl: `https://commons.wikimedia.org/wiki/File:Car_${i}.jpg`,
    label: `Car ${i}`,
  });

  it("keeps whole credits instead of cutting a URL", () => {
    const line = formatCreditLine(Array.from({ length: 40 }, (_, i) => asset(i)));
    expect(line.length).toBeLessThanOrEqual(1800);
    // Every URL that remains is complete.
    for (const url of line.match(/https:\/\/\S+/g) ?? []) {
      expect(url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:Car_\d+\.jpg\.?$/);
    }
  });

  it("separates credits so two authors are not read as one", () => {
    const line = formatCreditLine([asset(1), asset(2)]);
    expect(line).toContain(" | ");
  });

  it("does not print a noun when the work has no title", () => {
    const line = formatCreditLine([
      { author: "Jane Doe", license: "Pexels License", sourceUrl: "https://www.pexels.com/video/1/" },
    ]);
    expect(line).toContain("Credits: Jane Doe (Pexels License) https://www.pexels.com/video/1/");
    expect(line).toContain("cropped");
  });
});
