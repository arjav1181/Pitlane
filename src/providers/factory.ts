import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type {
  ImageProvider,
  ImageProviderKey,
  LLMAuthType,
  LLMProvider,
  LLMProviderKey,
  MusicProvider,
  MusicProviderKey,
  SearchProviderKey,
  StockProvider,
  StockProviderKey,
  TTSProvider,
  TTSProviderKey,
  VideoProvider,
  VideoProviderKey,
} from "../schema/providers.js";
import { DisabledImageProvider } from "./image/disabled.js";
import { GeminiImage } from "./image/gemini.js";
import { OpenAIImage } from "./image/openai.js";
import { AnthropicLLM } from "./llm/anthropic.js";
import { FallbackLLM } from "./llm/fallback.js";
import { GeminiLLM } from "./llm/gemini.js";
import { OpenAILLM } from "./llm/openai.js";
import { createOpenAICompatibleProvider, OpenAICompatibleLLM } from "./llm/openai-compatible.js";
import { OpenRouterLLM } from "./llm/openrouter.js";
import { BundledMusic } from "./music/bundled-adapter.js";
import { LyriaMusic } from "./music/lyria.js";
import { createTavilySearchTools } from "./search/tavily.js";
import { createWikipediaSearchTools } from "./search/wikipedia.js";
import { PexelsStock } from "./stock/pexels.js";
import { PixabayStock } from "./stock/pixabay.js";
import { WikimediaStock } from "./stock/wikimedia.js";
import { AlignedTTSProvider } from "./tts/aligned-tts-provider.js";
import { ElevenLabsTTS } from "./tts/elevenlabs.js";
import { GeminiTTS } from "./tts/gemini.js";
import { InworldTTS } from "./tts/inworld.js";
import { KokoroTTS } from "./tts/kokoro.js";
import { PiperTTS } from "./tts/piper.js";
import { BroadcastTTSProvider } from "./tts/broadcast-tts-provider.js";
import { FallbackTTSProvider } from "./tts/fallback-tts-provider.js";
import { OpenAITTS } from "./tts/openai.js";
import { WhisperAligner } from "./tts/whisper-aligner.js";
import { FalVideo } from "./video/fal.js";
import { GeminiVideo } from "./video/gemini.js";

export interface ProviderConfig {
  llm: LLMProviderKey;
  tts: TTSProviderKey;
  image: ImageProviderKey;
  stock?: StockProviderKey;
  video?: VideoProviderKey;
  music?: MusicProviderKey;
  videoModel?: string;
  kokoroVoice?: string;
  keys?: Record<string, string>;
  llmModel?: string;
  /** Ordered backup model IDs tried when the primary model fails. */
  llmFallbackModels?: string[];
  llmBaseUrl?: string;
  llmAuthType?: LLMAuthType;
  llmAuthHeader?: string;
  searchProvider?: SearchProviderKey;
  /** Disable AI image/video providers entirely (stock + procedural assets only). */
  noAiAssets?: boolean;
}

export interface Providers {
  llm: LLMProvider;
  tts: TTSProvider;
  imageGen: ImageProvider;
  stock: StockProvider[];
  videoProviders: VideoProvider[];
  music: MusicProvider;
}

/** Providers that have native web search tools built in. */
const NATIVE_SEARCH_PROVIDERS = new Set<LLMProviderKey>(["anthropic", "openai", "gemini"]);

/**
 * Resolve which search tools to inject based on provider type and config.
 * Returns undefined when native tools should be used (no injection needed).
 */
function resolveSearchTools(
  llmProvider: LLMProviderKey,
  searchProvider: SearchProviderKey | undefined,
  keys: Record<string, string>,
): Record<string, unknown> | undefined {
  // Explicit search provider override
  if (searchProvider === "tavily") {
    return createTavilySearchTools(keys["TAVILY_API_KEY"]);
  }
  if (searchProvider === "wikipedia") {
    return createWikipediaSearchTools();
  }
  if (searchProvider === "none") {
    return {};
  }
  if (searchProvider === "native") {
    if (!NATIVE_SEARCH_PROVIDERS.has(llmProvider)) {
      throw new Error(
        `Provider "${llmProvider}" does not support native search. Use --search-provider tavily or --search-provider none.`,
      );
    }
    return undefined; // Let the subclass use its native tools
  }

  // Auto-detect: native providers use their own tools, others try Tavily
  if (NATIVE_SEARCH_PROVIDERS.has(llmProvider)) {
    return undefined;
  }
  const tavilyKey = keys["TAVILY_API_KEY"] ?? process.env["TAVILY_API_KEY"];
  if (tavilyKey) {
    return createTavilySearchTools(tavilyKey);
  }

  // No Tavily key: Wikipedia still gives the research stage real, citable
  // facts instead of the model's memory.
  return createWikipediaSearchTools();
  console.warn(
    "\nWarning: No search provider configured. TAVILY_API_KEY not set.\n" +
      "Research agent will use parametric knowledge only (no web search).\n" +
      "Get a key: https://tavily.com/ or use --search-provider none to suppress this warning.\n",
  );
  return {};
}

/** Read the OpenAI-compatible auth mode from config or env, ignoring invalid values. */
function resolveAuthType(configured?: LLMAuthType): LLMAuthType {
  const candidate = configured ?? process.env["OPENREELS_LLM_AUTH"];
  return candidate === "none" || candidate === "bearer" || candidate === "custom-header"
    ? candidate
    : "auto";
}

/** Build one LLM instance for a provider/model pair. */
function buildLLM(
  provider: LLMProviderKey,
  model: string | undefined,
  config: ProviderConfig,
  keys: Record<string, string>,
  searchTools: Record<string, unknown> | undefined,
  retryBudgetMs?: number,
): LLMProvider {
  const llm = buildProvider(provider, model, config, keys, searchTools);
  if (retryBudgetMs !== undefined) {
    const budgetAware = llm as { setRetryBudgetMs?: (ms: number | undefined) => void };
    budgetAware.setRetryBudgetMs?.(retryBudgetMs);
  }
  return llm;
}

function buildProvider(
  provider: LLMProviderKey,
  model: string | undefined,
  config: ProviderConfig,
  keys: Record<string, string>,
  searchTools: Record<string, unknown> | undefined,
): LLMProvider {
  switch (provider) {
    case "openai":
      return new OpenAILLM(model, keys["OPENAI_API_KEY"], searchTools);
    case "gemini":
      return new GeminiLLM(model, keys["GOOGLE_API_KEY"], searchTools);
    case "openrouter":
      return new OpenRouterLLM(model, keys["OPENROUTER_API_KEY"], searchTools);
    case "openai-compatible": {
      const baseUrl = config.llmBaseUrl ?? process.env["OPENREELS_LLM_BASE_URL"];
      if (!baseUrl) throw new Error("llmBaseUrl is required for openai-compatible provider");
      if (!model) throw new Error("llmModel is required for openai-compatible provider");
      const apiKey = keys["OPENREELS_LLM_API_KEY"] ?? process.env["OPENREELS_LLM_API_KEY"];
      return new OpenAICompatibleLLM(baseUrl, model, apiKey, searchTools, {
        type: resolveAuthType(config.llmAuthType),
        headerName: config.llmAuthHeader ?? process.env["OPENREELS_LLM_AUTH_HEADER"],
      });
    }
    case "anthropic":
    default:
      return new AnthropicLLM(model, keys["ANTHROPIC_API_KEY"], searchTools);
  }
}

/** Ordered backup model IDs from the request, falling back to the env list. */
function resolveFallbackModels(config: ProviderConfig): string[] {
  const raw =
    config.llmFallbackModels ??
    process.env["OPENREELS_LLM_FALLBACK_MODELS"]?.split(",") ??
    [];
  return raw.map((model) => model.trim()).filter(Boolean);
}

/** Total wall-clock budget for all fallback attempts (default 5 minutes). */
function resolveFallbackBudgetMs(): number {
  const raw = Number(process.env["OPENREELS_LLM_FALLBACK_BUDGET_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
}

/**
 * How long a single model may spend retrying a rate limit before the chain
 * moves on (default 45 seconds).
 *
 * Without this, a rate-limited model can spend six attempts - each of them
 * up to the request timeout - inside the chain's budget, so the backup model
 * is never reached.
 */
function resolveFallbackRetryBudgetMs(): number {
  const raw = Number(process.env["OPENREELS_LLM_FALLBACK_RETRY_BUDGET_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 45_000;
}

export function createProviders(config: ProviderConfig): Providers {
  const k = config.keys ?? {};
  const searchTools = resolveSearchTools(config.llm, config.searchProvider, k);

  const primaryModel =
    config.llmModel ??
    (config.llm === "openai-compatible" ? process.env["OPENREELS_LLM_MODEL"] : undefined);

  const seenModels = new Set<string>([primaryModel ?? ""]);
  const fallbackModels = resolveFallbackModels(config).filter((model) => {
    if (seenModels.has(model)) return false;
    seenModels.add(model);
    return true;
  });

  // Inside a chain every model gets a bounded retry window, so a rate-limited
  // model is abandoned quickly enough for the next one to be tried.
  const retryBudgetMs =
    fallbackModels.length > 0 ? resolveFallbackRetryBudgetMs() : undefined;

  const primaryLLM = buildLLM(config.llm, primaryModel, config, k, searchTools, retryBudgetMs);

  let llm: LLMProvider = primaryLLM;
  if (fallbackModels.length > 0) {
    const entries = [
      { provider: primaryLLM, label: `${config.llm}:${primaryModel ?? "default"}` },
      ...fallbackModels.map((model) => ({
        provider: buildLLM(config.llm, model, config, k, searchTools, retryBudgetMs),
        label: `${config.llm}:${model}`,
      })),
    ];
    llm = new FallbackLLM(entries, {
      budgetMs: resolveFallbackBudgetMs(),
    });
    console.log(`[providers] LLM fallback chain: ${entries.map((e) => e.label).join(" -> ")}`);
  }

  // Providers that lack native timestamps get wrapped with the alignment decorator.
  // The aligner is shared (lazy singleton) so the Whisper model loads only once.
  const aligner = new WhisperAligner();

  // Every engine gets the same script preparation and the same mastering, so
  // the channel sounds like one channel regardless of which voice made it.
  const broadcast = (provider: TTSProvider) => new BroadcastTTSProvider(provider);

  // The two local voices back each other up. If one cannot speak, the other
  // does, and the render is not lost to a missing binary or voice file.
  const kokoro = new KokoroTTS(config.kokoroVoice);
  const piper = new PiperTTS();
  const localVoices = (preferred: "kokoro" | "piper") =>
    broadcast(
      new FallbackTTSProvider(
        preferred === "kokoro" ? [kokoro, piper] : [piper, kokoro],
        preferred === "kokoro" ? ["kokoro", "piper"] : ["piper", "kokoro"],
      ),
    );

  let tts: TTSProvider;
  switch (config.tts) {
    case "kokoro":
      tts = new AlignedTTSProvider(localVoices("kokoro"), aligner);
      break;
    case "piper":
      tts = new AlignedTTSProvider(localVoices("piper"), aligner);
      break;
    case "gemini-tts":
      tts = new AlignedTTSProvider(broadcast(new GeminiTTS(undefined, k["GOOGLE_API_KEY"])), aligner);
      break;
    case "openai-tts":
      tts = new AlignedTTSProvider(broadcast(new OpenAITTS(undefined, k["OPENAI_API_KEY"])), aligner);
      break;
    case "inworld":
      // Inworld returns word timestamps of its own; mastering is gain-only, so
      // they stay valid without a second alignment pass.
      tts = broadcast(new InworldTTS(undefined, undefined, k["INWORLD_TTS_API_KEY"]));
      break;
    default:
      tts = broadcast(new ElevenLabsTTS(undefined, k["ELEVENLABS_API_KEY"]));
      break;
  }

  const imageGen: ImageProvider = config.noAiAssets
    ? new DisabledImageProvider()
    : config.image === "openai"
      ? new OpenAIImage(undefined, k["OPENAI_API_KEY"])
      : new GeminiImage(undefined, k["GOOGLE_API_KEY"]);

  // Build stock provider array. Wikimedia Commons needs no key and is always
  // available, so it is part of the default set.
  const stock: StockProvider[] = [];
  const pexelsKey = k["PEXELS_API_KEY"] ?? process.env["PEXELS_API_KEY"];
  const pixabayKey = k["PIXABAY_API_KEY"] ?? process.env["PIXABAY_API_KEY"];

  // The primary library goes first, the rest follow, and Commons is always
  // available as the keyless last word.
  const primary = config.stock ?? "all";

  if (primary === "wikimedia") {
    stock.push(new WikimediaStock());
  } else if (primary === "pexels") {
    if (pexelsKey) stock.push(new PexelsStock(pexelsKey));
    stock.push(new WikimediaStock());
  } else if (primary === "pixabay") {
    if (pixabayKey) stock.push(new PixabayStock(pixabayKey));
    stock.push(new WikimediaStock());
  } else {
    if (pexelsKey) stock.push(new PexelsStock(pexelsKey));
    if (pixabayKey) stock.push(new PixabayStock(pixabayKey));
    stock.push(new WikimediaStock());
  }

  // Build video provider array: construct available providers, primary first.
  // No-AI-assets mode never constructs or calls a video provider.
  const videoProviders: VideoProvider[] = [];
  const googleKey = k["GOOGLE_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  const falKey = k["FAL_API_KEY"] ?? process.env["FAL_API_KEY"];
  const videoPrimary = config.video ?? (googleKey ? "gemini" : falKey ? "fal" : undefined);

  if (!config.noAiAssets) {
    if (videoPrimary === "fal") {
      if (falKey) videoProviders.push(new FalVideo(undefined, falKey));
      if (googleKey) videoProviders.push(new GeminiVideo(config.videoModel, googleKey));
    } else if (videoPrimary === "gemini" || videoPrimary === undefined) {
      if (googleKey) videoProviders.push(new GeminiVideo(config.videoModel, googleKey));
      if (falKey) videoProviders.push(new FalVideo(undefined, falKey));
    }
  }

  // Music provider: lyria requires GOOGLE_API_KEY, bundled is always available
  const music: MusicProvider =
    config.music === "lyria" ? new LyriaMusic(googleKey) : new BundledMusic();

  return { llm, tts, imageGen, stock, videoProviders, music };
}

/** Create an AI SDK LanguageModel instance for VLM verification */
export function createVerificationModel(
  provider: LLMProviderKey,
  model?: string,
  apiKey?: string,
  openAICompatible?: {
    baseUrl?: string;
    authType?: LLMAuthType;
    authHeader?: string;
  },
): LanguageModel {
  switch (provider) {
    case "openai": {
      const openai = apiKey ? createOpenAI({ apiKey }) : createOpenAI();
      return openai(model ?? "gpt-4o");
    }
    case "gemini": {
      // @ai-sdk/google looks for GOOGLE_GENERATIVE_AI_API_KEY by default,
      // but OpenReels standardizes on GOOGLE_API_KEY across all providers.
      const key = apiKey ?? process.env["GOOGLE_API_KEY"];
      const google = key ? createGoogleGenerativeAI({ apiKey: key }) : createGoogleGenerativeAI();
      return google(model ?? "gemini-2.5-flash");
    }
    case "openrouter": {
      const openrouter = apiKey ? createOpenRouter({ apiKey }) : createOpenRouter();
      return openrouter(model ?? "anthropic/claude-sonnet-4");
    }
    case "openai-compatible": {
      const baseUrl = openAICompatible?.baseUrl ?? process.env["OPENREELS_LLM_BASE_URL"];
      if (!baseUrl) {
        // No endpoint configured: fall back to Anthropic for stock verification (needs VLM).
        const antKey = process.env["ANTHROPIC_API_KEY"];
        if (!antKey) {
          throw new Error(
            "Stock verification requires a VLM. Set OPENREELS_LLM_BASE_URL or ANTHROPIC_API_KEY, or use --no-stock-verify.",
          );
        }
        console.warn(
          `[openai-compatible] Using Anthropic for stock verification (VLM). Set OPENREELS_LLM_BASE_URL to use your own endpoint.`,
        );
        const anthropic = createAnthropic({ apiKey: antKey });
        return anthropic(model ?? "claude-sonnet-4-6");
      }
      const compat = createOpenAICompatibleProvider(
        baseUrl,
        apiKey ?? process.env["OPENREELS_LLM_API_KEY"],
        {
          type: resolveAuthType(openAICompatible?.authType),
          headerName: openAICompatible?.authHeader ?? process.env["OPENREELS_LLM_AUTH_HEADER"],
        },
      );
      return compat(model ?? process.env["OPENREELS_LLM_MODEL"] ?? "gpt-4o");
    }
    default: {
      const anthropic = apiKey ? createAnthropic({ apiKey }) : createAnthropic();
      return anthropic(model ?? "claude-sonnet-4-6");
    }
  }
}
