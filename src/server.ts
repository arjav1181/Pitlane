import * as fs from "node:fs";
import * as path from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { type Job, Queue, QueueEvents } from "bullmq";
import Fastify from "fastify";
import IORedis from "ioredis";
import { apiKeysMatch, extractApiKey, requiresApiAuth } from "./api/auth.js";
import {
  CALLBACK_EVENTS,
  type CallbackEvent,
  type CallbackPayload,
  deliverCallback,
} from "./api/callbacks.js";
import {
  createJobFromBody,
  MAX_BATCH_JOBS,
  MAX_DIRECTION_BYTES,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_METADATA_BYTES,
  MAX_TOPIC_LENGTH,
  retryJob,
} from "./api/create-job.js";
import { createIdempotencyStore } from "./api/idempotency.js";
import type { JobData } from "./api/job-data.js";
import type { JobMeta } from "./api/job-meta.js";
import {
  buildJobLinks,
  contentTypeFor,
  findRunDir,
  findVideoPath,
  isValidJobId,
  jobDirFor,
  listArtifacts,
  listJobMetas,
  readJobMeta,
  resolveArtifact,
  STAGE_NAMES,
  toPublicJob,
  writeJobMeta,
} from "./api/jobs.js";
import { buildOpenApiDocument, renderDocsHtml } from "./api/openapi.js";
import { VERSION } from "./api/version.js";
import { getArchetype, listArchetypes } from "./config/archetype-registry.js";
import { PLATFORMS } from "./config/platforms.js";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const PORT = Number(process.env["PORT"] ?? 3000);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const JOBS_DIR = process.env["JOBS_DIR"] ?? path.join(process.cwd(), "jobs");
const MAX_JOBS = process.env["MAX_JOBS"] ? Number(process.env["MAX_JOBS"]) : 0;
const WEB_DIST = path.join(process.cwd(), "web", "dist");
const API_KEY = process.env["OPENREELS_API_KEY"]?.trim() || null;
/**
 * Fail closed: refuse every API request when no key is configured.
 *
 * A public deployment that forgets to set the key would otherwise expose the
 * whole API to anyone who finds the URL. With this on, a missing key is a
 * 503 rather than an open door.
 */
const AUTH_REQUIRED = (process.env["OPENREELS_AUTH_REQUIRED"] ?? "").toLowerCase() === "true";
const ALLOW_PRIVATE_CALLBACKS =
  (process.env["OPENREELS_ALLOW_PRIVATE_CALLBACKS"] ?? "").toLowerCase() === "true";
const CORS_ORIGIN = process.env["OPENREELS_CORS_ORIGIN"];

fs.mkdirSync(JOBS_DIR, { recursive: true });

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("openreels", { connection: redis });
// Each open SSE stream attaches a "removed" listener to the local queue.
queue.setMaxListeners(0);
const queueEvents = new QueueEvents("openreels", { connection: redis.duplicate() });
const idempotency = createIdempotencyStore(JOBS_DIR);

const app = Fastify({ logger: true });

const corsOptions =
  CORS_ORIGIN === "false"
    ? { origin: false }
    : CORS_ORIGIN && CORS_ORIGIN !== "*"
      ? {
          origin: CORS_ORIGIN.split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
        }
      : { origin: true };

await app.register(cors, {
  ...corsOptions,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-API-Key",
    "Idempotency-Key",
    "Last-Event-ID",
  ],
  exposedHeaders: ["Idempotency-Replayed", "Location"],
});

// Serve job artifacts from the jobs directory.
// The plugin is registered for its reply.sendFile helper only; wildcard is off
// so it does not shadow the /api/v1/jobs/:id/artifacts/* route below.
await app.register(fastifyStatic, {
  root: JOBS_DIR,
  prefix: "/api/v1/jobs/",
  serve: false, // served manually for path traversal protection
  wildcard: false,
});

// --- API key authentication ---
app.addHook("onRequest", async (request, reply) => {
  const pathname = (request.raw.url ?? request.url).split("?")[0] ?? request.url;

  // Fail closed: without a configured key there is nothing to check against.
  if (!API_KEY) {
    if (!AUTH_REQUIRED) return;
    if (!pathname.startsWith("/api/v1/")) return;
    return reply
      .status(503)
      .send({ error: "Server is not configured for authentication" });
  }

  if (!requiresApiAuth(pathname)) return;

  const provided = extractApiKey(
    request.headers as { authorization?: string; "x-api-key"?: string },
    request.query as Record<string, unknown>,
  );
  if (!apiKeysMatch(provided, API_KEY)) {
    reply.header("WWW-Authenticate", 'Bearer realm="openreels"');
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

const PROVIDERS = {
  llm: [
    { key: "anthropic", label: "Anthropic (Claude)" },
    { key: "openai", label: "OpenAI (GPT)" },
    { key: "gemini", label: "Google Gemini" },
    { key: "openrouter", label: "OpenRouter" },
    { key: "openai-compatible", label: "Custom (OpenAI-compatible)" },
  ],
  search: [
    { key: "native", label: "Native (provider built-in)" },
    { key: "tavily", label: "Tavily" },
    { key: "none", label: "None (parametric knowledge)" },
  ],
  tts: [
    { key: "elevenlabs", label: "ElevenLabs" },
    { key: "inworld", label: "Inworld" },
    { key: "kokoro", label: "Kokoro (Local)" },
    { key: "gemini-tts", label: "Gemini TTS" },
    { key: "openai-tts", label: "OpenAI TTS" },
  ],
  image: [
    { key: "gemini", label: "Google Gemini" },
    { key: "openai", label: "OpenAI (GPT Image)" },
  ],
  video: [
    { key: "gemini", label: "Google Veo" },
    { key: "fal", label: "fal.ai (Kling, Wan, etc.)" },
  ],
};

// --- Health check ---
app.get("/api/v1/health", async () => {
  let redisOk = false;
  try {
    await redis.ping();
    redisOk = true;
  } catch {}

  const jobsDirStats = fs.statSync(JOBS_DIR, { throwIfNoEntry: false });

  return {
    status: redisOk ? "healthy" : "degraded",
    version: VERSION,
    redis: redisOk ? "connected" : "disconnected",
    jobsDir: jobsDirStats ? "exists" : "missing",
    apiKeyRequired: API_KEY !== null,
    authRequired: AUTH_REQUIRED,
    callbacks: true,
    noAiAssets: true,
    keys: {
      ANTHROPIC_API_KEY: !!process.env["ANTHROPIC_API_KEY"],
      OPENAI_API_KEY: !!process.env["OPENAI_API_KEY"],
      GOOGLE_API_KEY: !!process.env["GOOGLE_API_KEY"],
      ELEVENLABS_API_KEY: !!process.env["ELEVENLABS_API_KEY"],
      INWORLD_TTS_API_KEY: !!process.env["INWORLD_TTS_API_KEY"],
      PEXELS_API_KEY: !!process.env["PEXELS_API_KEY"],
      PIXABAY_API_KEY: !!process.env["PIXABAY_API_KEY"],
      OPENROUTER_API_KEY: !!process.env["OPENROUTER_API_KEY"],
      OPENREELS_LLM_API_KEY: !!process.env["OPENREELS_LLM_API_KEY"],
    },
  };
});

app.get("/api/v1/openapi.json", async (_request, reply) => {
  return reply
    .type("application/json")
    .send(buildOpenApiDocument({ apiKeyRequired: API_KEY !== null }));
});

app.get("/api/v1/docs", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(renderDocsHtml());
});

app.get("/api/v1/capabilities", async () => ({
  version: VERSION,
  apiKeyRequired: API_KEY !== null,
  features: {
    noAiAssets: true,
    callbacks: true,
    idempotency: true,
    batchJobs: true,
    jobRetry: true,
    sse: true,
    artifactListing: true,
  },
  providers: PROVIDERS,
  platforms: Object.entries(PLATFORMS).map(([name, config]) => ({
    name,
    width: config.width,
    height: config.height,
    fps: config.fps,
    maxDurationSeconds: config.maxDurationSeconds,
  })),
  limits: {
    maxTopicLength: MAX_TOPIC_LENGTH,
    maxDirectionBytes: MAX_DIRECTION_BYTES,
    maxMetadataBytes: MAX_METADATA_BYTES,
    maxBatchJobs: MAX_BATCH_JOBS,
    maxJobsPerPage: 100,
    maxIdempotencyKeyLength: MAX_IDEMPOTENCY_KEY_LENGTH,
  },
  callbacks: {
    events: CALLBACK_EVENTS,
    signature: "HMAC-SHA256",
    signatureHeader: "X-OpenReels-Signature",
    signatureFormat: "sha256=<hex digest of `${timestamp}.${rawBody}`>",
    allowPrivateCallbacks: ALLOW_PRIVATE_CALLBACKS,
  },
  idempotency: { header: "Idempotency-Key" },
  stages: STAGE_NAMES,
}));

// --- Aggregate stats ---
app.get("/api/v1/stats", async () => {
  if (!fs.existsSync(JOBS_DIR)) {
    return { totalJobs: 0, completedJobs: 0, failedJobs: 0, activeJobs: 0, totalCost: 0 };
  }

  let totalJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let activeJobs = 0;
  let totalCost = 0;

  const dirs = fs.readdirSync(JOBS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  await Promise.all(
    dirs.map(async (d) => {
      const metaPath = path.join(JOBS_DIR, d.name, "meta.json");
      try {
        const raw = await fs.promises.readFile(metaPath, "utf-8");
        const meta = JSON.parse(raw);
        totalJobs++;
        if (meta.status === "completed") {
          completedJobs++;
          const cost = meta.actualCost?.totalCost ?? meta.costEstimate?.totalCost ?? 0;
          totalCost += cost;
        } else if (meta.status === "failed" || meta.status === "cancelled") {
          failedJobs++;
        } else if (meta.status === "running" || meta.status === "queued") {
          activeJobs++;
        }
      } catch {}
    }),
  );

  return {
    totalJobs,
    completedJobs,
    failedJobs,
    activeJobs,
    totalCost: Math.round(totalCost * 100) / 100,
  };
});

// --- Archetypes ---
app.get("/api/v1/archetypes", async () => {
  const names = listArchetypes();
  return names.map((name) => {
    const config = getArchetype(name);
    return {
      name,
      captionStyle: config.captionStyle,
      artStyle: config.artStyle,
      mood: config.mood,
      colorPalette: config.colorPalette,
      visualColorPalette: config.visualColorPalette,
      scenePacing: config.scenePacing,
      motionIntensity: config.motionIntensity,
    };
  });
});

// --- Platforms ---
app.get("/api/v1/platforms", async () => {
  return Object.entries(PLATFORMS).map(([name, config]) => ({
    name,
    width: config.width,
    height: config.height,
    fps: config.fps,
    maxDurationSeconds: config.maxDurationSeconds,
  }));
});

// --- Providers list ---
app.get("/api/v1/providers", async () => PROVIDERS);

// --- Job creation ---
const createJobContext = {
  queue,
  jobsDir: JOBS_DIR,
  idempotency,
  allowPrivateCallbacks: ALLOW_PRIVATE_CALLBACKS,
};

app.post("/api/v1/jobs", async (request, reply) => {
  const headerKey = request.headers["idempotency-key"];
  const result = await createJobFromBody(
    request.body,
    Array.isArray(headerKey) ? headerKey[0] : headerKey,
    createJobContext,
  );
  if (result.headers) {
    for (const [name, value] of Object.entries(result.headers)) reply.header(name, value);
  }
  return reply.status(result.status).send(result.body);
});

app.post("/api/v1/jobs/batch", async (request, reply) => {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply.status(400).send({ error: "Request body must be a JSON object" });
  }
  const jobs = (body as Record<string, unknown>)["jobs"];
  if (!Array.isArray(jobs)) {
    return reply.status(400).send({ error: "jobs must be an array" });
  }
  if (jobs.length === 0) {
    return reply.status(400).send({ error: "jobs must contain at least one job" });
  }
  if (jobs.length > MAX_BATCH_JOBS) {
    return reply.status(400).send({ error: `jobs must contain at most ${MAX_BATCH_JOBS} jobs` });
  }

  const results = await Promise.all(
    jobs.map((item, index) =>
      createJobFromBody(item, undefined, createJobContext).then((result) => ({ index, result })),
    ),
  );

  const created = results
    .filter(({ result }) => result.status === 201 || result.status === 200)
    .map(({ result }) => result.body);
  const errors = results
    .filter(({ result }) => result.status !== 201 && result.status !== 200)
    .map(({ index, result }) => ({
      index,
      error: (result.body as { error?: string })?.error ?? `HTTP ${result.status}`,
    }));

  if (created.length === 0) {
    return reply.status(400).send({ error: "No jobs created", errors });
  }

  return reply.status(errors.length > 0 ? 207 : 201).send({ jobs: created, errors });
});

// --- Job listing ---
function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string");
  return undefined;
}

function parseDate(value: string | undefined, name: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an ISO-8601 timestamp`);
  return parsed;
}

app.get("/api/v1/jobs", async (request, reply) => {
  const query = request.query as Record<string, unknown>;
  const limitNum = Math.min(Math.max(Number(queryString(query["limit"])) || 20, 1), 100);
  const offsetNum = Math.max(Number(queryString(query["offset"])) || 0, 0);
  const statusFilter = new Set(
    (queryString(query["status"]) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const archetypeFilter = queryString(query["archetype"]);
  const platformFilter = queryString(query["platform"]);
  const textFilter = queryString(query["q"])?.toLowerCase();
  const sort = queryString(query["sort"]) === "oldest" ? "oldest" : "newest";

  let since: number | null;
  let until: number | null;
  try {
    since = parseDate(queryString(query["since"]), "since");
    until = parseDate(queryString(query["until"]), "until");
  } catch (err) {
    return reply.status(400).send({ error: (err as Error).message });
  }

  let jobs = listJobMetas(JOBS_DIR).filter(({ meta }) => {
    if (statusFilter.size > 0 && !statusFilter.has(meta.status)) return false;
    if (archetypeFilter && meta.archetype !== archetypeFilter) return false;
    if (platformFilter && (meta.platform ?? "youtube") !== platformFilter) return false;
    if (textFilter && !meta.topic.toLowerCase().includes(textFilter)) return false;
    if (since !== null || until !== null) {
      const createdAt = Date.parse(meta.createdAt);
      if (Number.isNaN(createdAt)) return false;
      if (since !== null && createdAt < since) return false;
      if (until !== null && createdAt > until) return false;
    }
    return true;
  });

  jobs = jobs.sort((a, b) => {
    const comparison = (a.meta.createdAt ?? "").localeCompare(b.meta.createdAt ?? "");
    return sort === "oldest" ? comparison : -comparison;
  });

  const total = jobs.length;
  return {
    jobs: jobs.slice(offsetNum, offsetNum + limitNum).map(({ meta }) => toPublicJob(meta)),
    total,
    limit: limitNum,
    offset: offsetNum,
    hasMore: offsetNum + limitNum < total,
  };
});

// --- Job detail ---
app.get<{ Params: { id: string } }>("/api/v1/jobs/:id", async (request, reply) => {
  if (!isValidJobId(request.params.id)) {
    return reply.status(400).send({ error: "Invalid job ID" });
  }
  const meta = readJobMeta(JOBS_DIR, request.params.id);
  if (!meta) {
    return reply.status(404).send({ error: "Job not found" });
  }
  return toPublicJob(meta);
});

// --- Job SSE events ---
app.get<{ Params: { id: string } }>("/api/v1/jobs/:id/events", async (request, reply) => {
  if (!isValidJobId(request.params.id)) {
    return reply.status(400).send({ error: "Invalid job ID" });
  }
  const jobId = request.params.id;

  const job = await queue.getJob(jobId);
  const meta = readJobMeta(JOBS_DIR, jobId);
  if (!job && !meta) {
    return reply.status(404).send({ error: "Job not found" });
  }

  // Finished jobs that were cleaned from Redis still replay their final state.
  if (!job && meta) {
    if (!["completed", "failed", "cancelled"].includes(meta.status)) {
      return reply.status(404).send({ error: "Job not found" });
    }
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(`event: job:snapshot\ndata: ${JSON.stringify(meta)}\n\n`);
    const terminalEvent =
      meta.status === "completed"
        ? "job:completed"
        : meta.status === "cancelled"
          ? "job:cancelled"
          : "job:failed";
    reply.raw.write(`event: ${terminalEvent}\ndata: ${JSON.stringify({ state: meta.status })}\n\n`);
    reply.raw.end();
    return;
  }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  if (meta) {
    reply.raw.write(`event: job:snapshot\ndata: ${JSON.stringify(meta)}\n\n`);
  }

  const state = await job?.getState();
  if (state === "completed" || state === "failed") {
    const event = meta?.status === "cancelled" ? "job:cancelled" : `job:${state}`;
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify({ state })}\n\n`);
    reply.raw.end();
    return;
  }

  let cleaned = false;
  const heartbeat = setInterval(() => {
    if (cleaned) return;
    try {
      reply.raw.write(": keep-alive\n\n");
    } catch {}
  }, 15_000);
  heartbeat.unref();

  const onProgress = ({ jobId: progressJobId, data }: { jobId: string; data: unknown }) => {
    if (cleaned || progressJobId !== jobId) return;
    try {
      const eventData = data as Record<string, unknown>;
      const stage = eventData["stage"] as string;
      reply.raw.write(`event: stage:${stage}\ndata: ${JSON.stringify(eventData)}\n\n`);
    } catch {}
  };

  const onCompleted = ({ jobId: completedJobId }: { jobId: string }) => {
    if (completedJobId !== jobId) return;
    try {
      const current = readJobMeta(JOBS_DIR, jobId);
      const event = current?.status === "cancelled" ? "job:cancelled" : "job:completed";
      reply.raw.write(
        `event: ${event}\ndata: ${JSON.stringify({ state: current?.status ?? "completed" })}\n\n`,
      );
    } catch {}
    cleanup();
  };

  const onFailed = ({
    jobId: failedJobId,
    failedReason,
  }: {
    jobId: string;
    failedReason: string;
  }) => {
    if (failedJobId !== jobId) return;
    try {
      const current = readJobMeta(JOBS_DIR, jobId);
      if (current?.status === "cancelled") {
        reply.raw.write(
          `event: job:cancelled\ndata: ${JSON.stringify({ state: "cancelled" })}\n\n`,
        );
      } else {
        reply.raw.write(
          `event: job:failed\ndata: ${JSON.stringify({ error: failedReason, state: "failed" })}\n\n`,
        );
      }
    } catch {}
    cleanup();
  };

  // Queued jobs are finalized by the server with `job.remove()`, which emits a
  // local Queue event rather than a QueueEvents stream message.
  const onRemoved = (removedJobId: string) => {
    if (removedJobId !== jobId) return;
    try {
      const current = readJobMeta(JOBS_DIR, jobId);
      if (current?.status === "cancelled") {
        reply.raw.write(
          `event: job:cancelled\ndata: ${JSON.stringify({ state: "cancelled" })}\n\n`,
        );
        cleanup();
      }
    } catch {}
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    queueEvents.off("progress", onProgress);
    queueEvents.off("completed", onCompleted);
    queueEvents.off("failed", onFailed);
    queue.off("removed", onRemoved);
    try {
      reply.raw.end();
    } catch {}
  };

  queueEvents.on("progress", onProgress);
  queueEvents.on("completed", onCompleted);
  queueEvents.on("failed", onFailed);
  queue.on("removed", onRemoved);
  request.raw.on("close", cleanup);
});

// --- Artifact listing ---
app.get<{ Params: { id: string } }>("/api/v1/jobs/:id/artifacts", async (request, reply) => {
  if (!isValidJobId(request.params.id)) {
    return reply.status(400).send({ error: "Invalid job ID" });
  }
  if (!readJobMeta(JOBS_DIR, request.params.id)) {
    return reply.status(404).send({ error: "Job not found" });
  }
  return { jobId: request.params.id, artifacts: listArtifacts(JOBS_DIR, request.params.id) };
});

// --- Artifact serving (with path traversal protection) ---
app.get<{ Params: { id: string; "*": string } }>(
  "/api/v1/jobs/:id/artifacts/*",
  async (request, reply) => {
    const resolution = resolveArtifact(JOBS_DIR, request.params.id, request.params["*"] ?? "");
    if (!resolution.ok) {
      return reply.status(resolution.status).send({ error: resolution.error });
    }
    // resolution.relativePath is relative to the job directory; sendFile
    // resolves against JOBS_DIR, so the job id has to be part of the path.
    return reply.sendFile(resolution.relativeToJobsDir, JOBS_DIR);
  },
);

// --- Video alias ---
app.get<{ Params: { id: string } }>("/api/v1/jobs/:id/video", async (request, reply) => {
  const meta = readJobMeta(JOBS_DIR, request.params.id);
  if (!meta) return reply.status(404).send({ error: "Job not found" });
  const videoPath = findVideoPath(JOBS_DIR, meta);
  if (!videoPath) return reply.status(404).send({ error: "Video not available" });
  // findVideoPath returns a path relative to the job directory; sendFile
  // resolves against JOBS_DIR, so the job id has to be part of the path.
  const relativeToJobs = path.join(meta.id, videoPath);
  return reply.type(contentTypeFor(videoPath)).sendFile(relativeToJobs, JOBS_DIR);
});

// --- Score alias ---
app.get<{ Params: { id: string } }>("/api/v1/jobs/:id/score", async (request, reply) => {
  const meta = readJobMeta(JOBS_DIR, request.params.id);
  if (!meta) return reply.status(404).send({ error: "Job not found" });
  if (meta.score) return reply.type("application/json").send(meta.score);

  const runDir = findRunDir(JOBS_DIR, meta);
  if (runDir) {
    const resolution = resolveArtifact(JOBS_DIR, meta.id, path.join(runDir, "score.json"));
    if (resolution.ok) {
      try {
        const score = JSON.parse(fs.readFileSync(resolution.fullPath, "utf-8"));
        return reply.type("application/json").send(score);
      } catch {}
    }
  }
  return reply.status(404).send({ error: "Score not available" });
});

// --- Log alias ---
app.get<{ Params: { id: string } }>("/api/v1/jobs/:id/log", async (request, reply) => {
  const meta = readJobMeta(JOBS_DIR, request.params.id);
  if (!meta) return reply.status(404).send({ error: "Job not found" });

  const runDir = findRunDir(JOBS_DIR, meta);
  if (runDir) {
    const resolution = resolveArtifact(JOBS_DIR, meta.id, path.join(runDir, "log.json"));
    if (resolution.ok) {
      try {
        const log = JSON.parse(fs.readFileSync(resolution.fullPath, "utf-8"));
        return reply.type("application/json").send(log);
      } catch {}
    }
  }
  return reply.status(404).send({ error: "Log not available" });
});

// --- Job retry ---
app.post<{ Params: { id: string } }>("/api/v1/jobs/:id/retry", async (request, reply) => {
  if (!isValidJobId(request.params.id)) {
    return reply.status(400).send({ error: "Invalid job ID" });
  }
  const result = await retryJob(request.params.id, {
    ...createJobContext,
    getJobData: async (id) => {
      const job = await queue.getJob(id);
      return job ? (job.data as JobData) : null;
    },
  });
  if (result.headers) {
    for (const [name, value] of Object.entries(result.headers)) reply.header(name, value);
  }
  return reply.status(result.status).send(result.body);
});

/** Deliver a terminal webhook from the server for jobs that never reach a worker. */
async function deliverServerCallback(
  job: Job<JobData>,
  meta: JobMeta,
  event: CallbackEvent,
  error?: string,
): Promise<void> {
  const callbacks = job.data.callbacks;
  if (!callbacks) return;
  if (meta.callbackEventsSent?.includes(event)) return;

  const payload: CallbackPayload = {
    event,
    jobId: meta.id,
    status: meta.status,
    topic: meta.topic,
    ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    ...(meta.completedAt ? { completedAt: meta.completedAt } : {}),
    ...(meta.videoPath ? { videoPath: meta.videoPath } : {}),
    ...(meta.runDir ? { runDir: meta.runDir } : {}),
    ...(error ? { error } : {}),
    ...(meta.metadata ? { metadata: meta.metadata } : {}),
    links: buildJobLinks(meta),
    timestamp: new Date().toISOString(),
  };

  const result = await deliverCallback(callbacks, payload, {
    allowPrivate: ALLOW_PRIVATE_CALLBACKS,
  });
  if (result.delivered) {
    meta.callbackEventsSent = [...(meta.callbackEventsSent ?? []), event];
    writeJobMeta(JOBS_DIR, meta.id, meta);
  } else {
    app.log.warn(
      { jobId: meta.id, event, error: result.error, attempts: result.attempts },
      "callback delivery failed",
    );
  }
}

// --- Job cancellation ---
app.post<{ Params: { id: string } }>("/api/v1/jobs/:id/cancel", async (request, reply) => {
  if (!isValidJobId(request.params.id)) {
    return reply.status(400).send({ error: "Invalid job ID" });
  }
  const jobId = request.params.id;
  const job = await queue.getJob(jobId);
  const meta = readJobMeta(JOBS_DIR, jobId);
  if (!job && !meta) {
    return reply.status(404).send({ error: "Job not found" });
  }

  if (meta && ["completed", "failed", "cancelled"].includes(meta.status)) {
    return reply.status(409).send({ error: `Job already ${meta.status}` });
  }

  const state = job ? await job.getState() : null;
  if (state === "completed" || state === "failed") {
    return reply.status(409).send({ error: `Job already ${state}` });
  }

  if (meta) {
    meta.cancelRequested = true;
    writeJobMeta(JOBS_DIR, jobId, meta);
  }

  if (state === "active") {
    // The worker observes cancelRequested and finalizes the job itself.
    return { status: "cancelled", requested: true };
  }

  // Queued/waiting/delayed jobs never reach the worker, so finalize them here.
  // The metadata is written *before* the job leaves the queue so that SSE
  // clients and the queue's own events never observe a stale status.
  if (meta) {
    meta.status = "cancelled";
    meta.error = "Cancelled by user";
    meta.completedAt = new Date().toISOString();
    writeJobMeta(JOBS_DIR, jobId, meta);
  }

  if (job) {
    try {
      await job.remove();
    } catch {
      // The job may already be locked by a worker; the cancel flag still applies.
    }
    if (meta) {
      void deliverServerCallback(job, { ...meta }, "job.cancelled", "Cancelled by user").catch(
        () => {},
      );
    }
  }

  return { status: "cancelled" };
});

// --- Job deletion ---
app.delete<{ Params: { id: string } }>("/api/v1/jobs/:id", async (request, reply) => {
  const jobId = request.params.id;
  if (!isValidJobId(jobId)) {
    return reply.status(400).send({ error: "Invalid job ID" });
  }
  const jobDir = jobDirFor(JOBS_DIR, jobId);

  if (!fs.existsSync(jobDir)) {
    return reply.status(404).send({ error: "Job not found" });
  }

  // Don't delete active jobs
  const job = await queue.getJob(jobId);
  if (job) {
    const state = await job.getState();
    if (state === "active" || state === "waiting") {
      return reply.status(409).send({ error: "Cannot delete an active job" });
    }
    await job.remove();
  }

  fs.rmSync(jobDir, { recursive: true, force: true });
  idempotency.removeJob(jobId);
  return { status: "deleted" };
});

// --- Auto-pruning helper ---
async function pruneOldJobs() {
  if (MAX_JOBS <= 0) return;

  const dirs = fs
    .readdirSync(JOBS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const metaPath = path.join(JOBS_DIR, d.name, "meta.json");
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        return { id: d.name, status: meta.status, createdAt: meta.createdAt ?? "" };
      } catch {
        return { id: d.name, status: "unknown", createdAt: "" };
      }
    })
    .filter(
      (j) =>
        j.status === "completed" ||
        j.status === "failed" ||
        j.status === "cancelled" ||
        j.status === "unknown",
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  while (dirs.length > MAX_JOBS) {
    const oldest = dirs.shift();
    if (oldest) {
      fs.rmSync(path.join(JOBS_DIR, oldest.id), { recursive: true, force: true });
      idempotency.removeJob(oldest.id);
    }
  }
}

export { JOBS_DIR, MAX_JOBS, pruneOldJobs };

// --- Serve frontend SPA ---
if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: "/",
    decorateReply: false,
    wildcard: false,
  });

  if (process.env["OPENREELS_PRINT_ROUTES"] === "true") {
    app.printRoutes({ commonPrefix: false });
  }

  // SPA fallback: serve index.html for all non-API routes
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html", WEB_DIST);
  });
}

// --- Start server ---
try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`OpenReels API server running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// --- Graceful shutdown ---
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  try {
    await app.close();
    await queueEvents.close();
    await queue.close();
    await redis.quit();
  } catch (err) {
    app.log.error(err);
  }
  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
