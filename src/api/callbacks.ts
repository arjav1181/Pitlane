import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { VERSION } from "./version.js";

export type CallbackEvent = "job.completed" | "job.failed" | "job.cancelled";

export const CALLBACK_EVENTS: readonly CallbackEvent[] = [
  "job.completed",
  "job.failed",
  "job.cancelled",
];

export interface CallbackConfig {
  url: string;
  /** HMAC-SHA256 signing secret. Never persisted to meta.json. */
  secret?: string;
  /** Restrict which events are delivered. Defaults to all events. */
  events?: CallbackEvent[];
}

export interface CallbackPayload {
  event: CallbackEvent;
  jobId: string;
  status: string;
  topic?: string;
  createdAt?: string;
  completedAt?: string;
  videoPath?: string;
  runDir?: string;
  error?: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface CallbackDeliveryResult {
  delivered: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
}

export class UnsafeCallbackUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCallbackUrlError";
  }
}

export type CallbackAddressResolver = (hostname: string) => Promise<string[]>;

const MAX_CALLBACK_URL_LENGTH = 2048;

/** True for loopback, private, link-local, CGNAT, multicast, and non-routable addresses. */
export function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;

  if (host.startsWith("::ffff:")) {
    return isPrivateIpv4(host.slice("::ffff:".length));
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    const first = Number.parseInt(host.split(":")[0] || "0", 16);
    if (!Number.isFinite(first)) return true;
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
    if ((first & 0xfe00) === 0xfc00) return true;
    if ((first & 0xffc0) === 0xfe80) return true;
    if ((first & 0xff00) === 0xff00) return true;
    if (first === 0) return true;
    return false;
  }

  return isPrivateIpv4(host);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    // Fail closed for malformed addresses.
    return true;
  }

  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // documentation
  if (a === 203 && b === 0) return true; // documentation
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Validate a callback URL without doing DNS work. Used when a job is created
 * so bad URLs fail fast; SSRF resolution happens again at delivery time.
 */
export function validateCallbackUrlSyntax(raw: string): URL {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new UnsafeCallbackUrlError("callbackUrl is required when callbacks are enabled");
  }
  if (raw.length > MAX_CALLBACK_URL_LENGTH) {
    throw new UnsafeCallbackUrlError(
      `callbackUrl must be ${MAX_CALLBACK_URL_LENGTH} characters or fewer`,
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeCallbackUrlError("callbackUrl must be a valid absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeCallbackUrlError("callbackUrl must use http or https");
  }
  if (url.username || url.password) {
    throw new UnsafeCallbackUrlError("callbackUrl must not contain credentials");
  }

  return url;
}

/**
 * Resolve a callback URL and reject it when it points at a private network.
 * DNS rebinding is still theoretically possible between this check and the
 * request; pair webhooks with a trusted receiver and do not expose the API
 * publicly without authentication.
 */
export async function assertSafeCallbackUrl(
  raw: string,
  options: {
    allowPrivate?: boolean;
    resolve?: CallbackAddressResolver;
  } = {},
): Promise<URL> {
  const url = validateCallbackUrlSyntax(raw);
  if (options.allowPrivate) return url;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new UnsafeCallbackUrlError("callbackUrl must not target localhost");
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new UnsafeCallbackUrlError("callbackUrl must not target a private address");
    }
    return url;
  }

  let addresses: string[];
  try {
    addresses = options.resolve
      ? await options.resolve(host)
      : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  } catch {
    throw new UnsafeCallbackUrlError(`Could not resolve callback host: ${host}`);
  }

  if (addresses.length === 0) {
    throw new UnsafeCallbackUrlError(`Could not resolve callback host: ${host}`);
  }
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new UnsafeCallbackUrlError("callbackUrl must not target a private address");
  }

  return url;
}

/** HMAC-SHA256 over `${timestamp}.${rawBody}`. */
export function signCallbackPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function callbackAllowsEvent(config: CallbackConfig, event: CallbackEvent): boolean {
  if (!config.events || config.events.length === 0) return true;
  return config.events.includes(event);
}

/**
 * Deliver a signed webhook with bounded retries. Never throws: callback
 * failures are reported to the caller and must not fail the render job.
 */
export async function deliverCallback(
  config: CallbackConfig,
  payload: CallbackPayload,
  options: {
    allowPrivate?: boolean;
    fetchImpl?: typeof fetch;
    resolve?: CallbackAddressResolver;
    maxAttempts?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
  } = {},
): Promise<CallbackDeliveryResult> {
  if (!callbackAllowsEvent(config, payload.event)) {
    return { delivered: false, attempts: 0, error: "event not subscribed" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const rawBody = JSON.stringify(payload);
  let lastStatus: number | undefined;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = await assertSafeCallbackUrl(config.url, {
        allowPrivate: options.allowPrivate,
        resolve: options.resolve,
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": `OpenReels/${VERSION}`,
        "X-OpenReels-Event": payload.event,
        "X-OpenReels-Job-Id": payload.jobId,
        "X-OpenReels-Delivery": randomUUID(),
        "X-OpenReels-Timestamp": timestamp,
      };
      if (config.secret) {
        headers["X-OpenReels-Signature"] = `sha256=${signCallbackPayload(
          config.secret,
          timestamp,
          rawBody,
        )}`;
      }

      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: rawBody,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = response.status;

      // Drain the body so sockets are released.
      await response.text().catch(() => "");

      if (response.status >= 200 && response.status < 300) {
        return { delivered: true, attempts: attempt, statusCode: response.status };
      }
      lastError = `callback returned HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof UnsafeCallbackUrlError) {
        // Permanent configuration/security failure — do not retry.
        return { delivered: false, attempts: attempt, error: lastError };
      }
    }

    if (attempt < maxAttempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }

  return {
    delivered: false,
    attempts: maxAttempts,
    ...(lastStatus !== undefined ? { statusCode: lastStatus } : {}),
    error: lastError || "callback delivery failed",
  };
}
