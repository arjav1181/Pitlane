import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateOpenAICompatibleConfig } from "./compatible-config.js";

describe("validateOpenAICompatibleConfig", () => {
  beforeEach(() => {
    delete process.env["OPENREELS_LLM_BASE_URL"];
    delete process.env["OPENREELS_LLM_MODEL"];
    delete process.env["OPENREELS_LLM_API_KEY"];
    delete process.env["OPENREELS_LLM_AUTH"];
    delete process.env["OPENREELS_LLM_AUTH_HEADER"];
  });

  afterEach(() => {
    delete process.env["OPENREELS_LLM_BASE_URL"];
    delete process.env["OPENREELS_LLM_MODEL"];
    delete process.env["OPENREELS_LLM_API_KEY"];
    delete process.env["OPENREELS_LLM_AUTH"];
    delete process.env["OPENREELS_LLM_AUTH_HEADER"];
  });

  it("accepts a base URL and model", () => {
    expect(
      validateOpenAICompatibleConfig({
        llmBaseUrl: "http://localhost:11434/v1",
        llmModel: "llama3:8b",
      }),
    ).toBeNull();
  });

  it("requires a base URL", () => {
    expect(validateOpenAICompatibleConfig({ llmModel: "llama3:8b" })).toContain("llmBaseUrl");
  });

  it("requires a model", () => {
    expect(validateOpenAICompatibleConfig({ llmBaseUrl: "http://localhost:11434/v1" })).toContain(
      "llmModel",
    );
  });

  it("falls back to env vars for base URL and model", () => {
    process.env["OPENREELS_LLM_BASE_URL"] = "http://localhost:11434/v1";
    process.env["OPENREELS_LLM_MODEL"] = "llama3:8b";

    expect(validateOpenAICompatibleConfig({})).toBeNull();
  });

  it("requires an API key for bearer auth", () => {
    const error = validateOpenAICompatibleConfig({
      llmBaseUrl: "http://localhost:11434/v1",
      llmModel: "llama3:8b",
      llmAuthType: "bearer",
    });
    expect(error).toContain("OPENREELS_LLM_API_KEY");
  });

  it("accepts a job-provided API key for bearer auth", () => {
    expect(
      validateOpenAICompatibleConfig({
        llmBaseUrl: "http://localhost:11434/v1",
        llmModel: "llama3:8b",
        llmAuthType: "bearer",
        apiKey: "sk-test",
      }),
    ).toBeNull();
  });

  it("does not require an API key for no-auth mode", () => {
    expect(
      validateOpenAICompatibleConfig({
        llmBaseUrl: "http://localhost:11434/v1",
        llmModel: "llama3:8b",
        llmAuthType: "none",
      }),
    ).toBeNull();
  });

  it("does not require an API key for auto mode", () => {
    expect(
      validateOpenAICompatibleConfig({
        llmBaseUrl: "http://localhost:11434/v1",
        llmModel: "llama3:8b",
        llmAuthType: "auto",
      }),
    ).toBeNull();
  });

  it("requires a header name for custom-header auth", () => {
    const error = validateOpenAICompatibleConfig({
      llmBaseUrl: "http://localhost:11434/v1",
      llmModel: "llama3:8b",
      llmAuthType: "custom-header",
      apiKey: "sk-test",
    });
    expect(error).toContain("llmAuthHeader");
  });

  it("requires an API key for custom-header auth", () => {
    const error = validateOpenAICompatibleConfig({
      llmBaseUrl: "http://localhost:11434/v1",
      llmModel: "llama3:8b",
      llmAuthType: "custom-header",
      llmAuthHeader: "x-api-key",
    });
    expect(error).toContain("OPENREELS_LLM_API_KEY");
  });

  it("accepts a complete custom-header config", () => {
    expect(
      validateOpenAICompatibleConfig({
        llmBaseUrl: "http://localhost:11434/v1",
        llmModel: "llama3:8b",
        llmAuthType: "custom-header",
        llmAuthHeader: "x-api-key",
        apiKey: "sk-test",
      }),
    ).toBeNull();
  });

  it("reads the auth mode from OPENREELS_LLM_AUTH when not provided", () => {
    process.env["OPENREELS_LLM_AUTH"] = "bearer";

    const error = validateOpenAICompatibleConfig({
      llmBaseUrl: "http://localhost:11434/v1",
      llmModel: "llama3:8b",
    });

    expect(error).toContain("OPENREELS_LLM_API_KEY");
  });

  it("reads the header name from OPENREELS_LLM_AUTH_HEADER", () => {
    process.env["OPENREELS_LLM_AUTH"] = "custom-header";
    process.env["OPENREELS_LLM_AUTH_HEADER"] = "x-api-key";

    expect(
      validateOpenAICompatibleConfig({
        llmBaseUrl: "http://localhost:11434/v1",
        llmModel: "llama3:8b",
        apiKey: "sk-test",
      }),
    ).toBeNull();
  });
});
