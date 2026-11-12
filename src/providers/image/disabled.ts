import type { ImageProvider } from "../../schema/providers.js";

/**
 * Image provider used when AI assets are disabled.
 *
 * The pipeline never reaches this provider in no-AI-assets mode (scores are
 * sanitized and stock resolution disables its AI fallback). It exists so
 * provider construction does not require an image API key and so any future
 * accidental call fails loudly instead of silently generating an asset.
 */
export class DisabledImageProvider implements ImageProvider {
  async generate(): Promise<Buffer> {
    throw new Error("AI image generation is disabled (no-AI-assets mode)");
  }
}
