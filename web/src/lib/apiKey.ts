const STORAGE_KEY = "openreels.apiKey.v1";

/**
 * Optional API key for the OpenReels server (`OPENREELS_API_KEY`).
 *
 * Stored in this browser's localStorage so the UI can call an authenticated
 * server. It is not a provider key and is never sent with the job payload.
 */
export function loadApiKey(): string {
  try {
    return (localStorage.getItem(STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function saveApiKey(value: string): void {
  const key = value.trim();
  try {
    if (key) {
      localStorage.setItem(STORAGE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Headers for fetch-based API calls. */
export function apiKeyHeaders(): Record<string, string> {
  const key = loadApiKey();
  return key ? { "X-API-Key": key } : {};
}

/**
 * Add `?api_key=` to a URL for EventSource, media, and download links that
 * cannot set request headers.
 */
export function withApiKey(url: string): string {
  const key = loadApiKey();
  if (!key) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}api_key=${encodeURIComponent(key)}`;
}
