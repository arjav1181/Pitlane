import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Queue } from "bullmq";
import { PACING_CONFIG } from "../agents/creative-director.js";
import { getArchetype } from "../config/archetype-registry.js";
import { PLATFORMS } from "../config/platforms.js";
import { validateOpenAICompatibleConfig } from "../providers/llm/compatible-config.js";
import { DirectorScore } from "../schema/director-score.js";
import { LLM_AUTH_TYPES, type LLMAuthType, type SearchProviderKey } from "../schema/providers.js";
import {
  CALLBACK_EVENTS,
  type CallbackEvent,
  isPrivateAddress,
  UnsafeCallbackUrlError,
  validateCallbackUrlSyntax,
} from "./callbacks.js";
import type { IdempotencyStore } from "./idempotency.js";
import type { JobCallbackData, JobData } from "./job-data.js";
import { buildPlaceholderMeta, createQueuedJob, readJobMeta, toPublicJob } from "./jobs.js";

export const MAX_BATCH_JOBS = 25;
export const MAX_METADATA_BYTES = 8192;
export const MAX_DIRECTION_BYTES = 10240;
export const MAX_TOPIC_LENGTH = 500;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const MAX_KEYS = 100;
const KEY_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]+$/;

function noAiAssetsDefault(): boolean {
  return (process.env["OPENREELS_NO_AI_ASSETS"] ?? "").toLowerCase() === "true";
}

export interface CreateJobContext {
  queue: Queue;
  jobsDir: string;
  idempotency: IdempotencyStore;
  allowPrivateCallbacks: boolean;
}

export interface CreateJobResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(error: string): CreateJobResult {
  return { status: 400, body: { error } };
}

function parseCallback(
  body: JsonObject,
  allowPrivate: boolean,
): {
  callbacks?: JobCallbackData;
  error?: string;
} {
  const nested = isObject(body["callback"]) ? body["callback"] : undefined;
  const url = body["callbackUrl"] ?? nested?.["url"];
  const secret = body["callbackSecret"] ?? nested?.["secret"];
  const rawEvents = body["callbackEvents"] ?? nested?.["events"];

  if (url === undefined || url === null || url === "") {
    if (secret !== undefined) return { error: "callbackSecret requires callbackUrl" };
    if (rawEvents !== undefined) return { error: "callbackEvents requires callbackUrl" };
    return {};
  }
  if (typeof url !== "string") return { error: "callbackUrl must be a string" };

  try {
    validateCallbackUrlSyntax(url);
  } catch (err) {
    return {
      error: err instanceof UnsafeCallbackUrlError ? err.message : "callbackUrl is invalid",
    };
  }

  // Reject literal local/private targets eagerly. DNS names are re-resolved and
  // checked at delivery time to keep job creation fast.
  try {
    const host = new URL(url).hostname.toLowerCase();
    const literalPrivate =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      (isIP(host) !== 0 && isPrivateAddress(host));
    if (literalPrivate && !allowPrivate) {
      return { error: "callbackUrl must not target localhost or a private address" };
    }
  } catch {
    return { error: "callbackUrl is invalid" };
  }

  if (secret !== undefined && secret !== null && secret !== "") {
    if (typeof secret !== "string") return { error: "callbackSecret must be a string" };
    if (secret.length > 512) return { error: "callbackSecret must be 512 characters or fewer" };
  }

  let events: CallbackEvent[] | undefined;
  if (rawEvents !== undefined && rawEvents !== null) {
    if (!Array.isArray(rawEvents)) return { error: "callbackEvents must be an array" };
    const parsedEvents: CallbackEvent[] = [];
    for (const event of rawEvents) {
      if (typeof event !== "string" || !CALLBACK_EVENTS.includes(event as CallbackEvent)) {
        return { error: `Unknown callback event. Available: ${CALLBACK_EVENTS.join(", ")}` };
      }
      if (!parsedEvents.includes(event as CallbackEvent)) parsedEvents.push(event as CallbackEvent);
    }
    if (parsedEvents.length === 0) return { error: "callbackEvents must not be empty" };
    events = parsedEvents;
  }

  return {
    callbacks: {
      url,
      ...(typeof secret === "string" && secret.length > 0 ? { secret } : {}),
      ...(events ? { events } : {}),
    },
  };
}

function parseIdempotencyKey(
  headerValue: string | undefined,
  body: JsonObject,
): { key?: string; error?: string } {
  const raw = headerValue ?? body["idempotencyKey"];
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return { error: "idempotencyKey must be a string" };
  const key = raw.trim();
  if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { error: `idempotencyKey must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters` };
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return { error: "idempotencyKey must contain printable ASCII characters only" };
  }
  return { key };
}

function parseKeys(raw: unknown): { keys?: Record<string, string>; error?: string } {
  if (raw === undefined || raw === null) return { keys: {} };
  if (!isObject(raw)) return { error: "keys must be an object of string values" };
  const entries = Object.entries(raw);
  if (entries.length > MAX_KEYS) return { error: `keys accepts at most ${MAX_KEYS} entries` };
  const keys: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!KEY_NAME_PATTERN.test(name)) return { error: `Invalid key name: ${name}` };
    if (typeof value !== "string") return { error: `keys.${name} must be a string` };
    if (value.length > 0) keys[name] = value;
  }
  return { keys };
}

function parseMetadata(raw: unknown): { metadata?: Record<string, unknown>; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) return { error: "metadata must be a JSON object" };
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { error: "metadata must be JSON-serializable" };
  }
  if (Buffer.byteLength(serialized, "utf-8") > MAX_METADATA_BYTES) {
    return { error: `metadata exceeds ${MAX_METADATA_BYTES} bytes` };
  }
  return { metadata: raw };
}

/** Validate a CreateJobRequest and enqueue it. Shared by POST /jobs, batch, and retry. */
export async function createJobFromBody(
  rawBody: unknown,
  headerIdempotencyKey: string | undefined,
  ctx: CreateJobContext,
): Promise<CreateJobResult> {
  if (!isObject(rawBody)) {
    return badRequest("Request body must be a JSON object");
  }
  const body = rawBody;

  const topic = body["topic"];
  if (typeof topic !== "string" || topic.trim().length === 0) {
    return badRequest("topic is required");
  }
  if (topic.trim().length > MAX_TOPIC_LENGTH) {
    return badRequest(`topic must be ${MAX_TOPIC_LENGTH} characters or fewer`);
  }

  const archetype = body["archetype"];
  if (archetype !== undefined && typeof archetype !== "string") {
    return badRequest("archetype must be a string");
  }
  if (typeof archetype === "string" && archetype) {
    try {
      getArchetype(archetype);
    } catch {
      return badRequest(`Unknown archetype: ${archetype}`);
    }
  }

  const pacing = body["pacing"];
  if (pacing !== undefined && typeof pacing !== "string") {
    return badRequest("pacing must be a string");
  }
  const validPacingTiers = Object.keys(PACING_CONFIG);
  if (typeof pacing === "string" && pacing && !validPacingTiers.includes(pacing)) {
    return badRequest(`Unknown pacing tier: ${pacing}. Available: ${validPacingTiers.join(", ")}`);
  }

  const platform = body["platform"];
  if (platform !== undefined && typeof platform !== "string") {
    return badRequest("platform must be a string");
  }
  const validPlatforms = Object.keys(PLATFORMS);
  if (typeof platform === "string" && platform && !validPlatforms.includes(platform)) {
    return badRequest(`Unknown platform: ${platform}. Available: ${validPlatforms.join(", ")}`);
  }

  const dryRun = body["dryRun"];
  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    return badRequest("dryRun must be a boolean");
  }
  for (const flag of ["noMusic", "noVideo", "noAiAssets"]) {
    const value = body[flag];
    if (value !== undefined && typeof value !== "boolean") {
      return badRequest(`${flag} must be a boolean`);
    }
  }

  const direction = body["direction"];
  if (direction !== undefined && direction !== null) {
    if (typeof direction !== "string") return badRequest("direction must be a string");
    if (Buffer.byteLength(direction, "utf-8") > MAX_DIRECTION_BYTES) {
      return badRequest("direction exceeds 10KB limit");
    }
  }

  const metadataResult = parseMetadata(body["metadata"]);
  if (metadataResult.error) return badRequest(metadataResult.error);

  const providersRaw = body["providers"];
  if (providersRaw !== undefined && providersRaw !== null && !isObject(providersRaw)) {
    return badRequest("providers must be an object");
  }
  const providers = isObject(providersRaw) ? providersRaw : {};

  const keysResult = parseKeys(body["keys"]);
  if (keysResult.error) return badRequest(keysResult.error);
  const keys = keysResult.keys ?? {};

  const llmAuthType = providers["llmAuthType"];
  if (llmAuthType !== undefined && !LLM_AUTH_TYPES.includes(llmAuthType as LLMAuthType)) {
    return badRequest(
      `Unknown llmAuthType: ${String(llmAuthType)}. Available: ${LLM_AUTH_TYPES.join(", ")}`,
    );
  }
  if (providers["llm"] !== undefined && typeof providers["llm"] !== "string") {
    return badRequest("providers.llm must be a string");
  }
  if (providers["llm"] === "openai-compatible") {
    const configError = validateOpenAICompatibleConfig({
      llmBaseUrl: providers["llmBaseUrl"] as string | undefined,
      llmModel: providers["llmModel"] as string | undefined,
      llmAuthType: llmAuthType as LLMAuthType | undefined,
      llmAuthHeader: providers["llmAuthHeader"] as string | undefined,
      apiKey: keys["OPENREELS_LLM_API_KEY"],
    });
    if (configError) return badRequest(configError);
  }

  const fallbackModelsRaw = providers["llmFallbackModels"];
  if (fallbackModelsRaw !== undefined && fallbackModelsRaw !== null) {
    if (!Array.isArray(fallbackModelsRaw)) {
      return badRequest("providers.llmFallbackModels must be an array of model IDs");
    }
    if (fallbackModelsRaw.length > 5) {
      return badRequest("providers.llmFallbackModels supports at most 5 models");
    }
    if (fallbackModelsRaw.some((model) => typeof model !== "string" || !model.trim())) {
      return badRequest("providers.llmFallbackModels must contain non-empty strings");
    }
  }
  const llmFallbackModels = Array.isArray(fallbackModelsRaw)
    ? (fallbackModelsRaw as string[]).map((model) => model.trim())
    : undefined;

  let validatedScore: unknown | undefined;
  const score = body["score"];
  if (score !== undefined && score !== null) {
    const result = DirectorScore.safeParse(score);
    if (!result.success) {
      return badRequest(`Invalid DirectorScore: ${result.error.message}`);
    }
    try {
      getArchetype((result.data as { archetype: string }).archetype);
    } catch {
      return badRequest(
        `Score references unknown archetype: ${(result.data as { archetype: string }).archetype}`,
      );
    }
    validatedScore = result.data;
  }

  const callbackResult = parseCallback(body, ctx.allowPrivateCallbacks);
  if (callbackResult.error) return badRequest(callbackResult.error);

  const idempotencyResult = parseIdempotencyKey(headerIdempotencyKey, body);
  if (idempotencyResult.error) return badRequest(idempotencyResult.error);
  const idempotencyKey = idempotencyResult.key;

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
      // The stored record points at job metadata we cannot read (corrupt or
      // partially deleted directory). Reclaim the key for the new job.
      ctx.idempotency.release(idempotencyKey);
      const reclaimed = ctx.idempotency.reserve(idempotencyKey, id);
      if (!reclaimed.reserved) {
        return {
          status: 409,
          body: { error: "Idempotency key is in use; retry the request" },
        };
      }
    }
  }

  const data: JobData = {
    topic: topic.trim(),
    ...(typeof archetype === "string" && archetype ? { archetype } : {}),
    ...(typeof pacing === "string" && pacing ? { pacing } : {}),
    platform: typeof platform === "string" && platform ? platform : "youtube",
    dryRun: dryRun === true,
    noMusic: body["noMusic"] === true,
    noVideo: body["noVideo"] === true,
    noAiAssets: body["noAiAssets"] === true || noAiAssetsDefault(),
    ...(typeof direction === "string" && direction.trim() ? { direction: direction.trim() } : {}),
    ...(validatedScore ? { score: validatedScore as Record<string, unknown> } : {}),
    ...(metadataResult.metadata ? { metadata: metadataResult.metadata } : {}),
    ...(callbackResult.callbacks ? { callbacks: callbackResult.callbacks } : {}),
    providers: {
      llm: (providers["llm"] as string | undefined) ?? "anthropic",
      tts: (providers["tts"] as string | undefined) ?? "elevenlabs",
      image: (providers["image"] as string | undefined) ?? "gemini",
      stock: (providers["stock"] as string | undefined) ?? "pexels",
      video: providers["video"] as string | undefined,
      videoModel: providers["videoModel"] as string | undefined,
      music: (providers["music"] as string | undefined) ?? "bundled",
      llmModel: providers["llmModel"] as string | undefined,
      llmFallbackModels,
      llmBaseUrl: providers["llmBaseUrl"] as string | undefined,
      // Leave undefined when omitted so the worker can fall back to env.
      llmAuthType: llmAuthType as LLMAuthType | undefined,
      llmAuthHeader: providers["llmAuthHeader"] as string | undefined,
      searchProvider: providers["searchProvider"] as SearchProviderKey | undefined,
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
    if (idempotencyKey) ctx.idempotency.release(idempotencyKey);
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 500,
      body: { error: `Failed to enqueue job: ${message}` },
    };
  }
}

/** Re-enqueue a job from its stored metadata and (when available) its BullMQ payload. */
export async function retryJob(
  id: string,
  ctx: CreateJobContext & { getJobData: (id: string) => Promise<JobData | null> },
): Promise<CreateJobResult> {
  const meta = readJobMeta(ctx.jobsDir, id);
  if (!meta) return { status: 404, body: { error: "Job not found" } };

  if (meta.status === "running" || meta.status === "queued") {
    return { status: 409, body: { error: `Job is ${meta.status}` } };
  }

  const originalData = await ctx.getJobData(id);
  const request = meta.request;
  const topic = meta.topic || originalData?.topic;
  if (!topic) return { status: 409, body: { error: "Job request data is unavailable" } };
  if (!originalData && !request) {
    return {
      status: 409,
      body: { error: "Job request data is unavailable; create a new job instead" },
    };
  }

  const replayId = randomUUID();
  const data: JobData = originalData
    ? { ...originalData, jobsDir: ctx.jobsDir }
    : {
        topic,
        ...(meta.archetype ? { archetype: meta.archetype } : {}),
        ...(meta.pacing ? { pacing: meta.pacing } : {}),
        platform: meta.platform ?? request?.platform ?? "youtube",
        dryRun: request?.dryRun === true,
        noMusic: meta.noMusic === true,
        noVideo: meta.noVideo === true,
        noAiAssets: meta.noAiAssets === true,
        ...(meta.score ? { score: meta.score as Record<string, unknown> } : {}),
        ...(meta.metadata ? { metadata: meta.metadata } : {}),
        providers: request?.providers ?? {
          llm: "anthropic",
          tts: "elevenlabs",
          image: "gemini",
          stock: "pexels",
          music: "bundled",
        },
        keys: {},
        jobsDir: ctx.jobsDir,
      };

  if (meta.score) data.score = meta.score as Record<string, unknown>;
  if (meta.metadata) data.metadata = meta.metadata;
  data.noAiAssets = data.noAiAssets === true || meta.noAiAssets === true || noAiAssetsDefault();

  try {
    await createQueuedJob(ctx.queue, ctx.jobsDir, data, { id: replayId, retryOf: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { error: `Failed to enqueue job: ${message}` } };
  }

  const newMeta =
    readJobMeta(ctx.jobsDir, replayId) ?? buildPlaceholderMeta(replayId, data, { retryOf: id });
  return {
    status: 201,
    body: toPublicJob(newMeta),
    headers: { Location: `/api/v1/jobs/${replayId}` },
  };
}
