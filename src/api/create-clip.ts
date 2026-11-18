import { randomUUID } from "node:crypto";
import { normalizeClipSpec } from "../clip/spec.js";
import { isPrivateAddress } from "./callbacks.js";
import type { JobData } from "./job-data.js";
import { createQueuedJob, readJobMeta, toPublicJob } from "./jobs.js";
import type { CreateJobContext, CreateJobResult } from "./create-job.js";
import type { LLMAuthType } from "../schema/providers.js";

/**
 * `POST /api/v1/clips`
 *
 * A clip request is a job like any other: it goes on the same queue, shows up
 * in the same listing, and is cancelled and retried through the same endpoints.
 * Only the spec is different, so this file validates the spec and then hands
 * over to the shared job writer.
 */

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(error: string): CreateJobResult {
  return { status: 400, body: { error } };
}

function defaultLLMProvider(): string {
  return (process.env["OPENREELS_LLM_BASE_URL"] ?? "").trim() ? "openai-compatible" : "anthropic";
}

/**
 * Reject a source the worker must not fetch.
 *
 * The downloader runs on the same network as Redis and the job store, so a
 * source URL is an outbound request chosen by the caller. Literal private
 * addresses and loopback names are refused here; public hosts are used as
 * given, because only the downloader can resolve them.
 */
function unsafeSourceHost(rawUrl: string): string | null {
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return "sourceUrl is not a valid URL";
  }
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    return "sourceUrl must point at a public host";
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower) && isPrivateAddress(lower)) {
    return "sourceUrl must point at a public host";
  }
  if (lower.includes(":") && isPrivateAddress(lower)) {
    return "sourceUrl must point at a public host";
  }
  return null;
}

export async function createClipFromBody(
  rawBody: unknown,
  headerIdempotencyKey: string | undefined,
  ctx: CreateJobContext,
): Promise<CreateJobResult> {
  if (!isObject(rawBody)) return badRequest("Request body must be a JSON object");

  // Accept the spec both at the top level and under `clip`, because a caller
  // that already sends `{ "clip": { ... } }` should not have to change shape.
  const nested = isObject(rawBody["clip"]) ? rawBody["clip"] : undefined;
  const specSource = nested ? { ...rawBody, ...nested } : rawBody;

  let spec: ReturnType<typeof normalizeClipSpec>;
  try {
    spec = normalizeClipSpec(specSource);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return badRequest(`Invalid clip spec: ${message}`);
  }

  const hostError = unsafeSourceHost(spec.sourceUrl);
  if (hostError) return badRequest(hostError);

  const providersRaw = rawBody["providers"];
  if (providersRaw !== undefined && providersRaw !== null && !isObject(providersRaw)) {
    return badRequest("providers must be an object");
  }
  const providers = isObject(providersRaw) ? providersRaw : {};

  const keysRaw = rawBody["keys"];
  if (keysRaw !== undefined && keysRaw !== null && !isObject(keysRaw)) {
    return badRequest("keys must be an object");
  }
  const keys: Record<string, string> = {};
  if (isObject(keysRaw)) {
    for (const [name, value] of Object.entries(keysRaw)) {
      if (typeof value !== "string") return badRequest(`keys.${name} must be a string`);
      keys[name] = value;
    }
  }

  const metadata = rawBody["metadata"];
  if (metadata !== undefined && metadata !== null && !isObject(metadata)) {
    return badRequest("metadata must be an object");
  }

  const idempotencyKey =
    headerIdempotencyKey ??
    (typeof rawBody["idempotencyKey"] === "string" ? rawBody["idempotencyKey"] : undefined);
  if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return badRequest(`idempotency-key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer`);
  }

  if (idempotencyKey) {
    const existing = ctx.idempotency.get(idempotencyKey);
    if (existing) {
      const existingMeta = readJobMeta(ctx.jobsDir, existing.jobId);
      if (existingMeta) {
        return {
          status: 200,
          body: toPublicJob(existingMeta),
          headers: { "Idempotency-Replayed": "true" },
        };
      }
    }
  }

  const id = randomUUID();
  if (idempotencyKey) {
    const reservation = ctx.idempotency.reserve(idempotencyKey, id);
    if (!reservation.reserved) {
      const existingMeta = readJobMeta(ctx.jobsDir, reservation.record.jobId);
      if (existingMeta) {
        return {
          status: 200,
          body: toPublicJob(existingMeta),
          headers: { "Idempotency-Replayed": "true" },
        };
      }
      ctx.idempotency.release(idempotencyKey);
      ctx.idempotency.reserve(idempotencyKey, id);
    }
  }

  const data: JobData = {
    kind: "clip",
    clip: spec,
    topic: (spec.title ?? `Clips from ${new URL(spec.sourceUrl).hostname}`).slice(0, 500),
    platform: "youtube",
    dryRun: false,
    noAiAssets: true,
    ...(metadata ? { metadata: metadata as Record<string, unknown> } : {}),
    providers: {
      llm: (providers["llm"] as string | undefined) ?? defaultLLMProvider(),
      tts: "kokoro",
      image: "gemini",
      stock: "all",
      music: "bundled",
      llmModel: providers["llmModel"] as string | undefined,
      llmFallbackModels: Array.isArray(providers["llmFallbackModels"])
        ? (providers["llmFallbackModels"] as string[])
        : undefined,
      llmBaseUrl: providers["llmBaseUrl"] as string | undefined,
      llmAuthType: providers["llmAuthType"] as LLMAuthType | undefined,
      llmAuthHeader: providers["llmAuthHeader"] as string | undefined,
    },
    keys,
    jobsDir: ctx.jobsDir,
  };

  try {
    const { id: createdId, meta } = await createQueuedJob(ctx.queue, ctx.jobsDir, data, { id });
    return {
      status: 201,
      body: toPublicJob(meta),
      headers: { Location: `/api/v1/jobs/${createdId}` },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { error: `Failed to enqueue the clip job: ${message}` } };
  }
}
