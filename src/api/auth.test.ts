import { describe, expect, it } from "vitest";
import { apiKeysMatch, extractApiKey, PUBLIC_API_PATHS, requiresApiAuth } from "./auth.js";

describe("extractApiKey", () => {
  it("reads a Bearer token from Authorization", () => {
    expect(extractApiKey({ authorization: "Bearer secret-1" })).toBe("secret-1");
    expect(extractApiKey({ authorization: "bearer   secret-2  " })).toBe("secret-2");
  });

  it("reads X-API-Key", () => {
    expect(extractApiKey({ "x-api-key": "header-key" })).toBe("header-key");
  });

  it("reads the api_key query parameter", () => {
    expect(extractApiKey({}, { api_key: "query-key" })).toBe("query-key");
    expect(extractApiKey({}, { api_key: ["first", "second"] })).toBe("first");
  });

  it("prefers Authorization over X-API-Key and query", () => {
    expect(
      extractApiKey(
        { authorization: "Bearer auth-key", "x-api-key": "header-key" },
        {
          api_key: "query-key",
        },
      ),
    ).toBe("auth-key");
  });

  it("returns null when no key is present", () => {
    expect(extractApiKey({})).toBeNull();
    expect(extractApiKey({ authorization: "Basic abc" })).toBeNull();
    expect(extractApiKey({ "x-api-key": "" })).toBeNull();
  });
});

describe("apiKeysMatch", () => {
  it("matches equal keys", () => {
    expect(apiKeysMatch("abc", "abc")).toBe(true);
  });

  it("rejects different keys", () => {
    expect(apiKeysMatch("abc", "abd")).toBe(false);
    expect(apiKeysMatch("abc", "abcd")).toBe(false);
  });

  it("rejects a missing key", () => {
    expect(apiKeysMatch(null, "abc")).toBe(false);
  });
});

describe("public paths", () => {
  it("leaves only the health check public", () => {
    expect(requiresApiAuth("/api/v1/health")).toBe(false);
    expect(requiresApiAuth("/api/v1/openapi.json")).toBe(true);
    expect(requiresApiAuth("/api/v1/docs")).toBe(true);
    expect(requiresApiAuth("/api/v1/jobs")).toBe(true);
  });
});

describe("requiresApiAuth", () => {
  it("keeps the health check public", () => {
    for (const path of PUBLIC_API_PATHS) {
      expect(requiresApiAuth(path)).toBe(false);
      expect(requiresApiAuth(`${path}/`)).toBe(false);
    }
  });

  it("requires auth for job routes", () => {
    expect(requiresApiAuth("/api/v1/jobs")).toBe(true);
    expect(requiresApiAuth("/api/v1/jobs/abc/events")).toBe(true);
    expect(requiresApiAuth("/api/v1/stats")).toBe(true);
  });

  it("ignores non-API routes", () => {
    expect(requiresApiAuth("/")).toBe(false);
    expect(requiresApiAuth("/jobs/abc")).toBe(false);
  });
});
