import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeCallbackUrl,
  type CallbackPayload,
  callbackAllowsEvent,
  deliverCallback,
  isPrivateAddress,
  signCallbackPayload,
  UnsafeCallbackUrlError,
  validateCallbackUrlSyntax,
} from "./callbacks.js";

describe("isPrivateAddress", () => {
  it("detects loopback, private, link-local, and CGNAT IPv4", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it("accepts public IPv4", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "1.1.1.1"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  it("detects IPv6 loopback, unique-local, link-local, and multicast", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("detects IPv4-mapped loopback", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("fails closed for malformed addresses", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
  });
});

describe("validateCallbackUrlSyntax", () => {
  it("accepts http and https URLs", () => {
    expect(validateCallbackUrlSyntax("https://example.com/hook").hostname).toBe("example.com");
    expect(validateCallbackUrlSyntax("http://example.com:8080/hook").port).toBe("8080");
  });

  it("rejects non-http protocols", () => {
    expect(() => validateCallbackUrlSyntax("ftp://example.com")).toThrow(UnsafeCallbackUrlError);
    expect(() => validateCallbackUrlSyntax("file:///etc/passwd")).toThrow(UnsafeCallbackUrlError);
  });

  it("rejects credentials in the URL", () => {
    expect(() => validateCallbackUrlSyntax("https://user:pass@example.com")).toThrow(
      UnsafeCallbackUrlError,
    );
  });

  it("rejects invalid and overly long URLs", () => {
    expect(() => validateCallbackUrlSyntax("not a url")).toThrow(UnsafeCallbackUrlError);
    expect(() => validateCallbackUrlSyntax(`https://example.com/${"a".repeat(3000)}`)).toThrow(
      UnsafeCallbackUrlError,
    );
  });
});

describe("assertSafeCallbackUrl", () => {
  it("rejects localhost", async () => {
    await expect(assertSafeCallbackUrl("http://localhost:3000/hook")).rejects.toThrow(
      UnsafeCallbackUrlError,
    );
  });

  it("rejects private IP literals", async () => {
    await expect(assertSafeCallbackUrl("http://127.0.0.1/hook")).rejects.toThrow(
      UnsafeCallbackUrlError,
    );
    await expect(assertSafeCallbackUrl("http://[::1]/hook")).rejects.toThrow(
      UnsafeCallbackUrlError,
    );
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    await expect(
      assertSafeCallbackUrl("https://internal.example/hook", {
        resolve: async () => ["10.0.0.5"],
      }),
    ).rejects.toThrow(UnsafeCallbackUrlError);
  });

  it("accepts hostnames that resolve only to public addresses", async () => {
    const url = await assertSafeCallbackUrl("https://example.com/hook", {
      resolve: async () => ["93.184.216.34"],
    });
    expect(url.hostname).toBe("example.com");
  });

  it("bypasses the private-network guard when allowPrivate is true", async () => {
    const url = await assertSafeCallbackUrl("http://localhost:3000/hook", { allowPrivate: true });
    expect(url.hostname).toBe("localhost");
  });
});

describe("signCallbackPayload", () => {
  it("computes HMAC-SHA256 over timestamp.body", () => {
    const expected = createHmac("sha256", "secret")
      .update('1700000000.{"hello":"world"}')
      .digest("hex");
    expect(signCallbackPayload("secret", "1700000000", '{"hello":"world"}')).toBe(expected);
  });
});

describe("callbackAllowsEvent", () => {
  it("allows all events when no filter is set", () => {
    expect(callbackAllowsEvent({ url: "https://example.com" }, "job.completed")).toBe(true);
  });

  it("honors an event filter", () => {
    expect(
      callbackAllowsEvent({ url: "https://example.com", events: ["job.failed"] }, "job.completed"),
    ).toBe(false);
    expect(
      callbackAllowsEvent({ url: "https://example.com", events: ["job.failed"] }, "job.failed"),
    ).toBe(true);
  });
});

function makePayload(event: CallbackPayload["event"] = "job.completed"): CallbackPayload {
  return {
    event,
    jobId: "job-1",
    status: event === "job.completed" ? "completed" : "failed",
    topic: "test",
    timestamp: new Date().toISOString(),
  };
}

describe("deliverCallback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a signed payload with delivery headers", async () => {
    const result = await deliverCallback(
      { url: "https://example.com/hook", secret: "top-secret" },
      makePayload(),
      {
        fetchImpl: fetchMock as unknown as typeof fetch,
        resolve: async () => ["93.184.216.34"],
      },
    );

    expect(result).toEqual({ delivered: true, attempts: 1, statusCode: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://example.com/hook");
    const body = (init as RequestInit).body as string;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-OpenReels-Event"]).toBe("job.completed");
    expect(headers["X-OpenReels-Job-Id"]).toBe("job-1");
    expect(headers["X-OpenReels-Delivery"]).toBeTruthy();
    expect(headers["Content-Type"]).toBe("application/json");
    const timestamp = headers["X-OpenReels-Timestamp"]!;
    expect(headers["X-OpenReels-Signature"]).toBe(
      `sha256=${signCallbackPayload("top-secret", timestamp, body)}`,
    );
    expect((init as RequestInit).redirect).toBe("manual");
  });

  it("omits the signature when no secret is configured", async () => {
    await deliverCallback({ url: "https://example.com/hook" }, makePayload(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
      resolve: async () => ["93.184.216.34"],
    });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-OpenReels-Signature"]).toBeUndefined();
  });

  it("retries non-2xx responses", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await deliverCallback({ url: "https://example.com/hook" }, makePayload(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
      resolve: async () => ["93.184.216.34"],
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    expect(result).toEqual({ delivered: true, attempts: 2, statusCode: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry unsafe URLs", async () => {
    const result = await deliverCallback({ url: "http://127.0.0.1/hook" }, makePayload(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips events that are not subscribed", async () => {
    const result = await deliverCallback(
      { url: "https://example.com/hook", events: ["job.failed"] },
      makePayload("job.completed"),
      { fetchImpl: fetchMock as unknown as typeof fetch, resolve: async () => ["93.184.216.34"] },
    );

    expect(result).toEqual({ delivered: false, attempts: 0, error: "event not subscribed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports failure after exhausting attempts", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    const result = await deliverCallback({ url: "https://example.com/hook" }, makePayload(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
      resolve: async () => ["93.184.216.34"],
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.statusCode).toBe(503);
  });
});
