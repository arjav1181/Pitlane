import { afterEach, describe, expect, it } from "vitest";
import { type CLIOptions, parseArgs } from "./args.js";

describe("CLIOptions type", () => {
  it("includes yes field for non-interactive mode", () => {
    // Type-level test: verify CLIOptions includes the yes field.
    // If this compiles, the field exists.
    const opts: CLIOptions = {
      topic: "test",
      provider: "anthropic",
      imageProvider: "gemini",
      ttsProvider: "elevenlabs",
      platform: "youtube",
      dryRun: false,
      preview: false,
      output: "./output",
      yes: true,
      musicProvider: "bundled",
      noMusic: false,
      stockVerify: true,
      stockConfidence: 0.6,
      stockMaxAttempts: 4,
      noVideo: false,
      noAiAssets: false,
      usage: false,
    };
    expect(opts.yes).toBe(true);
  });

  it("yes defaults to false", () => {
    const opts: CLIOptions = {
      topic: "test",
      provider: "anthropic",
      imageProvider: "gemini",
      ttsProvider: "elevenlabs",
      platform: "youtube",
      dryRun: false,
      preview: false,
      output: "./output",
      yes: false,
      musicProvider: "bundled",
      noMusic: false,
      stockVerify: true,
      stockConfidence: 0.6,
      stockMaxAttempts: 4,
      noVideo: false,
      noAiAssets: false,
      usage: false,
    };
    expect(opts.yes).toBe(false);
  });

  it("accepts gemini as provider", () => {
    const opts: CLIOptions = {
      topic: "test",
      provider: "gemini",
      imageProvider: "gemini",
      ttsProvider: "elevenlabs",
      platform: "youtube",
      dryRun: false,
      preview: false,
      output: "./output",
      yes: false,
      musicProvider: "bundled",
      noMusic: false,
      stockVerify: true,
      stockConfidence: 0.6,
      stockMaxAttempts: 4,
      noVideo: false,
      noAiAssets: false,
      usage: false,
    };
    expect(opts.provider).toBe("gemini");
  });

  it("accepts pacing tier as optional field", () => {
    const opts: CLIOptions = {
      topic: "test",
      provider: "anthropic",
      imageProvider: "gemini",
      ttsProvider: "elevenlabs",
      pacing: "fast",
      platform: "youtube",
      dryRun: false,
      preview: false,
      output: "./output",
      yes: false,
      musicProvider: "bundled",
      noMusic: false,
      stockVerify: true,
      stockConfidence: 0.6,
      stockMaxAttempts: 4,
      noVideo: false,
      noAiAssets: false,
      usage: false,
    };
    expect(opts.pacing).toBe("fast");
  });

  it("pacing is undefined by default", () => {
    const opts: CLIOptions = {
      topic: "test",
      provider: "anthropic",
      imageProvider: "gemini",
      ttsProvider: "elevenlabs",
      platform: "youtube",
      dryRun: false,
      preview: false,
      output: "./output",
      yes: false,
      musicProvider: "bundled",
      noMusic: false,
      stockVerify: true,
      stockConfidence: 0.6,
      stockMaxAttempts: 4,
      noVideo: false,
      noAiAssets: false,
      usage: false,
    };
    expect(opts.pacing).toBeUndefined();
  });
});

describe("parseArgs no-ai-assets", () => {
  const originalArgv = process.argv;
  const originalEnv = process.env["OPENREELS_NO_AI_ASSETS"];

  afterEach(() => {
    process.argv = originalArgv;
    if (originalEnv === undefined) {
      delete process.env["OPENREELS_NO_AI_ASSETS"];
    } else {
      process.env["OPENREELS_NO_AI_ASSETS"] = originalEnv;
    }
  });

  it("sets noAiAssets from --no-ai-assets", () => {
    process.argv = ["node", "openreels", "test topic", "--no-ai-assets"];
    const opts = parseArgs();
    expect(opts.noAiAssets).toBe(true);
  });

  it("sets noAiAssets from OPENREELS_NO_AI_ASSETS=true", () => {
    process.argv = ["node", "openreels", "test topic"];
    process.env["OPENREELS_NO_AI_ASSETS"] = "true";
    const opts = parseArgs();
    expect(opts.noAiAssets).toBe(true);
  });

  it("defaults noAiAssets to false", () => {
    process.argv = ["node", "openreels", "test topic"];
    delete process.env["OPENREELS_NO_AI_ASSETS"];
    const opts = parseArgs();
    expect(opts.noAiAssets).toBe(false);
  });
});
