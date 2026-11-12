import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFTHREAD_CACHE_BYTES,
  DEFAULT_RENDER_TIMEOUT_MS,
  resolveRenderOptions,
} from "./render-options.js";

describe("resolveRenderOptions", () => {
  it("defaults to a timeout that survives a CPU-only box", () => {
    const options = resolveRenderOptions({});
    expect(options.timeoutInMilliseconds).toBe(DEFAULT_RENDER_TIMEOUT_MS);
    expect(options.timeoutInMilliseconds).toBeGreaterThan(30_000);
  });

  it("defaults to a single browser tab and a fixed frame cache", () => {
    const options = resolveRenderOptions({});
    expect(options.concurrency).toBe(1);
    expect(options.offthreadVideoCacheSizeInBytes).toBe(DEFAULT_OFFTHREAD_CACHE_BYTES);
  });

  it("reads the timeout from the environment", () => {
    const options = resolveRenderOptions({ OPENREELS_RENDER_TIMEOUT_MS: "300000" });
    expect(options.timeoutInMilliseconds).toBe(300_000);
  });

  it("reads concurrency and cache size from the environment", () => {
    const options = resolveRenderOptions({
      OPENREELS_RENDER_CONCURRENCY: "2",
      OPENREELS_RENDER_OFFTHREAD_CACHE_MB: "512",
    });
    expect(options.concurrency).toBe(2);
    expect(options.offthreadVideoCacheSizeInBytes).toBe(512 * 1024 * 1024);
  });

  it("falls back to the defaults for invalid values", () => {
    const options = resolveRenderOptions({
      OPENREELS_RENDER_TIMEOUT_MS: "not-a-number",
      OPENREELS_RENDER_CONCURRENCY: "0",
      OPENREELS_RENDER_OFFTHREAD_CACHE_MB: "-5",
    });
    expect(options.timeoutInMilliseconds).toBe(DEFAULT_RENDER_TIMEOUT_MS);
    expect(options.concurrency).toBe(1);
    expect(options.offthreadVideoCacheSizeInBytes).toBe(DEFAULT_OFFTHREAD_CACHE_BYTES);
  });

  it("never returns a zero cache size, which Remotion rejects", () => {
    const options = resolveRenderOptions({ OPENREELS_RENDER_OFFTHREAD_CACHE_MB: "0" });
    expect(options.offthreadVideoCacheSizeInBytes).toBeGreaterThan(0);
  });
});
