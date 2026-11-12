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

/** BullMQ job payload created by the API server and consumed by the worker. */
export interface JobData {
  topic: string;
  archetype?: string;
  pacing?: string;
  platform: string;
  dryRun: boolean;
  noMusic?: boolean;
  noVideo?: boolean;
  noAiAssets?: boolean;
  direction?: string;
  score?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  callbacks?: JobCallbackData;
  providers: JobProviders;
  keys: Record<string, string>;
  jobsDir: string;
}
