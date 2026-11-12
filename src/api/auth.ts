import { createHash, timingSafeEqual } from "node:crypto";

export interface ApiKeyHeaders {
  authorization?: string | string[];
  "x-api-key"?: string | string[];
}

/** Extract an API key from Authorization, X-API-Key, or an `api_key` query value. */
export function extractApiKey(
  headers: ApiKeyHeaders,
  query?: Record<string, unknown>,
): string | null {
  const authorization = firstHeader(headers.authorization);
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }

  const apiKeyHeader = firstHeader(headers["x-api-key"]);
  if (apiKeyHeader) return apiKeyHeader.trim();

  const queryKey = query?.["api_key"];
  if (typeof queryKey === "string" && queryKey.trim()) return queryKey.trim();
  if (Array.isArray(queryKey)) {
    const first = queryKey.find((value): value is string => typeof value === "string");
    if (first?.trim()) return first.trim();
  }

  return null;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Constant-time API key comparison. Hashing first avoids leaking the key
 * length through timingSafeEqual's length requirement.
 */
export function apiKeysMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Paths that stay public even when OPENREELS_API_KEY is configured.
 *
 * Only the health check: the web app reads it to find out whether a key is
 * needed before it can show the sign-in screen. The API schema and the
 * interactive docs are not public - they describe the whole surface.
 */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set(["/api/v1/health"]);

/** Whether a request path requires authentication. */
export function requiresApiAuth(pathname: string): boolean {
  if (!pathname.startsWith("/api/v1/")) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return !PUBLIC_API_PATHS.has(normalized);
}
