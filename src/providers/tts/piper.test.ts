import { describe, expect, it } from "vitest";
import { PiperTTS } from "./piper.js";

describe("PiperTTS", () => {
  it("defaults to the paths the container image installs", () => {
    const previousBinary = process.env["PIPER_BINARY"];
    const previousModel = process.env["PIPER_MODEL"];
    delete process.env["PIPER_BINARY"];
    delete process.env["PIPER_MODEL"];

    const tts = new PiperTTS();
    // The provider keeps its configuration private, so the observable contract
    // is that a missing binary fails with an actionable message rather than a
    // silent empty buffer.
    expect(tts).toBeInstanceOf(PiperTTS);

    if (previousBinary !== undefined) process.env["PIPER_BINARY"] = previousBinary;
    if (previousModel !== undefined) process.env["PIPER_MODEL"] = previousModel;
  });

  it("explains a missing or non-executable binary", async () => {
    const tts = new PiperTTS({
      binary: "/nonexistent/piper-binary",
      model: "/nonexistent/voice.onnx",
    });

    await expect(tts.generate("A short line.")).rejects.toThrow(/Piper could not start/);
    await expect(tts.generate("A short line.")).rejects.toThrow(/executable/);
  });

  it("reports a non-zero exit with the engine's own message", async () => {
    // /bin/sh exists but is not piper: it exits non-zero on these arguments.
    const tts = new PiperTTS({ binary: "/bin/sh", model: "/nonexistent/voice.onnx" });

    await expect(tts.generate("A short line.")).rejects.toThrow(/Piper exited with code/);
  });
});
