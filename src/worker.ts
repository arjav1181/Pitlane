import * as fs from "node:fs";
import * as path from "node:path";
import { type Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { type CallbackEvent, type CallbackPayload, deliverCallback } from "./api/callbacks.js";
import { createIdempotencyStore } from "./api/idempotency.js";
import type { JobData } from "./api/job-data.js";
import type { JobMeta } from "./api/job-meta.js";
import { formatCreditLine } from "./pipeline/credits.js";
import type { Attribution } from "./schema/providers.js";
import {
  buildJobLinks,
  buildPlaceholderMeta,
  listJobMetas,
  readJobMeta,
  STAGE_NAMES,
  writeJobMeta,
} from "./api/jobs.js";
import type { PipelineCallbacks, StageName } from "./pipeline/orchestrator.js";
import { runPipeline } from "./pipeline/orchestrator.js";
import { createProviders, createVerificationModel } from "./providers/factory.js";
import { runClipPipeline } from "./clip/pipeline.js";
import { normalizeClipSpec } from "./clip/spec.js";
import { CLIP_STAGE_NAMES, type ClipStageName } from "./clip/stages.js";
import {
  findStaleLocalJobs,
  listQueueEntries,
  type OrphanedJob,
  planQueueSweep,
  removeFromQueue,
} from "./queue/orphan-recovery.js";
import { validateManifest } from "./providers/music/bundled.js";
import { DirectorScore } from "./schema/director-score.js";
import type {
  ImageProviderKey,
  LLMProviderKey,
  MusicProviderKey,
  StockProviderKey,
  TTSProviderKey,
  VideoProviderKey,
} from "./schema/providers.js";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const QUEUE_NAME = "openreels";
/**
 * How often to look for jobs a restart orphaned. BullMQ checks for stalled
 * jobs every 30 seconds, so this has to be more frequent to win the race.
 */
const ORPHAN_RECOVERY_INTERVAL_MS = 5_000;
const JOBS_DIR = process.env["JOBS_DIR"] ?? path.join(process.cwd(), "jobs");
const MAX_JOBS = process.env["MAX_JOBS"] ? Number(process.env["MAX_JOBS"]) : 0;
const ALLOW_PRIVATE_CALLBACKS =
  (process.env["OPENREELS_ALLOW_PRIVATE_CALLBACKS"] ?? "").toLowerCase() === "true";

fs.mkdirSync(JOBS_DIR, { recursive: true });

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const idempotency = createIdempotencyStore(JOBS_DIR);

// Validate music manifest at startup — warn but don't crash
try {
  const { valid, missing } = validateManifest();
  if (!valid) {
    console.warn(
      `[worker] Music manifest warning: ${missing.length} tracks missing: ${missing.join(", ")}`,
    );
  }
} catch {
  // Music manifest not available — music selection will gracefully degrade
}

function writeMeta(jobDir: string, meta: JobMeta) {
  writeJobMeta(JOBS_DIR, path.basename(jobDir), meta);
}

function callbackPayload(meta: JobMeta, event: CallbackEvent): CallbackPayload {
  return {
    event,
    jobId: meta.id,
    status: meta.status,
    topic: meta.topic,
    ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
    ...(meta.completedAt ? { completedAt: meta.completedAt } : {}),
    ...(meta.videoPath ? { videoPath: meta.videoPath } : {}),
    ...(meta.posterPath ? { posterPath: meta.posterPath } : {}),
    ...(meta.runDir ? { runDir: meta.runDir } : {}),
    ...(meta.error ? { error: meta.error } : {}),
    ...(meta.metadata ? { metadata: meta.metadata } : {}),
    ...(meta.actualCost ? { actualCost: meta.actualCost } : {}),
    ...(meta.costEstimate ? { costEstimate: meta.costEstimate } : {}),
    retryOf: meta.retryOf ?? null,
    links: buildJobLinks(meta),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Deliver a signed terminal webhook. Never throws: a callback failure must not
 * turn a successful render into a failed job.
 */
async function deliverJobCallback(
  job: Job<JobData>,
  meta: JobMeta,
  event: CallbackEvent,
): Promise<void> {
  const callbacks = job.data.callbacks;
  if (!callbacks) return;
  if (meta.callbackEventsSent?.includes(event)) return;

  const result = await deliverCallback(callbacks, callbackPayload(meta, event), {
    allowPrivate: ALLOW_PRIVATE_CALLBACKS,
  });

  if (result.delivered) {
    meta.callbackEventsSent = [...(meta.callbackEventsSent ?? []), event];
    writeMeta(path.join(JOBS_DIR, meta.id), meta);
    console.log(`[job:${meta.id}] delivered ${event} callback`);
  } else {
    console.warn(
      `[job:${meta.id}] ${event} callback failed after ${result.attempts} attempt(s): ${result.error}`,
    );
  }
}

/**
 * Fail jobs that a server restart orphaned.
 *
 * A render can take far longer than the BullMQ lock, so the lock is held for
 * ten minutes at a time. When the container is replaced mid-render the job
 * stays in the active set until that lock expires - and with a concurrency
 * of one it blocks every other job meanwhile. BullMQ would eventually re-run
 * it, burning the slot for another full pipeline; failing it instead frees
 * the slot immediately and leaves the caller free to retry.
 *
 * `force` is used on startup, where the worker that owned the active jobs
 * died with the previous container: every active job is orphaned, whatever
 * its lock still says.
 */
async function recoverOrphanedJobs(force = false): Promise<void> {
  const queue = new Queue<JobData>(QUEUE_NAME, { connection: redis });
  try {
    const metaOf = (id: string) => readJobMeta(JOBS_DIR, id);
    const isFinalised = (id: string) => {
      const meta = metaOf(id);
      return Boolean(meta && ["completed", "failed", "cancelled"].includes(meta.status));
    };
    // A request that never started has nothing but pending stages. Anything
    // else was already inside the pipeline when its worker disappeared.
    const hasStarted = (id: string) => {
      const meta = metaOf(id);
      if (!meta) return false;
      if (meta.status === "running") return true;
      if (meta.runDir) return true;
      return Object.values(meta.stages ?? {}).some(
        (stage) => stage && stage.status !== "pending",
      );
    };

    // At boot the queue's own completed/failed lists are the only record of
    // what happened to a job whose metadata was cut off mid-write.
    const entries = await listQueueEntries(queue, redis, hasStarted, isFinalised, force);
    const sweep = planQueueSweep(
      force
        ? entries.map((entry) =>
            entry.state === "active" ? { ...entry, locked: false } : entry,
          )
        : entries,
    );

    // A restart can also leave a job directory whose metadata still says
    // "running" after its queue entry was dropped. BullMQ has nothing to
    // sweep in that case, and the job would report running forever.
    const queuedIds = new Set(entries.map((entry) => entry.id));
    const localCandidates = findStaleLocalJobs(
      listJobMetas(JOBS_DIR).map(({ id, meta }) => ({ id, status: meta.status })),
      queuedIds,
    );
    const staleLocals: OrphanedJob[] = [];
    for (const candidate of localCandidates) {
      // The queue listing is paged; a real entry past the first page must not
      // be mistaken for a missing one.
      if (!(await queue.getJob(candidate.id))) staleLocals.push(candidate);
    }
    const toFail = [...sweep.fail, ...staleLocals];

    for (const id of sweep.remove) {
      // The job already finished. A queue entry left over from the restart
      // would re-run it and overwrite the render that was published.
      console.warn(`[worker] Dropping finished job ${id} from the queue`);
      await removeFromQueue(queue, redis, id);
    }

    for (const orphan of toFail) {
      console.warn(`[worker] Failing orphaned job ${orphan.id}: ${orphan.reason}`);
      const meta = metaOf(orphan.id);
      if (meta) {
        meta.status = "failed";
        meta.error = orphan.reason;
        meta.completedAt = new Date().toISOString();
        for (const stage of Object.keys(meta.stages)) {
          if (meta.stages[stage]?.status === "running") {
            meta.stages[stage] = { status: "error", detail: orphan.reason };
          }
        }
        writeMeta(path.join(JOBS_DIR, orphan.id), meta);
      }
      await removeFromQueue(queue, redis, orphan.id);
    }
  } catch (err) {
    console.warn("[worker] Orphan recovery failed:", err);
  } finally {
    await queue.close().catch(() => undefined);
  }
}

const worker = new Worker<JobData>(
  QUEUE_NAME,
  async (job: Job<JobData>) => {
    const {
      topic,
      archetype,
      pacing,
      platform,
      dryRun,
      noMusic,
      noVideo,
      noAiAssets: noAiAssetsRequested,
      skipReview: skipReviewRequested,
      direction,
      score,
      metadata,
      providers,
      keys,
    } = job.data;
    const skipReview = skipReviewRequested === true;
    const noAiAssets =
      noAiAssetsRequested === true ||
      (process.env["OPENREELS_NO_AI_ASSETS"] ?? "").toLowerCase() === "true";
    const jobDir = path.join(JOBS_DIR, job.id!);
    fs.mkdirSync(jobDir, { recursive: true });

    // Preserve the placeholder meta.json written by the API server: createdAt,
    // caller metadata, provider snapshot, retry lineage, and any early state.
    const existingMeta = readJobMeta(JOBS_DIR, job.id!);
    const meta: JobMeta = {
      ...(existingMeta ?? {}),
      id: job.id!,
      topic,
      status: "running",
      createdAt: existingMeta?.createdAt ?? new Date().toISOString(),
      stages: existingMeta?.stages ?? {},
    };
    if (job.data.kind === "clip") meta.kind = "clip";
    if (archetype) meta.archetype = archetype;
    if (pacing) meta.pacing = pacing;
    if (platform) meta.platform = platform;
    if (noMusic) meta.noMusic = true;
    if (noVideo) meta.noVideo = true;
    if (noAiAssets) meta.noAiAssets = true;
    if (skipReview) meta.skipReview = true;
    if (metadata) meta.metadata = metadata;

    // Initialize all stages as pending. A clip job has its own stage list:
    // there is no research, no director, and no review to wait for.
    for (const name of job.data.kind === "clip" ? CLIP_STAGE_NAMES : STAGE_NAMES) {
      if (!meta.stages[name]) meta.stages[name] = { status: "pending" };
    }
    writeMeta(jobDir, meta);

    // Create providers with per-job keys. In no-AI mode the image provider is a
    // disabled stub and no video providers are constructed, so no AI asset key
    // is required and accidental calls fail loudly.
    const providerInstances = createProviders({
      llm: providers.llm as LLMProviderKey,
      tts: providers.tts as TTSProviderKey,
      image: providers.image as ImageProviderKey,
      stock: providers.stock as StockProviderKey,
      video: providers.video as VideoProviderKey | undefined,
      videoModel: providers.videoModel,
      music: (providers.music as MusicProviderKey) ?? "bundled",
      keys,
      llmModel: providers.llmModel,
      llmFallbackModels: providers.llmFallbackModels,
      llmBaseUrl: providers.llmBaseUrl,
      llmAuthType: providers.llmAuthType,
      llmAuthHeader: providers.llmAuthHeader,
      searchProvider: providers.searchProvider,
      noAiAssets: noAiAssets === true,
    });

    // ── Clip jobs ─────────────────────────────────────────────────────────
    // Cutting clips out of somebody else's video shares the queue, the job
    // record, the artifact store and the cancel flag with a render, and shares
    // none of the creative stages. It branches here so a clip never pays for
    // research or a director call it does not use.
    if (job.data.kind === "clip") {
      if (!job.data.clip) throw new Error("Clip job is missing its spec");
      const spec = normalizeClipSpec(job.data.clip);

      const isCancelled = () => {
        try {
          const current = JSON.parse(fs.readFileSync(path.join(jobDir, "meta.json"), "utf-8"));
          if (current.cancelRequested === true) {
            meta.cancelRequested = true;
            return true;
          }
        } catch {
          // An unreadable meta is not a cancellation.
        }
        return false;
      };

      const result = await runClipPipeline({
        spec,
        jobDir,
        llm: providerInstances.llm,
        callbacks: {
          onStageStart(stage: ClipStageName) {
            meta.stages[stage] = { status: "running" };
            writeMeta(jobDir, meta);
            job.updateProgress({ stage, type: "start" });
          },
          onStageComplete(stage: ClipStageName, detail: string, durationSec: number) {
            meta.stages[stage] = { status: "done", detail, durationSec };
            writeMeta(jobDir, meta);
            job.updateProgress({ stage, type: "complete", detail, durationSec });
          },
          onStageError(stage: ClipStageName, error: string) {
            meta.stages[stage] = { status: "error", detail: error };
            writeMeta(jobDir, meta);
          },
          onProgress(stage: ClipStageName, data: Record<string, unknown>) {
            job.updateProgress({ stage, ...data });
          },
          onLog(message: string) {
            console.log(`[clip:${job.id}] ${message}`);
          },
          isCancelled,
        },
      });

      meta.kind = "clip";
      meta.source = result.source;
      meta.clips = result.clips;
      meta.clipRecords = path.join("clips", "clips.json");
      // `videoPath` stays the first clip so clients that only know how to play
      // one render keep working; `clips` is the full set.
      meta.videoPath = result.clips[0]!.path;
      meta.posterPath = result.clips[0]!.posterPath;
      meta.status = "completed";
      meta.completedAt = new Date().toISOString();
      if (result.warnings.length > 0) {
        meta.metadata = { ...(meta.metadata ?? {}), warnings: result.warnings };
      }
      writeMeta(jobDir, meta);

      try {
        await deliverJobCallback(job, meta, "job.completed");
      } catch (err) {
        console.warn(`[job:${meta.id}] callback delivery error:`, err);
      }

      if (MAX_JOBS > 0) pruneOldJobs(JOBS_DIR, MAX_JOBS);

      return { kind: "clip", clips: result.clips.length };
    }

    // Build callbacks that emit BullMQ progress events and update meta.json
    const callbacks: PipelineCallbacks = {
      onRunDir(runDir: string) {
        meta.runDir = path.relative(jobDir, runDir);
        writeMeta(jobDir, meta);
      },

      onStageStart(stage: StageName) {
        meta.stages[stage] = { status: "running" };
        writeMeta(jobDir, meta);
        job.updateProgress({ stage, type: "start" });
      },

      onStageComplete(stage: StageName, detail: string, durationSec: number) {
        meta.stages[stage] = { status: "done", detail, durationSec };
        writeMeta(jobDir, meta);
        job.updateProgress({ stage, type: "complete", detail, durationSec });
      },

      onStageSkip(stage: StageName, reason: string) {
        meta.stages[stage] = { status: "skipped", detail: reason };
        writeMeta(jobDir, meta);
        job.updateProgress({ stage, type: "skipped", reason });
      },

      onStageError(stage: StageName, error: string) {
        meta.stages[stage] = { status: "error", detail: error };
        writeMeta(jobDir, meta);
        job.updateProgress({ stage, type: "error", error });
      },

      onProgress(stage: StageName, data: Record<string, unknown>) {
        // Store rich data in meta for SSE reconnection support
        if (data.type === "results") {
          meta.researchData = {
            summary: data.summary as string,
            key_facts: data.key_facts as string[],
            mood: data.mood as string,
            sources: (data.sources as string[]) ?? [],
          };
          writeMeta(jobDir, meta);
        } else if (data.type === "score") {
          meta.score = data.score;
          writeMeta(jobDir, meta);
        } else if (data.type === "music") {
          meta.musicTrack = {
            trackId: data.track as string,
            mood: data.mood as string,
            requestedMood: data.requestedMood as string,
            fallback: data.fallback as boolean,
          };
          writeMeta(jobDir, meta);
        } else if (data.type === "music_resolved") {
          meta.musicGeneration = {
            provider: data.provider as string,
            prompt: data.prompt as string | undefined,
            metadata: data.metadata as Record<string, unknown> | undefined,
            fallback: data.fallback as boolean,
          };
          writeMeta(jobDir, meta);
        } else if (data.type === "credits") {
          const credits = data.credits as Attribution[];
          meta.metadata = {
            ...(meta.metadata ?? {}),
            credits,
            // The description needs a licence line it can paste, not a data
            // structure it has to format. Building it here keeps every job
            // credited the same way and keeps the formatting testable.
            creditsLine: formatCreditLine(credits),
          };
          meta.creditsLine = formatCreditLine(credits);
          writeMeta(jobDir, meta);
        } else if (data.type === "revision") {
          if (!meta.revisionHistory) meta.revisionHistory = [];
          meta.revisionHistory.push({
            round: data.round as number,
            score: data.critiqueScore as number,
          });
          writeMeta(jobDir, meta);
        } else if (data.type === "review") {
          meta.criticReview = {
            score: data.score as number,
            strengths: data.strengths as string[],
            weaknesses: data.weaknesses as string[],
          };
          writeMeta(jobDir, meta);
        }
        job.updateProgress({ stage, ...data });
      },

      async onCostEstimate(estimate) {
        meta.costEstimate = estimate;
        writeMeta(jobDir, meta);
        job.updateProgress({ stage: "director", type: "cost_estimate", estimate });
        // Auto-confirm in worker mode (no interactive prompt)
        return true;
      },

      onActualCost(cost) {
        meta.actualCost = cost;
        writeMeta(jobDir, meta);
      },

      onLog(message: string) {
        // Worker logs go to stdout (captured by Docker logs)
        console.log(`[job:${job.id}] ${message}`);
      },

      isCancelled() {
        // Check meta.json for cancel flag and sync back to in-memory meta
        try {
          const currentMeta = JSON.parse(fs.readFileSync(path.join(jobDir, "meta.json"), "utf-8"));
          if (currentMeta.cancelRequested === true) {
            meta.cancelRequested = true;
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
    };

    // Create verification model with per-job API keys
    const LLM_KEY_MAP: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      gemini: "GOOGLE_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      "openai-compatible": "OPENREELS_LLM_API_KEY",
    };
    const llmKeyName = LLM_KEY_MAP[providers.llm] ?? "ANTHROPIC_API_KEY";
    const llmKey = keys[llmKeyName];
    const verifyModel = createVerificationModel(
      providers.llm as LLMProviderKey,
      providers.llmModel,
      llmKey,
      {
        baseUrl: providers.llmBaseUrl,
        authType: providers.llmAuthType,
        authHeader: providers.llmAuthHeader,
      },
    );

    // Parse replay score if provided
    const replayScore = score ? DirectorScore.parse(score) : undefined;

    // Direction is ignored when replaying (score already incorporates creative intent)
    const effectiveDirection = replayScore ? undefined : direction;

    // Run the pipeline
    const result = await runPipeline(
      {
        topic,
        llm: providerInstances.llm,
        tts: providerInstances.tts,
        ttsProvider: providers.tts as TTSProviderKey,
        imageGen: providerInstances.imageGen,
        imageProvider: providers.image as ImageProviderKey,
        stock: providerInstances.stock,
        videoProviders: noAiAssets || noVideo ? [] : providerInstances.videoProviders,
        videoProvider: providers.video as VideoProviderKey | undefined,
        noVideo: noVideo === true,
        noAiAssets: noAiAssets === true,
        skipReview,
        archetype,
        pacing,
        platform,
        dryRun,
        noMusic,
        musicProvider: providerInstances.music,
        musicProviderKey: (providers.music as MusicProviderKey) ?? "bundled",
        preview: false,
        outputDir: jobDir,
        yes: true,
        verifyModel,
        direction: effectiveDirection,
        replayScore,
      },
      callbacks,
    );

    // Update final meta
    meta.status = meta.cancelRequested ? "cancelled" : "completed";
    meta.completedAt = new Date().toISOString();
    if (result.videoPath) {
      meta.videoPath = path.relative(jobDir, result.videoPath);
      if (result.thumbnailPath) {
        meta.posterPath = path.relative(jobDir, result.thumbnailPath);
      }
      // Store runDir explicitly for frontend artifact fetching
      meta.runDir = path.relative(jobDir, result.outputDir);
    }
    writeMeta(jobDir, meta);

    try {
      await deliverJobCallback(
        job,
        meta,
        meta.status === "cancelled" ? "job.cancelled" : "job.completed",
      );
    } catch (err) {
      console.warn(`[job:${meta.id}] callback delivery error:`, err);
    }

    // Auto-prune old jobs if MAX_JOBS is set
    if (MAX_JOBS > 0) {
      pruneOldJobs(JOBS_DIR, MAX_JOBS);
    }

    return { videoPath: result.videoPath, outputDir: result.outputDir };
  },
  {
    connection: redis,
    concurrency: 1,
    lockDuration: 600_000, // 10 minutes — Remotion renders can be slow
  },
);

function pruneOldJobs(jobsDir: string, maxJobs: number) {
  const dirs = fs
    .readdirSync(jobsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const metaPath = path.join(jobsDir, d.name, "meta.json");
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

  while (dirs.length > maxJobs) {
    const oldest = dirs.shift();
    if (oldest) {
      fs.rmSync(path.join(jobsDir, oldest.id), { recursive: true, force: true });
      idempotency.removeJob(oldest.id);
      console.log(`[pruner] Removed old job: ${oldest.id}`);
    }
  }
}

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

/**
 * Keep the worker slot free from jobs a restart orphaned.
 *
 * BullMQ moves a stalled job back to the wait list and re-runs it, which
 * burns the single slot for another full pipeline. The check here runs more
 * often than BullMQ's own stalled detection, so the job is failed and
 * removed before BullMQ gets to it.
 */
const orphanRecoveryTimer = setInterval(() => {
  void recoverOrphanedJobs().catch((err) => {
    console.warn("[worker] Orphan recovery failed:", err);
  });
}, ORPHAN_RECOVERY_INTERVAL_MS);
orphanRecoveryTimer.unref();

void recoverOrphanedJobs(true).catch((err) => {
  console.warn("[worker] Orphan recovery failed:", err);
});

worker.on("failed", async (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);

  if (!job?.id) return;
  const jobDir = path.join(JOBS_DIR, job.id);
  let meta: JobMeta;
  try {
    meta = readJobMeta(JOBS_DIR, job.id) ?? buildPlaceholderMeta(job.id, job.data);
    meta.status = meta.cancelRequested ? "cancelled" : "failed";
    meta.error = err.message;
    meta.completedAt = new Date().toISOString();
    // Mark whatever stage was "running" as "error" so the UI can identify it
    for (const stage of Object.keys(meta.stages)) {
      if (meta.stages[stage]?.status === "running") {
        meta.stages[stage] = { status: "error", detail: err.message };
      }
    }
    writeMeta(jobDir, meta);
  } catch {
    return;
  }

  try {
    await deliverJobCallback(
      job,
      meta,
      meta.status === "cancelled" ? "job.cancelled" : "job.failed",
    );
  } catch (callbackErr) {
    console.warn(`[job:${job.id}] callback delivery error:`, callbackErr);
  }
});

console.log("OpenReels worker started, waiting for jobs...");
