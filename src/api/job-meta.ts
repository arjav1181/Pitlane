import type { JobProviders } from "./job-data.js";

export interface JobStageMeta {
  status: string;
  detail?: string;
  durationSec?: number;
}

/**
 * Public job metadata persisted at `jobs/<id>/meta.json`.
 *
 * This file is served by the API, so it must never contain provider API keys
 * or webhook signing secrets. Provider selections are safe to store so a job
 * can be retried after its BullMQ payload has been pruned.
 */
export interface JobMeta {
  id: string;
  kind?: "video" | "clip";
  topic: string;
  /**
   * The clip request, stored so a retry does not need the (prunable) queue
   * payload. It holds a URL and options only, never a key.
   */
  clip?: import("../clip/spec.js").ClipSpec;
  archetype?: string;
  pacing?: string;
  platform?: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  cancelRequested?: boolean;
  noMusic?: boolean;
  noVideo?: boolean;
  noAiAssets?: boolean;
  skipReview?: boolean;
  retryOf?: string;
  metadata?: Record<string, unknown>;
  /** Provider configuration snapshot (never includes keys). */
  request?: {
    providers: JobProviders;
    platform?: string;
    pacing?: string;
    dryRun?: boolean;
    noMusic?: boolean;
    noVideo?: boolean;
    noAiAssets?: boolean;
  };
  /** Events already delivered to the job's webhook. */
  callbackEventsSent?: string[];
  stages: Record<string, JobStageMeta>;
  costEstimate?: unknown;
  actualCost?: unknown;
  videoPath?: string;
  /** Still frame of the finished short, for cards and anything that cannot play video. */
  posterPath?: string;
  /**
   * One paste-ready licence line for the description.
   *
   * It lives at the top level because that is where a client reads it: the
   * publisher appends this string to the description without knowing how the
   * credit record is shaped. The full record stays in `metadata.credits`.
   */
  creditsLine?: string;
  runDir?: string;
  /**
   * Clip jobs: the source video and the clips cut from it.
   *
   * `videoPath` still points at the first clip so every client that already
   * knows how to play a render keeps working; `clips` is the full set.
   */
  source?: {
    url: string;
    webpageUrl: string;
    title: string;
    uploader?: string;
    durationSeconds: number;
    wasLive: boolean;
    window: { start: number; end: number };
  };
  clips?: Array<{
    index: number;
    title: string;
    hook: string;
    start: number;
    end: number;
    sourceStart: number;
    sourceEnd: number;
    durationSeconds: number;
    score: number;
    reason: string;
    path: string;
    posterPath: string;
    previewPath: string;
    captionsPath: string;
    suggestedTitle: string;
    suggestedDescription: string;
  }>;
  clipRecords?: string;
  researchData?: { summary: string; key_facts: string[]; mood: string; sources?: string[] };
  score?: unknown;
  criticReview?: { score: number; strengths: string[]; weaknesses: string[] };
  musicTrack?: { trackId: string; mood: string; requestedMood: string; fallback: boolean };
  musicGeneration?: {
    provider: string;
    prompt?: string;
    metadata?: Record<string, unknown>;
    fallback: boolean;
  };
  revisionHistory?: { round: number; score: number }[];
  error?: string;
}
