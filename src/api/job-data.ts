import type { ClipSpec } from "../clip/spec.js";
import type { LLMAuthType, SearchProviderKey } from "../schema/providers.js";
import type { CallbackEvent } from "./callbacks.js";

/** Provider selection carried in the BullMQ job payload. */
export interface JobProviders {
  llm: string;
  tts: string;
  image: string;
  stock: string;
  video?: string;
  videoModel?: string;
  music?: string;
  llmModel?: string;
  /** Ordered backup models tried when the primary LLM call fails. */
  llmFallbackModels?: string[];
  llmBaseUrl?: string;
  llmAuthType?: LLMAuthType;
  llmAuthHeader?: string;
  searchProvider?: SearchProviderKey;
}

/**
 * Webhook configuration. Lives only in the BullMQ job payload (Redis) and is
 * never copied into `meta.json`, so callback secrets cannot leak through the
 * public job API.
 */
export interface JobCallbackData {
  url: string;
  secret?: string;
  events?: CallbackEvent[];
}

/**
 * What a job produces.
 *
 * `video` is the researched short-form render. `clip` cuts vertical clips out
 * of an existing long video or stream, which shares the queue, the status API
 * and the artifact storage but none of the creative stages.
 */
export type JobKind = "video" | "clip";

/** BullMQ job payload created by the API server and consumed by the worker. */
export interface JobData {
  kind?: JobKind;
  /** Present only for `clip` jobs; already validated by the API. */
  clip?: ClipSpec;
  topic: string;
  archetype?: string;
  pacing?: string;
  platform: string;
  dryRun: boolean;
  noMusic?: boolean;
  noVideo?: boolean;
  noAiAssets?: boolean;
  /** Skip the quality review stage. It is advisory only and costs ~10% of the wall clock. */
  skipReview?: boolean;
  direction?: string;
  score?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  callbacks?: JobCallbackData;
  providers: JobProviders;
  keys: Record<string, string>;
  jobsDir: string;
}
