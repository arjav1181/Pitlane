import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => {
    const provider = vi.fn((model: string) => ({ model, type: "compat-model" }));
    return provider;
  }),
}));

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { OpenAICompatibleLLM, resolveOpenAICompatibleAuth } from "./openai-compatible.js";

describe("OpenAICompatibleLLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has id 'openai-compatible'", () => {
    const llm = new OpenAICompatibleLLM("http://localhost:11434/v1", "llama3");
    expect(llm.id).toBe("openai-compatible");
  });

  it("passes baseURL, name, and apiKey to createOpenAICompatible", () => {
    new OpenAICompatibleLLM("http://localhost:11434/v1", "llama3", "test-key");
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "openreels-custom",
      baseURL: "http://localhost:11434/v1",
      apiKey: "test-key",
    });
  });

  it("omits apiKey when not provided", () => {
    new OpenAICompatibleLLM("http://localhost:11434/v1", "llama3");
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "openreels-custom",
      baseURL: "http://localhost:11434/v1",
    });
  });

  it("createSearchTools returns empty object (no native search)", () => {
    const llm = new OpenAICompatibleLLM("http://localhost/v1", "model");
    const tools = (llm as any).createSearchTools();
    expect(tools).toEqual({});
  });

  it("stores injected search tools", () => {
    const injected = { tavily: {} };
    const llm = new OpenAICompatibleLLM("http://localhost/v1", "model", undefined, injected);
    expect((llm as any).injectedSearchTools).toBe(injected);
  });

  it("sends no credentials when auth type is none", () => {
    new OpenAICompatibleLLM("http://localhost/v1", "model", "test-key", undefined, {
      type: "none",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "openreels-custom",
      baseURL: "http://localhost/v1",
    });
  });

  it("sends the key as a bearer token when auth type is bearer", () => {
    new OpenAICompatibleLLM("http://localhost/v1", "model", "test-key", undefined, {
      type: "bearer",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "openreels-custom",
      baseURL: "http://localhost/v1",
      apiKey: "test-key",
    });
  });

  it("sends the key in a custom header when auth type is custom-header", () => {
    new OpenAICompatibleLLM("http://localhost/v1", "model", "test-key", undefined, {
      type: "custom-header",
      headerName: "x-api-key",
    });
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "openreels-custom",
      baseURL: "http://localhost/v1",
      headers: { "x-api-key": "test-key" },
    });
  });
});

describe("resolveOpenAICompatibleAuth", () => {
  it("defaults to auto and sends a bearer token when a key exists", () => {
    expect(resolveOpenAICompatibleAuth("test-key")).toEqual({ apiKey: "test-key" });
  });

  it("defaults to auto and sends nothing when no key exists", () => {
    expect(resolveOpenAICompatibleAuth(undefined)).toEqual({});
  });

  it("trims whitespace around the key", () => {
    expect(resolveOpenAICompatibleAuth("  test-key  ")).toEqual({ apiKey: "test-key" });
  });

  it("returns nothing for auth type none even when a key exists", () => {
    expect(resolveOpenAICompatibleAuth("test-key", { type: "none" })).toEqual({});
  });

  it("throws when bearer auth is selected without a key", () => {
    expect(() => resolveOpenAICompatibleAuth(undefined, { type: "bearer" })).toThrow(
      /no API key was provided/,
    );
  });

  it("throws when custom-header auth is selected without a header name", () => {
    expect(() => resolveOpenAICompatibleAuth("test-key", { type: "custom-header" })).toThrow(
      /no header name was provided/,
    );
  });

  it("throws when custom-header auth is selected without a key", () => {
    expect(() =>
      resolveOpenAICompatibleAuth(undefined, { type: "custom-header", headerName: "x-api-key" }),
    ).toThrow(/no API key was provided/);
  });

  it("rejects header names that are not valid HTTP header names", () => {
    expect(() =>
      resolveOpenAICompatibleAuth("test-key", {
        type: "custom-header",
        headerName: "bad header",
      }),
    ).toThrow(/Invalid auth header name/);
  });
});
