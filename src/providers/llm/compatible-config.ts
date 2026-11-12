import type { LLMAuthType } from "../../schema/providers.js";

export interface OpenAICompatibleConfig {
  llmBaseUrl?: string;
  llmModel?: string;
  llmAuthType?: LLMAuthType;
  llmAuthHeader?: string;
  /** Job-level BYOK key, if the caller supplied one. */
  apiKey?: string;
}

/**
 * Validate an OpenAI-compatible provider configuration.
 *
 * Returns a human-readable error message when the configuration cannot work,
 * or `null` when it is valid. Env vars are used as fallbacks for anything the
 * caller did not provide.
 */
export function validateOpenAICompatibleConfig(config: OpenAICompatibleConfig): string | null {
  const baseUrl = config.llmBaseUrl ?? process.env["OPENREELS_LLM_BASE_URL"];
  if (!baseUrl) {
    return "llmBaseUrl is required for the openai-compatible provider";
  }

  const model = config.llmModel ?? process.env["OPENREELS_LLM_MODEL"];
  if (!model) {
    return "llmModel is required for the openai-compatible provider";
  }

  // Match the factory's resolution order: explicit config, then env, then auto.
  const envAuthType = process.env["OPENREELS_LLM_AUTH"];
  const authType: LLMAuthType =
    config.llmAuthType ??
    (envAuthType === "none" || envAuthType === "bearer" || envAuthType === "custom-header"
      ? envAuthType
      : "auto");
  const authHeader = config.llmAuthHeader ?? process.env["OPENREELS_LLM_AUTH_HEADER"];
  if (authType === "custom-header" && !authHeader?.trim()) {
    return "llmAuthHeader is required when llmAuthType is custom-header";
  }

  if (authType === "bearer" || authType === "custom-header") {
    const apiKey = config.apiKey ?? process.env["OPENREELS_LLM_API_KEY"];
    if (!apiKey) {
      return `OPENREELS_LLM_API_KEY is required when llmAuthType is ${authType}`;
    }
  }

  return null;
}
