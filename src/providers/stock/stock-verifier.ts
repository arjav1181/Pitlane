import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LanguageModel } from "ai";
import { generateText } from "ai";
import type { LLMUsage } from "../../schema/providers.js";

export interface VerificationResult {
  relevant: boolean;
  confidence: number;
  reason: string;
  usage: LLMUsage;
}

const SYSTEM_PROMPT = `You are a visual content judge for a short documentary video. Given an image and a description of what was requested, decide whether the frame is usable in that video.

Judge the SUBJECT, not the staging. Stock footage is cut into a vertical frame and given a slow camera move, so it does not have to match the requested action exactly. A parked vintage racing car is a usable frame for a scene about a vintage racing car; a modern sedan is not.

Answer relevant: true when the frame shows the requested subject and is usable:
- The subject matches the requested subject, model, era, type or place. Judge on the subject, not the exact action.
- A looser framing of the right subject (a detail shot, a wider shot, a different angle) is still a match.
- The subject is recognisable and readable in the frame.

Answer relevant: false when:
- The subject is a different thing entirely (a toy rocket for "rocket launch", a generic sunset for "Mars surface", a sedan for "vintage racing car")
- The frame is an illustration, a drawing or a render when real footage was requested
- The frame is technically unusable: mostly empty sky or haze, heavily blurred, underexposed, or one flat colour
- The subject occupies a sliver of the frame and cannot be made out

Output your confidence as a number between 0 and 1:
- 0.0-0.3: Wrong subject entirely
- 0.3-0.6: Related subject, but a weak match for what was requested
- 0.6-0.8: The requested subject is clearly in frame
- 0.8-1.0: Strong match, exactly what was described`;

/**
 * Read the judge's answer.
 *
 * Models wrap JSON in prose, in code fences, or in nothing at all, so the
 * first object in the answer is taken and its fields are read defensively.
 */
export function parseVerdict(text: string): VerificationResult | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const confidence = Number(record["confidence"]);
  if (!Number.isFinite(confidence)) return null;

  return {
    relevant: record["relevant"] === true,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason: String(record["reason"] ?? "").slice(0, 400),
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

/** Extract a single frame from a video file for verification */
function extractVideoFrame(videoPath: string): Buffer {
  const tmpFile = path.join(
    os.tmpdir(),
    `openreels-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
  );
  try {
    // Try 1-second mark first, fall back to 0s for very short clips
    try {
      execFileSync(
        "ffmpeg",
        ["-i", videoPath, "-ss", "1", "-frames:v", "1", "-update", "1", "-y", tmpFile],
        { stdio: "pipe", timeout: 15_000 },
      );
    } catch {
      execFileSync(
        "ffmpeg",
        ["-i", videoPath, "-ss", "0", "-frames:v", "1", "-update", "1", "-y", tmpFile],
        { stdio: "pipe", timeout: 15_000 },
      );
    }
    return fs.readFileSync(tmpFile);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore cleanup error */
    }
  }
}

export async function verifyStockResult(
  model: LanguageModel,
  assetPath: string,
  visualPrompt: string,
  scriptLine: string,
  confidenceThreshold: number,
): Promise<VerificationResult> {
  try {
    const isVideo = assetPath.endsWith(".mp4");
    const imageBuffer = isVideo ? extractVideoFrame(assetPath) : fs.readFileSync(assetPath);

    // The answer is asked for as plain JSON and parsed here, rather than
    // through the provider's structured-output mode. A gateway that cannot
    // emit a schema object fails the whole check and every frame is taken on
    // trust, which is how a wrong subject ends up in the finished video.
    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `${SYSTEM_PROMPT}\n\nRequested visual: ${visualPrompt}\n` +
                `Narration context: ${scriptLine}\n\n` +
                `Does this image match what was requested?\n` +
                `Answer with JSON only: {"relevant": true or false, "confidence": 0 to 1, "reason": "one sentence"}`,
            },
            {
              type: "image",
              image: imageBuffer,
              mediaType: assetPath.endsWith(".png") ? "image/png" : "image/jpeg",
            },
          ],
        },
      ],
    });

    const usage: LLMUsage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };

    const parsed = parseVerdict(result.text);
    if (!parsed) {
      return { relevant: false, confidence: 0, reason: "The judge did not answer", usage };
    }

    return {
      relevant: parsed.relevant && parsed.confidence >= confidenceThreshold,
      confidence: parsed.confidence,
      reason: parsed.reason,
      usage,
    };
  } catch (err) {
    console.warn(`[stock] Verification failed, using asset unverified: ${err}`);
    return {
      relevant: true, // stock_unverified: use it with warning
      confidence: -1, // sentinel for "unverified"
      reason: `Verification unavailable: ${err}`,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
