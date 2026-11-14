import { describe, expect, it } from "vitest";
import { videoTiming } from "./StockVideoBeat.js";

describe("videoTiming", () => {
  it("stretches a slightly short clip instead of looping it", () => {
    // A six-second clip in a seven-second scene: 0.857x, a gentle slow motion.
    const timing = videoTiming(6, 7, "stock_video", 30);
    expect(timing.needsLoop).toBe(false);
    expect(timing.playbackRate).toBeCloseTo(6 / 7, 5);
  });

  it("plays a clip that is long enough at normal speed", () => {
    const timing = videoTiming(9, 6, "stock_video", 30);
    expect(timing.needsLoop).toBe(false);
    expect(timing.playbackRate).toBe(1);
  });

  it("loops a clip that would have to crawl", () => {
    // Two seconds cannot fill seven at a watchable speed.
    const timing = videoTiming(2, 7, "stock_video", 30);
    expect(timing.needsLoop).toBe(true);
    expect(timing.playbackRate).toBe(1);
    expect(timing.loopDurationInFrames).toBe(60);
  });

  it("never stretches an AI clip", () => {
    const timing = videoTiming(4, 7, "ai_video", 30);
    expect(timing.needsLoop).toBe(false);
    expect(timing.playbackRate).toBe(1);
  });

  it("plays once when the length is unknown", () => {
    const timing = videoTiming(null, 7, "stock_video", 30);
    expect(timing.needsLoop).toBe(false);
    expect(timing.playbackRate).toBe(1);
    expect(timing.loopDurationInFrames).toBe(210);
  });

  it("stops at the shortest acceptable stretch", () => {
    // 4.54s in a 7s scene is exactly 0.65x: still a stretch.
    const timing = videoTiming(4.55, 7, "stock_video", 30);
    expect(timing.needsLoop).toBe(false);
    // 4.5s is below the line: loop instead.
    expect(videoTiming(4.5, 7, "stock_video", 30).needsLoop).toBe(true);
  });
});
