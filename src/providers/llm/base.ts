import type { LanguageModel } from "ai";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import type { LLMProvider, LLMProviderKey, LLMResult, LLMUsage } from "../../schema/providers.js";
import { withRateLimitRetry } from "./retry.js";

/**
 * Abstract base for LLM providers using the Vercel AI SDK.
 *
 *   ┌──────────┐   enableWebSearch?   ┌─────────────────────┐
 *   │ generate │──── true ──────────►│ resolve search tools │
 *   │          │                      │                     │
 *   │          │                      │  tools present?     │
 *   │          │                      │  yes → two-pass     │
 *   │          │                      │  no  → parametric   │
 *   │          │──── false ─────────►│ generateStructured  │
 *   └──────────┘                      └─────────────────────┘
 *
 * Search tool injection: the factory can inject search tools (e.g. Tavily)
 * via the constructor. If injected, they override the subclass's native tools.
 * Existing subclasses are unaffected when no tools are injected.
 */
/** Per-request ceiling so a silent gateway cannot hang a job forever. */
function requestSignal(): AbortSignal {
  const raw = Number(process.env["OPENREELS_LLM_TIMEOUT_MS"]);
  const ms = Number.isFinite(raw) && raw > 0 ? raw : 180_000;
  return AbortSignal.timeout(ms);
}

export abstract class BaseLLM implements LLMProvider {
  abstract readonly id: LLMProviderKey;

  /** Injected search tools override native createSearchTools(). */
  protected injectedSearchTools?: Record<string, unknown>;

  constructor(searchTools?: Record<string, unknown>) {
    this.injectedSearchTools = searchTools;
  }

  /** Return an AI SDK LanguageModel for the configured provider + model. */
  protected abstract createLanguageModel(): LanguageModel;

  /** Return provider-specific search tools for the two-pass web search pattern. */
  protected abstract createSearchTools(): Record<string, unknown>;

  async generate<T extends z.ZodType>(opts: {
    systemPrompt: string;
    userMessage: string;
    schema: T;
    enableWebSearch?: boolean;
  }): Promise<LLMResult<z.infer<T>>> {
    if (opts.enableWebSearch) {
      const tools = this.injectedSearchTools ?? this.createSearchTools();
      const hasTools = Object.keys(tools).length > 0;

      if (!hasTools) {
        // No search tools available: single-pass with parametric knowledge prompt
        return this.generateStructured({
          ...opts,
          systemPrompt:
            opts.systemPrompt +
            "\n\nYou do not have access to web search. Use your training knowledge to provide the best possible research.",
        });
      }

      return this.generateWithSearch({ ...opts, tools });
    }
    return this.generateStructured(opts);
  }

  /**
   * Two-pass approach:
   * Pass 1: web search + free-form response (model needs freedom to call search)
   * Pass 2: structured output using search results as context
   *
   * If Pass 1 fails due to tool-calling errors (model doesn't support tools),
   * falls back to single-pass parametric knowledge.
   */
  private async generateWithSearch<T extends z.ZodType>(opts: {
    systemPrompt: string;
    userMessage: string;
    schema: T;
    tools: Record<string, unknown>;
  }): Promise<LLMResult<z.infer<T>>> {
    const totalUsage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    const languageModel = this.createLanguageModel();

    // Pass 1: Let the model use web search freely
    let textContent: string;
    try {
      const searchResult = await withRateLimitRetry(
        () =>
          generateText({
            model: languageModel,
            system: opts.systemPrompt,
            prompt: opts.userMessage,
            tools: opts.tools as Parameters<typeof generateText>[0]["tools"],
            stopWhen: stepCountIs(5),
            abortSignal: requestSignal(),
          }),
        this.retryOptions(),
      );

      totalUsage.inputTokens += searchResult.usage.inputTokens ?? 0;
      totalUsage.outputTokens += searchResult.usage.outputTokens ?? 0;
      textContent = searchResult.text;
    } catch (error: unknown) {
      // Tool-calling errors: model doesn't support tools. Fall back to parametric knowledge.
      const msg = error instanceof Error ? error.message : String(error);
      const lowerMsg = msg.toLowerCase();
      const isToolError =
        lowerMsg.includes("tools_not_supported") ||
        lowerMsg.includes("tools are not supported") ||
        lowerMsg.includes("tool_use") ||
        lowerMsg.includes("tool use") ||
        lowerMsg.includes("tool_calls") ||
        lowerMsg.includes("tool calls") ||
        lowerMsg.includes("function_call") ||
        lowerMsg.includes("does not support tools") ||
        lowerMsg.includes("tooling is not supported");
      if (isToolError) {
        console.warn(
          `[${this.id}] Model does not support tool calling. Falling back to parametric knowledge.\n  Original error: ${msg}`,
        );
        return this.generateStructured({
          systemPrompt:
            opts.systemPrompt +
            "\n\nYou do not have access to web search. Use your training knowledge to provide the best possible research.",
          userMessage: opts.userMessage,
          schema: opts.schema,
        });
      }
      throw error;
    }

    if (!textContent) {
      throw new Error(`${this.id} web search returned no text content`);
    }

    // Pass 2: Structure the search results using the schema.
    // Retries up to 2 times on failure to avoid re-running Pass 1 (which burns search credits).
    const MAX_STRUCTURE_RETRIES = 2;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_STRUCTURE_RETRIES; attempt++) {
      try {
        const structuredResult = await withRateLimitRetry(
          () =>
            generateText({
              model: languageModel,
              system:
                "You are a data extraction assistant. Structure the following research into the exact format requested. Use only the information provided.",
              prompt: `Based on this research:\n\n${textContent}\n\nStructure this into the required format.`,
              output: Output.object({ schema: opts.schema }),
              abortSignal: requestSignal(),
            }),
          this.retryOptions(),
        );

        totalUsage.inputTokens += structuredResult.usage.inputTokens ?? 0;
        totalUsage.outputTokens += structuredResult.usage.outputTokens ?? 0;

        if (structuredResult.output == null) {
          throw new Error(`${this.id} did not return structured output from search results`);
        }

        return { data: structuredResult.output as z.infer<T>, usage: totalUsage };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_STRUCTURE_RETRIES) {
          console.warn(
            `[${this.id}] Pass 2 (structure) failed, retrying (${attempt + 1}/${MAX_STRUCTURE_RETRIES})...`,
          );
        }
      }
    }

    throw lastError!;
  }

  private async generateStructured<T extends z.ZodType>(opts: {
    systemPrompt: string;
    userMessage: string;
    schema: T;
  }): Promise<LLMResult<z.infer<T>>> {
    const languageModel = this.createLanguageModel();

    const structured = await this.generateStructuredOutput(languageModel, opts).catch((err) => {
      // Endpoints without structured-output or tool support (some OpenAI-compatible
      // gateways, Gemini via a compatibility layer) still return valid JSON in the
      // message body. Fall back to plain text generation and validate it locally.
      console.warn(
        `[${this.id}] Structured output failed, retrying as plain JSON. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });

    if (structured === null) {
      return this.generateStructuredFromText(opts, languageModel);
    }

    if (structured.output == null) {
      throw new Error(`${this.id} did not return structured output`);
    }

    return {
      data: structured.output as z.infer<T>,
      usage: {
        inputTokens: structured.usage.inputTokens ?? 0,
        outputTokens: structured.usage.outputTokens ?? 0,
      },
    };
  }

  /** Shared retry policy for gateway rate limiting. */
  private retryOptions() {
    return {
      onRetry: ({
        attempt,
        delayMs,
        error,
      }: {
        attempt: number;
        delayMs: number;
        error: unknown;
      }) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[${this.id}] Rate limited (attempt ${attempt}), waiting ${delayMs}ms: ${message.slice(0, 160)}`,
        );
      },
    };
  }

  /** Single structured-output call against the configured model. */
  private generateStructuredOutput<T extends z.ZodType>(
    languageModel: LanguageModel,
    opts: { systemPrompt: string; userMessage: string; schema: T },
  ) {
    return withRateLimitRetry(
      () =>
        generateText({
          model: languageModel,
          system: opts.systemPrompt,
          prompt: opts.userMessage,
          output: Output.object({ schema: opts.schema }),
          abortSignal: requestSignal(),
        }),
      this.retryOptions(),
    );
  }

  /**
   * Fallback path: ask for raw JSON as text and validate it against the schema.
   * Retries once with the validation error so the model can correct itself.
   */
  private async generateStructuredFromText<T extends z.ZodType>(
    opts: {
      systemPrompt: string;
      userMessage: string;
      schema: T;
    },
    languageModel: LanguageModel,
  ): Promise<LLMResult<z.infer<T>>> {
    const totalUsage = { inputTokens: 0, outputTokens: 0 };
    let lastError = new Error(`${this.id} did not return structured output`);

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await withRateLimitRetry(
        () =>
          generateText({
            model: languageModel,
            system:
              opts.systemPrompt +
              "\n\nRespond with a single JSON object and nothing else. " +
              "Do not wrap it in markdown code fences and do not add commentary. " +
              "The JSON must match this schema exactly:\n" +
              JSON.stringify(z.toJSONSchema(opts.schema)),
            prompt:
              attempt === 0
                ? opts.userMessage
                : `${opts.userMessage}\n\nYour previous answer was rejected: ${lastError.message}\n` +
                  "Return corrected JSON that matches the schema exactly.",
            abortSignal: requestSignal(),
          }),
        this.retryOptions(),
      );

      totalUsage.inputTokens += result.usage.inputTokens ?? 0;
      totalUsage.outputTokens += result.usage.outputTokens ?? 0;

      const candidate = extractJsonObject(result.text);
      if (candidate === null) {
        lastError = new Error(`${this.id} did not return a JSON object`);
        continue;
      }

      const validated = opts.schema.safeParse(candidate);
      if (validated.success) {
        return { data: validated.data as z.infer<T>, usage: totalUsage };
      }

      lastError = new Error(
        `${this.id} returned JSON that does not match the schema: ${validated.error.message}`,
      );
      console.warn(
        `[${this.id}] JSON did not match the schema, retrying as plain JSON (${attempt + 1}/2)...`,
      );
    }

    throw lastError;
  }
}

/** Extract the first JSON object from a model response (tolerating code fences). */
function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return null;
  }
}
