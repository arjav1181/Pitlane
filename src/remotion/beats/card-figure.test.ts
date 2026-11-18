import { describe, expect, it } from "vitest";
import { cardFigure } from "./card-figure";

describe("cardFigure", () => {
  it("reads a spoken year", () => {
    expect(cardFigure("Ferdinand Porsche built the first hybrid in nineteen hundred.")?.year).toBe(
      1900,
    );
    expect(cardFigure("The 917 raced at Le Mans in nineteen sixty-nine.")?.year).toBe(1969);
  });

  it("reads a spoken year with a hyphenated tail and 'oh'", () => {
    expect(cardFigure("Benz patented the Motorwagen in eighteen eighty-six.")?.year).toBe(1886);
    expect(cardFigure("They raced it in nineteen oh five.")?.year).toBe(1905);
  });

  it("reads a four-digit year", () => {
    expect(cardFigure("The F40 arrived in 1987.")?.year).toBe(1987);
  });

  it("does not mistake a model number for a year", () => {
    expect(cardFigure("The 917 had more power than the tyres could take.")).toBeNull();
  });

  it("places the year inside the drawn range", () => {
    const figure = cardFigure("It happened in nineteen hundred.");
    expect(figure?.position).toBeGreaterThan(0);
    expect(figure?.position).toBeLessThan(1);
  });

  it("returns nothing when the line has no year", () => {
    expect(cardFigure("The engine drove the front wheels directly.")).toBeNull();
  });
});
