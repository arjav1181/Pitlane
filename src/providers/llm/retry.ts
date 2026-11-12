/**
 * Rate-limit retry helper.
 *
 * Free / shared LLM gateways answer bursts with `429 Too Many Requests` and
 * often omit a `Retry-After` header. The previous pipeline retried immediately
 * and therefore burned every attempt inside a second, failing the whole job.
 * This helper waits with exponential backoff (plus jitter) before retrying, and
 * only retries errors that are actually rate limits — every other error is
 * re-thrown unchanged.
 */

const RATE_LIMIT_PATTERN =
  /\b429\b|too many requests|rate[\s_-]?limit|resource[_ ]exhausted|quota exceeded/i;

export interface RetryOptions {
  /** Retries after the first attempt. Default 5. */
  maxRetries?: number;
  /** Delay before the first retry, doubled per attempt. Default 2s. */
  baseDelayMs?: number;
  /** Upper bound for a single delay. Default 30s. */
  maxDelayMs?: number;
  /**
   * Upper bound on the total time spent retrying, in milliseconds.
   *
   * A gateway that answers every request with a rate limit would otherwise
   * keep one model busy for six attempts - and each attempt can take up to
   * the request timeout - long enough to eat a whole fallback chain's budget
   * before the next model is ever tried. Once the budget is spent the error
   * is re-thrown, so the caller can move on to a backup model.
   */
  budgetMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; must return a value in [0, 1). */
  random?: () => number;
  /** Called before each wait, useful for logging. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (candidate["statusCode"] === 429 || candidate["status"] === 429) return true;
    const response = candidate["response"];
    if (response && typeof response === "object") {
      const status = (response as Record<string, unknown>)["status"];
      if (status === 429) return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return RATE_LIMIT_PATTERN.test(message);
}

/** Read a `Retry-After` header (seconds or HTTP date) when the provider sends one. */
export function retryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  const response = (candidate["response"] ?? {}) as Record<string, unknown>;
  const rawHeaders = (response["headers"] ?? candidate["headers"]) as unknown;
  if (!rawHeaders) return null;

  let value: unknown;
  if (typeof rawHeaders === "object" && rawHeaders !== null) {
    const maybeGet = (rawHeaders as { get?: unknown }).get;
    if (typeof maybeGet === "function") {
      value = (maybeGet as (name: string) => unknown).call(rawHeaders, "retry-after");
    } else if (!Array.isArray(rawHeaders)) {
      const headers = rawHeaders as Record<string, unknown>;
      value = headers["retry-after"] ?? headers["Retry-After"];
    }
  }
  if (value === undefined || value === null) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);

  const date = Date.parse(String(value));
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    return delta > 0 ? Math.min(delta, 60_000) : null;
  }
  return null;
}

export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 2_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const budgetMs = options.budgetMs;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const startedAt = Date.now();

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === maxRetries) throw error;

      const hinted = retryAfterMs(error);
      const exponential = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      // Jitter avoids several workers retrying against the same window.
      const delayMs = hinted ?? Math.round(exponential * (0.8 + random() * 0.4));

      // The retry budget is spent: re-throw so the caller can fail over to a
      // backup model instead of waiting out a rate limit that may last hours.
      if (budgetMs !== undefined && Date.now() - startedAt + delayMs > budgetMs) {
        options.onRetry?.({ attempt: attempt + 1, delayMs, error });
        throw error;
      }

      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
