import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TTSProvider, TTSResult } from "../../schema/providers.js";

/**
 * Local TTS provider using Piper.
 *
 * Piper is a fast neural TTS that runs the ONNX voice model natively, so it
 * synthesises at roughly twenty times faster than real time on a CPU. That
 * matters here: the pipeline is serial, so every second of voiceover is a
 * second the whole short is waiting.
 *
 * The binary and the voice model are baked into the container image, so
 * nothing is downloaded at render time. The voice is a documentary narrator
 * rather than a bright assistant, which suits a motoring channel.
 *
 * Piper returns no word timings. The AlignedTTSProvider decorator extracts
 * them with Whisper, exactly as it does for the other local engines.
 */
export class PiperTTS implements TTSProvider {
  private readonly binary: string;
  private readonly model: string;
  /** Phoneme length. Higher is slower speech. */
  private readonly lengthScale: number;

  constructor(options?: {
    binary?: string;
    model?: string;
    lengthScale?: number;
  }) {
    this.binary = options?.binary ?? process.env["PIPER_BINARY"] ?? "/opt/piper/piper";
    this.model = options?.model ?? process.env["PIPER_MODEL"] ?? "/opt/piper-voices/en_GB-alan-medium.onnx";
    this.lengthScale = options?.lengthScale ?? 1;
  }

  async generate(text: string): Promise<TTSResult> {
    const tmp = await mkdtemp(join(tmpdir(), "piper-"));
    const outputPath = join(tmp, "output.wav");

    try {
      await this.run(text, outputPath);
      const audio = await readFile(outputPath);
      return { audio: Buffer.from(audio), words: [] };
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(text: string, outputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.binary,
        [
          "--model",
          this.model,
          "--output_file",
          outputPath,
          "--length_scale",
          String(this.lengthScale),
          "--quiet",
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );

      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        // Piper logs the real-time factor on exit; keep the tail for errors.
        stderr = (stderr + chunk.toString()).slice(-2000);
      });

      child.on("error", (err) => {
        reject(
          new Error(
            `Piper could not start: ${err.message}. ` +
              "Check PIPER_BINARY and that the voice model exists at PIPER_MODEL.",
          ),
        );
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Piper exited with code ${code}. ${stderr.slice(-500)}`.trim(),
            ),
          );
        }
      });

      // Piper reads one sentence per line from stdin.
      child.stdin?.end(text.replace(/\n+/g, "\n"));
    });
  }
}
