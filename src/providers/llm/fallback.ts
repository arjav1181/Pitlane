import type { z } from "zod";
import type { LLMProvider, LLMProviderKey, LLMResult, LLMUsage } from "../../schema/providers.js";

export interface FallbackEntry {
  provider: LLMProvider;
  /** Human-readable model name used in logs. */
  label?: string;
}

export interface FallbackOptions {
  /**
   * Stop trying further models once this much wall-clock time has elapsed.
   * Default 5 minutes; one slow model must not keep the job hostage.
   */
  budgetMs?: number;
}

function isCancellation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  // AbortSignal.timeout() rejects with TimeoutError; user/job cancellation
  // rejects with AbortError. Only the latter must stop the chain.
  return name === "AbortError";
}

function describe(entry: FallbackEntry, index: number): string {
  return entry.label ?? `provider ${index + 1} (${entry.provider.id})`;
}

/**
 * Try a list of models in order. The first success wins; every other failure
 * moves on to the next model. Cancellation aborts immediately.
 *
 * This is deliberately a wrapper rather than retry logic inside each provider:
 * a fallback usually means a different model on the same endpoint, so it must
 * own the model selection while sharing prompt/schema code.
 */
export class FallbackLLM implements LLMProvider {
  readonly id: LLMProviderKey;
  private readonly entries: FallbackEntry[];
  private readonly budgetMs: number;

  constructor(entries: Array<LLMProvider | FallbackEntry>, options: FallbackOptions = {}) {
    if (entries.length === 0) throw new Error("FallbackLLM requires at least one provider");
    this.entries = entries.map((entry) =>
      "provider" in entry ? entry : { provider: entry },
    );
    this.id = this.entries[0]!.provider.id;
    this.budgetMs = options.budgetMs ?? 300_000;
  }

  /** Ordered labels (or provider ids) for diagnostics and tests. */
  get labels(): string[] {
    return this.entries.map((entry, index) => describe(entry, index));
  }

  async generate<T extends z.ZodType>(opts: {
    systemPrompt: string;
    userMessage: string;
    schema: T;
    enableWebSearch?: boolean;
  }): Promise<LLMResult<z.infer<T>>> {
    const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    let lastError: Error | undefined;
    const startedAt = Date.now();

    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index]!;

      // Always try the primary. Before moving to a backup, honour the budget
      // so a wedged endpoint cannot consume the whole stage.
      if (index > 0 && this.budgetMs > 0 && Date.now() - startedAt >= this.budgetMs) {
        console.warn(
          `[llm-fallback] Budget of ${this.budgetMs}ms exhausted; skipping ${describe(entry, index)}`,
        );
        break;
      }

      try {
        const result = await entry.provider.generate(opts);
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        if (index > 0) {
          console.warn(`[llm-fallback] Succeeded with ${describe(entry, index)}`);
        }
        return { data: result.data, usage };
      } catch (error) {
        if (isCancellation(error)) throw error;

        lastError = error instanceof Error ? error : new Error(String(error));
        const next = this.entries[index + 1];
        if (!next) break;

        console.warn(
          `[llm-fallback] ${describe(entry, index)} failed: ${lastError.message.slice(0, 200)}. ` +
            `Trying ${describe(next, index + 1)}...`,
        );
      }
    }

    throw new Error(
      `All LLM models failed (${this.labels.join(" -> ")}). Last error: ${lastError?.message}`,
    );
  }
}
