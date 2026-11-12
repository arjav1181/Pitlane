import { describe, expect, it, vi } from "vitest";
import { isRateLimitError, retryAfterMs, withRateLimitRetry } from "./retry.js";

const noSleep = async (_ms: number) => {};

describe("isRateLimitError", () => {
  it("detects HTTP 429 on the error object", () => {
    expect(isRateLimitError(Object.assign(new Error("failed"), { statusCode: 429 }))).toBe(true);
    expect(isRateLimitError({ response: { status: 429 } })).toBe(true);
  });

  it("detects rate-limit wording from gateways", () => {
    expect(isRateLimitError(new Error("Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("RESOURCE_EXHAUSTED: quota exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("rate_limit exceeded"))).toBe(true);
  });

  it("does not treat unrelated errors as rate limits", () => {
    expect(isRateLimitError(new Error("network timeout"))).toBe(false);
    expect(isRateLimitError(new Error("invalid api key"))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("reads the retry-after header in seconds", () => {
    expect(retryAfterMs({ response: { headers: { "retry-after": "7" } } })).toBe(7000);
  });

  it("reads a Headers-like object", () => {
    const headers = new Headers({ "retry-after": "3" });
    expect(retryAfterMs({ response: { headers } })).toBe(3000);
  });

  it("returns null when the header is absent", () => {
    expect(retryAfterMs(new Error("nope"))).toBeNull();
  });
});

describe("withRateLimitRetry", () => {
  it("retries a rate-limited call and returns the eventual result", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Too Many Requests"))
      .mockRejectedValueOnce(Object.assign(new Error("429"), { statusCode: 429 }))
      .mockResolvedValue("ok");
    const sleep = vi.fn(noSleep);

    await expect(withRateLimitRetry(fn, { sleep, random: () => 0.5 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    // 2000 * 0.5 -> 1000, 4000 * 0.5 -> 2000 (0.8 + 0.5 * 0.4 = 1.0)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000]);
  });

  it("honours the provider's Retry-After header", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ statusCode: 429, response: { headers: { "retry-after": "5" } } })
      .mockResolvedValue("ok");
    const sleep = vi.fn(noSleep);

    await expect(withRateLimitRetry(fn, { sleep })).resolves.toBe("ok");
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("does not retry non-rate-limit errors", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("invalid api key"));
    const sleep = vi.fn(noSleep);

    await expect(withRateLimitRetry(fn, { sleep })).rejects.toThrow("invalid api key");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxRetries", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("Too Many Requests"));
    const sleep = vi.fn(noSleep);

    await expect(withRateLimitRetry(fn, { sleep, maxRetries: 2 })).rejects.toThrow(
      "Too Many Requests",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
