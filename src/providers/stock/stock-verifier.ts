import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LanguageModel } from "ai";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { LLMUsage } from "../../schema/providers.js";

const VerificationSchema = z.object({
  relevant: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
});

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

    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${SYSTEM_PROMPT}\n\nRequested visual: ${visualPrompt}\nNarration context: ${scriptLine}\n\nDoes this image match what was requested?`,
            },
            {
              type: "image",
              image: imageBuffer,
              mediaType: assetPath.endsWith(".png") ? "image/png" : "image/jpeg",
            },
          ],
        },
      ],
      output: Output.object({ schema: VerificationSchema }),
    });

    const usage: LLMUsage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };

    if (result.output == null) {
      return { relevant: false, confidence: 0, reason: "VLM returned no output", usage };
    }

    return {
      relevant: result.output.relevant && result.output.confidence >= confidenceThreshold,
      confidence: result.output.confidence,
      reason: result.output.reason,
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
