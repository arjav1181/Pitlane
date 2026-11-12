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
  topic: string;
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
  runDir?: string;
  researchData?: { summary: string; key_facts: string[]; mood: string };
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
