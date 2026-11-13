import { describe, expect, it } from "vitest";
import {
  DUCKED_VOLUME,
  duckAt,
  MUSIC_VOLUME,
  musicVolumeAt,
  RAMP_S,
} from "./MusicTrack.js";

const word = (start: number, end: number) => ({ word: "x", start, end }) as never;

describe("duckAt", () => {
  it("is quiet in the gap between words", () => {
    expect(duckAt(2.0, [word(0, 1), word(3, 4)])).toBe(0);
  });

  it("is fully ducked in the middle of a word", () => {
    expect(duckAt(0.5, [word(0, 1)])).toBe(1);
  });

  it("ramps in over the window before a word", () => {
    const words = [word(1, 1.4)];
    expect(duckAt(1 - RAMP_S, words)).toBe(0);
    const half = duckAt(1 - RAMP_S / 2, words);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
  });

  it("stays at 1 for a word much longer than the ramp", () => {
    // A two second word used to push the duck above 1, which drove the
    // computed volume negative and Remotion rejected the render.
    expect(duckAt(1, [word(0, 2)])).toBe(1);
  });
});

describe("musicVolumeAt", () => {
  it("stays inside a legal volume for every shape of word", () => {
    const words = [word(0, 0.2), word(0.2, 2.4), word(2.4, 2.6), word(5, 5.1)];
    for (let t = -1; t <= 7; t += 0.05) {
      const volume = musicVolumeAt(t, words);
      expect(volume).toBeGreaterThanOrEqual(0);
      expect(volume).toBeLessThanOrEqual(1);
    }
  });

  it("sits at the bed level with no words at all", () => {
    expect(musicVolumeAt(3, [])).toBe(MUSIC_VOLUME);
  });

  it("ducks to the speech level under a word", () => {
    const volume = musicVolumeAt(1, [word(0, 2)]);
    expect(volume).toBeCloseTo(DUCKED_VOLUME, 6);
  });
});
