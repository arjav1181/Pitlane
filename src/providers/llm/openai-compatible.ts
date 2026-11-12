import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { LLMAuthType } from "../../schema/providers.js";
import { BaseLLM } from "./base.js";

export interface OpenAICompatibleAuth {
  /** Authentication mode. Defaults to "auto". */
  type?: LLMAuthType;
  /** Header name used when type is "custom-header" (e.g. "x-api-key"). */
  headerName?: string;
}

export interface OpenAICompatibleConnection {
  apiKey?: string;
  headers?: Record<string, string>;
}

const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * Resolve an auth mode into the options understood by createOpenAICompatible.
 * Throws actionable errors instead of letting the SDK fail with an opaque 401.
 */
export function resolveOpenAICompatibleAuth(
  apiKey: string | undefined,
  auth?: OpenAICompatibleAuth,
): OpenAICompatibleConnection {
  const type = auth?.type ?? "auto";
  const key = apiKey?.trim();

  switch (type) {
    case "none":
      return {};
    case "bearer":
      if (!key) {
        throw new Error(
          'OpenAI-compatible auth is set to "bearer" but no API key was provided. ' +
            "Enter an API key or set OPENREELS_LLM_API_KEY.",
        );
      }
      return { apiKey: key };
    case "custom-header": {
      const headerName = auth?.headerName?.trim();
      if (!headerName) {
        throw new Error(
          'OpenAI-compatible auth is set to "custom-header" but no header name was provided. ' +
            "Enter a header name such as x-api-key.",
        );
      }
      if (!HEADER_NAME_PATTERN.test(headerName)) {
        throw new Error(
          `Invalid auth header name "${headerName}". Use letters, digits, and hyphens only.`,
        );
      }
      if (!key) {
        throw new Error(
          'OpenAI-compatible auth is set to "custom-header" but no API key was provided. ' +
            "Enter an API key or set OPENREELS_LLM_API_KEY.",
        );
      }
      return { headers: { [headerName]: key } };
    }
    default:
      // Auto: keep the pre-existing behavior — send Bearer only when a key exists.
      return key ? { apiKey: key } : {};
  }
}

/** Build the AI SDK provider used for both generation and VLM verification. */
export function createOpenAICompatibleProvider(
  baseURL: string,
  apiKey?: string,
  auth?: OpenAICompatibleAuth,
): ReturnType<typeof createOpenAICompatible> {
  return createOpenAICompatible({
    name: "openreels-custom",
    baseURL,
    ...resolveOpenAICompatibleAuth(apiKey, auth),
  });
}

export class OpenAICompatibleLLM extends BaseLLM {
  readonly id = "openai-compatible" as const;
  private provider: ReturnType<typeof createOpenAICompatible>;
  private model: string;

  constructor(
    baseURL: string,
    model: string,
    apiKey?: string,
    searchTools?: Record<string, unknown>,
    auth?: OpenAICompatibleAuth,
  ) {
    super(searchTools);
    this.model = model;
    this.provider = createOpenAICompatibleProvider(baseURL, apiKey, auth);
  }

  protected createLanguageModel(): LanguageModel {
    return this.provider(this.model);
  }

  protected createSearchTools() {
    // Generic endpoints have no native search tools; injection handles this
    return {};
  }
}
