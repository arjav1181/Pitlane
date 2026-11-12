import type { LLMAuthType } from "@/hooks/useApi";

const STORAGE_KEY = "openreels.credentials.v1";
const REMEMBER_KEY = "openreels.rememberCredentials.v1";

const AUTH_TYPES: LLMAuthType[] = ["auto", "none", "bearer", "custom-header"];

/** Auth modes offered for OpenAI-compatible endpoints. */
export const AUTH_OPTIONS: { value: LLMAuthType; label: string }[] = [
  { value: "auto", label: "Auto (Bearer when a key is set)" },
  { value: "bearer", label: "Bearer token" },
  { value: "custom-header", label: "Custom header" },
  { value: "none", label: "No auth" },
];

/** Display label for each auth mode. */
export const AUTH_LABELS: Record<LLMAuthType, string> = Object.fromEntries(
  AUTH_OPTIONS.map((option) => [option.value, option.label]),
) as Record<LLMAuthType, string>;

const STRING_FIELDS = [
  "llmProvider",
  "llmModel",
  "llmBaseUrl",
  "llmApiKey",
  "llmAuthHeader",
  "ttsProvider",
  "imageProvider",
  "musicProvider",
  "searchProvider",
] as const;

/**
 * Credentials and provider settings remembered in the browser.
 *
 * Stored in `localStorage`, which means the values are readable by any script
 * running on this origin and are never encrypted. They are only sent to the
 * OpenReels API when a job is created.
 */
export interface SavedCredentials {
  llmProvider?: string;
  llmModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmAuthType?: LLMAuthType;
  llmAuthHeader?: string;
  ttsProvider?: string;
  imageProvider?: string;
  musicProvider?: string;
  searchProvider?: string;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Access to localStorage can throw in privacy modes.
    return null;
  }
}

/** Read saved credentials. Returns null when nothing is stored or the payload is invalid. */
export function loadCredentials(): SavedCredentials | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    // Only keep known fields with the expected types — the payload is user-writable.
    const source = parsed as Record<string, unknown>;
    const credentials: SavedCredentials = {};
    for (const field of STRING_FIELDS) {
      const value = source[field];
      if (typeof value === "string") credentials[field] = value;
    }
    const authType = source.llmAuthType;
    if (typeof authType === "string" && AUTH_TYPES.includes(authType as LLMAuthType)) {
      credentials.llmAuthType = authType as LLMAuthType;
    }
    return credentials;
  } catch {
    return null;
  }
}

/** Persist credentials in the browser. Silently no-ops when storage is unavailable. */
export function saveCredentials(credentials: SavedCredentials): void {
  const store = storage();
  if (!store) return;
  // Don't create an entry for a browser that has nothing worth remembering yet.
  const hasValue = Boolean(
    credentials.llmApiKey ||
      credentials.llmBaseUrl ||
      credentials.llmModel ||
      credentials.llmAuthHeader,
  );
  if (!hasValue && !loadCredentials()) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(credentials));
    store.setItem(REMEMBER_KEY, "true");
  } catch {
    // Quota exceeded or storage disabled — credentials simply are not remembered.
  }
}

/** Remove saved credentials from the browser and opt out of remembering them. */
export function clearCredentials(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
    store.setItem(REMEMBER_KEY, "false");
  } catch {
    // Ignore — nothing else we can do.
  }
}

/**
 * Whether the user has opted in to remembering credentials.
 *
 * Defaults to false so credentials are never written to `localStorage` without
 * an explicit choice. Existing saved credentials count as an opt-in.
 */
export function loadRememberPreference(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const raw = store.getItem(REMEMBER_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    return false;
  }
  return loadCredentials() !== null;
}

/** Record the opt-in without touching the saved credentials themselves. */
export function saveRememberPreference(remember: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(REMEMBER_KEY, remember ? "true" : "false");
  } catch {
    // Preference is not critical — ignore storage failures.
  }
}

/** Provider settings with fallbacks applied, ready to seed a form. */
export interface CredentialDefaults {
  llmProvider: string;
  llmModel: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmAuthType: LLMAuthType;
  llmAuthHeader: string;
  ttsProvider: string;
  imageProvider: string;
  musicProvider: string;
  searchProvider: string;
}

/** Load saved credentials and fill in the defaults for anything not stored. */
export function loadCredentialDefaults(): CredentialDefaults {
  const saved = loadCredentials();
  return {
    llmProvider: saved?.llmProvider || "anthropic",
    llmModel: saved?.llmModel || "",
    llmBaseUrl: saved?.llmBaseUrl || "",
    llmApiKey: saved?.llmApiKey || "",
    llmAuthType: saved?.llmAuthType || "auto",
    llmAuthHeader: saved?.llmAuthHeader || "",
    ttsProvider: saved?.ttsProvider || "elevenlabs",
    imageProvider: saved?.imageProvider || "gemini",
    musicProvider: saved?.musicProvider || "bundled",
    searchProvider: saved?.searchProvider || "",
  };
}

/** Mask a secret for display, e.g. `sk-abc...wxyz`. */
export function maskSecret(secret?: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}${"•".repeat(8)}${secret.slice(-4)}`;
}
