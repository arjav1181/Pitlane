import {
  ArrowRight,
  Eye,
  EyeOff,
  Gauge,
  Lock,
  MonitorPlay,
  Shuffle,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArchetypeCard } from "@/components/ArchetypeCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type Archetype,
  api,
  type JobSummary,
  type LLMAuthType,
  type Platform,
  type ProviderOptions,
} from "@/hooks/useApi";
import {
  AUTH_LABELS,
  AUTH_OPTIONS,
  clearCredentials,
  loadCredentialDefaults,
  loadRememberPreference,
  saveCredentials,
  saveRememberPreference,
} from "@/lib/credentials";
import { getSceneAssetUrl } from "@/lib/scene-assets";
import { cn } from "@/lib/utils";

/** Topics the channel actually runs, grouped the way a motoring channel thinks. */
const TOPIC_CATEGORIES: Record<string, string[]> = {
  Engineering: [
    "Why independent rear suspension changed Fords",
    "How a 1964 275 GTB won Le Mans",
    "What made a V12 reliable in the wet",
    "The geometry that stopped a nose dive",
  ],
  Racing: [
    "How the 1964 275 GTB won Le Mans",
    "Why the 1969 season changed everything",
    "The race a privateer won alone",
    "How a slipstream decided a finish",
  ],
  Brands: [
    "The tractor tycoon who built Lamborghini",
    "How Bertha Benz drove the first long distance",
    "The brothers who argued about rear engines",
    "How Dodge got a V8 into a car nobody wanted",
  ],
  History: [
    "How Bertha Benz saved the first automobile",
    "The first factory tailpipe patent",
    "Why coachbuilders moved to Italy",
    "The year the hot rod left the driveway",
  ],
};

const CATEGORY_KEYS = Object.keys(TOPIC_CATEGORIES);

const DISPLAY_NAMES: Record<string, string> = {
  // Platforms
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  // LLM
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  "openai-compatible": "Custom (OpenAI-compatible)",
  // TTS
  elevenlabs: "ElevenLabs",
  inworld: "Inworld",
  kokoro: "Kokoro (Local)",
  "gemini-tts": "Gemini TTS",
  "openai-tts": "OpenAI TTS",
  // Image
  // gemini/openai already covered above
  // Music
  bundled: "Bundled (Free)",
  lyria: "Lyria 3 Pro",
  // Video
  fal: "fal.ai (Kling)",
};

function displayName(key: string): string {
  return DISPLAY_NAMES[key] ?? key;
}

export function HomePage() {
  const navigate = useNavigate();
  // Credentials remembered in this browser (loaded once, then kept in sync below).
  const [defaults] = useState(loadCredentialDefaults);
  const [topic, setTopic] = useState("");
  const [archetype, setArchetype] = useState("");
  const [platform, setPlatform] = useState("youtube");
  const [llmProvider, setLlmProvider] = useState(defaults.llmProvider);
  const [llmModel, setLlmModel] = useState(defaults.llmModel);
  const [llmBaseUrl, setLlmBaseUrl] = useState(defaults.llmBaseUrl);
  const [llmApiKey, setLlmApiKey] = useState(defaults.llmApiKey);
  const [llmAuthType, setLlmAuthType] = useState<LLMAuthType>(defaults.llmAuthType);
  const [llmAuthHeader, setLlmAuthHeader] = useState(defaults.llmAuthHeader);
  const [searchProvider, setSearchProvider] = useState(defaults.searchProvider);
  const [ttsProvider, setTtsProvider] = useState(defaults.ttsProvider);
  const [imageProvider, setImageProvider] = useState(defaults.imageProvider);
  const [musicProvider, setMusicProvider] = useState(defaults.musicProvider);
  const [pacing, setPacing] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [noAiAssets, setNoAiAssets] = useState(false);
  const [directionText, setDirectionText] = useState("");
  const [scoreJson, setScoreJson] = useState<Record<string, unknown> | null>(null);
  const [scoreFileName, setScoreFileName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rememberCredentials, setRememberCredentials] = useState(loadRememberPreference);
  const [showApiKey, setShowApiKey] = useState(false);

  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [providers, setProviders] = useState<ProviderOptions | null>(null);
  const [latest, setLatest] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Topic inspiration
  const [activeCategory, setActiveCategory] = useState(CATEGORY_KEYS[0]!);
  const [shuffledTopics, setShuffledTopics] = useState<string[]>([]);

  useEffect(() => {
    api
      .listArchetypes()
      .then(setArchetypes)
      .catch(() => {});
    api
      .listPlatforms()
      .then(setPlatforms)
      .catch(() => {});
    api
      .listProviders()
      .then(setProviders)
      .catch(() => {});
    // The last finished short is the product's own output — it belongs on
    // this page, not a placeholder.
    api
      .listJobs(12)
      .then((res) => {
        const done = res.jobs.find((j) => j.status === "completed");
        if (done) setLatest(done);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setShuffledTopics(TOPIC_CATEGORIES[activeCategory] ?? []);
  }, [activeCategory]);

  // Remember credentials and provider settings in this browser so they only have
  // to be entered once.
  useEffect(() => {
    if (!rememberCredentials) return;
    saveCredentials({
      llmProvider,
      llmModel,
      llmBaseUrl,
      llmApiKey,
      llmAuthType,
      llmAuthHeader,
      ttsProvider,
      imageProvider,
      musicProvider,
      searchProvider,
    });
  }, [
    rememberCredentials,
    llmProvider,
    llmModel,
    llmBaseUrl,
    llmApiKey,
    llmAuthType,
    llmAuthHeader,
    ttsProvider,
    imageProvider,
    musicProvider,
    searchProvider,
  ]);

  const handleRememberChange = (checked: boolean) => {
    setRememberCredentials(checked);
    if (checked) {
      saveRememberPreference(true);
    } else {
      clearCredentials();
    }
  };

  const handleShuffle = () => {
    setShuffledTopics((prev) => [...prev].sort(() => Math.random() - 0.5));
  };

  const buildJobRequest = () => {
    // The API key only applies to the OpenAI-compatible provider.
    const trimmedKey = llmProvider === "openai-compatible" ? llmApiKey.trim() : "";
    return {
      topic: topic.trim(),
      archetype: archetype || undefined,
      pacing: pacing || undefined,
      platform,
      dryRun,
      noAiAssets,
      ...(directionText.trim() ? { direction: directionText.trim() } : {}),
      ...(scoreJson ? { score: scoreJson } : {}),
      providers: {
        llm: llmProvider,
        tts: ttsProvider,
        image: imageProvider,
        music: musicProvider,
        ...(llmModel ? { llmModel } : {}),
        ...(llmBaseUrl ? { llmBaseUrl } : {}),
        ...(llmAuthType !== "auto" ? { llmAuthType } : {}),
        ...(llmAuthHeader ? { llmAuthHeader } : {}),
        ...(searchProvider ? { searchProvider } : {}),
      },
      ...(trimmedKey ? { keys: { OPENREELS_LLM_API_KEY: trimmedKey } } : {}),
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || loading) return;

    setLoading(true);
    setError("");

    try {
      const result = await api.createJob(buildJobRequest());
      navigate(`/jobs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
      setLoading(false);
    }
  };

  const hasTopic = topic.trim().length > 0;

  return (
    <div className="min-h-screen px-6 py-10 lg:px-10">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-12 lg:flex-row lg:items-start lg:gap-16">
        {/* Compose column */}
        <div className="flex w-full max-w-[600px] flex-col gap-10">
          <div>
            <h1 className="text-[28px] leading-tight font-medium tracking-tight text-foreground">
              Make a vertical short from one researched fact
            </h1>
            <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-text-subtle">
              Pitlane checks the facts, writes the script and renders the whole thing on your own
              server
            </p>
          </div>

          {/* Input Card */}
          <form onSubmit={handleSubmit} className="w-full">
            <div
              className={cn(
                "rounded-xl border bg-card px-5 py-5 transition-colors",
                hasTopic ? "border-text-faint" : "border-border",
              )}
            >
              {/* Topic Input */}
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={200}
                placeholder="How the 1964 275 GTB changed sports cars"
                className="w-full bg-transparent text-[15px] text-foreground placeholder:text-text-faint focus:outline-none"
              />

              {/* Controls Row */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {/* Platform selector */}
                <Select value={platform} onValueChange={(v) => v && setPlatform(v)}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg border-border bg-transparent px-3 text-xs font-medium text-text-subtle"
                  >
                    <MonitorPlay className="size-3.5 text-text-faint" strokeWidth={1.75} />
                    <SelectValue>{displayName(platform)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {platforms.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {displayName(p.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Pacing selector */}
                <Select value={pacing} onValueChange={(v) => setPacing(v ?? "")}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg border-border bg-transparent px-3 text-xs font-medium text-text-subtle"
                  >
                    <Gauge className="size-3.5 text-text-faint" strokeWidth={1.75} />
                    <SelectValue placeholder="Auto pace" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Auto pace</SelectItem>
                    <SelectItem value="fast">Fast</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="cinematic">Cinematic</SelectItem>
                  </SelectContent>
                </Select>

                {/* Advanced toggle */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                    showAdvanced
                      ? "border-text-faint bg-surface-inset text-foreground"
                      : "border-border bg-transparent text-text-subtle hover:text-foreground",
                  )}
                >
                  <SlidersHorizontal className="size-3.5 text-text-faint" strokeWidth={1.75} />
                  Advanced
                </button>

                {/* Spacer + Render */}
                <div className="ml-auto">
                  <Button
                    type="submit"
                    disabled={!hasTopic || loading}
                    className="h-9 gap-2 rounded-lg px-4 text-sm"
                  >
                    {loading ? "Rendering" : "Render short"}
                    {!loading && <ArrowRight className="size-4" strokeWidth={1.75} />}
                  </Button>
                </div>
              </div>

              {/* Advanced Options Panel */}
              {showAdvanced && (
                <div className="mt-5 border-t border-border pt-5">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        LLM provider
                      </label>
                      <Select value={llmProvider} onValueChange={(v) => v && setLlmProvider(v)}>
                        <SelectTrigger className="h-9 w-full rounded-lg">
                          <SelectValue>{displayName(llmProvider)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {providers?.llm.map((p) => (
                            <SelectItem key={p.key} value={p.key}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        Voice
                      </label>
                      <Select value={ttsProvider} onValueChange={(v) => v && setTtsProvider(v)}>
                        <SelectTrigger className="h-9 w-full rounded-lg">
                          <SelectValue>{displayName(ttsProvider)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {providers?.tts.map((p) => (
                            <SelectItem key={p.key} value={p.key}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        Image
                      </label>
                      <Select value={imageProvider} onValueChange={(v) => v && setImageProvider(v)}>
                        <SelectTrigger className="h-9 w-full rounded-lg">
                          <SelectValue>{displayName(imageProvider)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {providers?.image.map((p) => (
                            <SelectItem key={p.key} value={p.key}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        Music
                      </label>
                      <Select value={musicProvider} onValueChange={(v) => v && setMusicProvider(v)}>
                        <SelectTrigger className="h-9 w-full rounded-lg">
                          <SelectValue>{displayName(musicProvider)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bundled">Bundled (Free)</SelectItem>
                          <SelectItem value="lyria">Lyria 3 Pro ($0.08)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Conditional LLM config fields */}
                    {(llmProvider === "openrouter" || llmProvider === "openai-compatible") && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                          Model ID
                        </label>
                        <Input
                          className="h-9 rounded-lg text-sm"
                          placeholder={
                            llmProvider === "openrouter" ? "anthropic/claude-sonnet-4" : "llama3:8b"
                          }
                          value={llmModel}
                          onChange={(e) => setLlmModel(e.target.value)}
                        />
                      </div>
                    )}

                    {llmProvider === "openai-compatible" && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                          Base URL
                        </label>
                        <Input
                          className="h-9 rounded-lg text-sm"
                          placeholder="http://localhost:11434/v1"
                          value={llmBaseUrl}
                          onChange={(e) => setLlmBaseUrl(e.target.value)}
                        />
                      </div>
                    )}

                    {llmProvider === "openai-compatible" && (
                      <CompatibleAuthFields
                        authType={llmAuthType}
                        onAuthTypeChange={setLlmAuthType}
                        headerName={llmAuthHeader}
                        onHeaderNameChange={setLlmAuthHeader}
                        apiKey={llmApiKey}
                        onApiKeyChange={setLlmApiKey}
                        showApiKey={showApiKey}
                        onToggleApiKeyVisibility={() => setShowApiKey(!showApiKey)}
                      />
                    )}

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        Search
                      </label>
                      <Select
                        value={searchProvider}
                        onValueChange={(v) => setSearchProvider(v ?? "")}
                      >
                        <SelectTrigger className="h-9 w-full rounded-lg">
                          <SelectValue placeholder="Auto" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Auto</SelectItem>
                          {providers?.search?.map((p) => (
                            <SelectItem key={p.key} value={p.key}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Archetype fallback dropdown in Advanced */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        Style override
                      </label>
                      <Select value={archetype} onValueChange={(v) => setArchetype(v ?? "")}>
                        <SelectTrigger className="h-9 w-full rounded-lg">
                          <SelectValue placeholder="Auto" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Auto</SelectItem>
                          {archetypes.map((a) => (
                            <SelectItem key={a.name} value={a.name}>
                              {a.name
                                .split(/[-_]/)
                                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                                .join(" ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Dry Run */}
                  <div className="mt-5 flex items-center justify-between">
                    <span className="text-xs font-medium text-text-subtle">Dry run</span>
                    <div className="flex items-center gap-2">
                      <Switch checked={dryRun} onCheckedChange={setDryRun} size="sm" />
                      <span className="text-xs text-text-faint">{dryRun ? "On" : "Off"}</span>
                    </div>
                  </div>

                  {/* No AI Assets */}
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-text-subtle">No AI assets</span>
                      <span className="text-[11px] text-text-faint">
                        Stock footage and procedural text cards only
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={noAiAssets} onCheckedChange={setNoAiAssets} size="sm" />
                      <span className="text-xs text-text-faint">
                        {noAiAssets ? "On" : "Off"}
                      </span>
                    </div>
                  </div>

                  {/* Saved credentials */}
                  <RememberCredentialsToggle
                    checked={rememberCredentials}
                    onCheckedChange={handleRememberChange}
                  />

                  {/* Direction & Replay */}
                  <div className="mt-5 space-y-4 border-t border-border pt-5">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        Creative direction
                      </label>
                      <textarea
                        className="min-h-[72px] w-full resize-y rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-text-faint focus:ring-1 focus:ring-ring/40 focus:outline-none"
                        placeholder="Visual style, mood, script notes, music"
                        value={directionText}
                        onChange={(e) => {
                          const bytes = new TextEncoder().encode(e.target.value).length;
                          if (bytes <= 10240) setDirectionText(e.target.value);
                        }}
                        rows={3}
                      />
                      <p className="mt-1 text-right text-[11px] text-text-faint tabular">
                        {new TextEncoder().encode(directionText).length.toLocaleString()} / 10,240
                        bytes
                      </p>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-text-subtle">
                        Replay from score
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="file"
                          accept=".json"
                          className="h-9 rounded-lg text-sm file:mr-2 file:rounded-md file:border-0 file:bg-surface-inset file:px-2 file:py-1 file:text-xs file:font-medium file:text-text-subtle"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) {
                              setScoreJson(null);
                              setScoreFileName("");
                              return;
                            }
                            try {
                              const text = await file.text();
                              setScoreJson(JSON.parse(text));
                              setScoreFileName(file.name);
                            } catch {
                              setError("That file is not valid JSON");
                              setScoreJson(null);
                              setScoreFileName("");
                            }
                          }}
                        />
                        {scoreFileName && (
                          <span className="max-w-[160px] truncate text-xs text-text-faint">
                            {scoreFileName}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-text-faint">
                        Load a previous score.json to skip research and the director
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </form>

          {/* Visual Style */}
          {archetypes.length > 0 && (
            <div className="w-full">
              <h3 className="mb-3 text-[13px] font-medium text-text-subtle">Visual style</h3>
              <ScrollArea className="w-full">
                <div className="flex gap-2 pb-3">
                  {/* Auto Style card */}
                  <ArchetypeCard
                    archetype={null}
                    selected={archetype === ""}
                    onClick={() => setArchetype("")}
                  />
                  {archetypes.map((a) => (
                    <ArchetypeCard
                      key={a.name}
                      archetype={a}
                      selected={archetype === a.name}
                      onClick={() => setArchetype(a.name)}
                    />
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          )}

          {/* Topic Inspiration */}
          <div className="w-full">
            <div className="mb-3 flex items-center gap-3">
              {CATEGORY_KEYS.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[13px] transition-colors",
                    activeCategory === cat
                      ? "bg-surface-inset text-foreground"
                      : "text-text-faint hover:text-foreground",
                  )}
                >
                  {cat}
                </button>
              ))}
              <button
                type="button"
                onClick={handleShuffle}
                className="ml-auto flex items-center gap-1 text-xs text-text-faint transition-colors hover:text-foreground"
              >
                <Shuffle className="size-3.5" strokeWidth={1.75} />
                Shuffle
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {shuffledTopics.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTopic(s)}
                  className="rounded-lg border border-border bg-transparent px-3 py-1.5 text-[13px] text-text-subtle transition-colors hover:border-text-faint hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* The last rendered short — the product's own output */}
        <LastRendered job={latest} />
      </div>
    </div>
  );
}

/**
 * The product's real output: a vertical frame from the last finished short,
 * mounted on a soft plate. This is the one bright thing on the page.
 */
function LastRendered({ job }: { job: JobSummary | null }) {
  const frame = job?.runDir ? firstFrame(job) : null;

  return (
    <aside className="w-full shrink-0 lg:sticky lg:top-10 lg:w-[280px]">
      <div className="rounded-xl border border-border bg-surface-sunken p-3">
        <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-card">
          {frame ? (
            <img
              src={frame}
              alt={job?.topic ?? ""}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-4 text-center text-[13px] leading-relaxed text-text-faint">
              Your first short will appear here
            </div>
          )}
        </div>
        {job && (
          <div className="mt-3 flex flex-col gap-0.5 px-1 pb-1">
            <span className="text-[11px] text-text-faint">Last short</span>
            <span className="text-[13px] leading-snug text-text-subtle line-clamp-2">
              {job.topic}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

/** First scene of a finished short that actually has a frame. */
function firstFrame(job: JobSummary): string | null {
  const scenes = job.score?.scenes;
  if (!scenes || !job.runDir) return null;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    const url = getSceneAssetUrl(job.id, job.runDir, scene, i);
    if (url) return url;
  }
  return null;
}

interface RememberCredentialsToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Toggle that keeps credentials in this browser so they only have to be entered once. */
function RememberCredentialsToggle({ checked, onCheckedChange }: RememberCredentialsToggleProps) {
  return (
    <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-5">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-text-subtle">
          <Lock className="size-3.5 text-text-faint" strokeWidth={1.75} />
          Remember credentials
        </span>
        <span className="text-[11px] text-text-faint">
          Keeps the API key, base URL, model and providers in this browser
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={checked} onCheckedChange={onCheckedChange} size="sm" />
        <span className="text-xs text-text-faint">{checked ? "On" : "Off"}</span>
      </div>
    </div>
  );
}

interface CompatibleAuthFieldsProps {
  authType: LLMAuthType;
  onAuthTypeChange: (value: LLMAuthType) => void;
  headerName: string;
  onHeaderNameChange: (value: string) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showApiKey: boolean;
  onToggleApiKeyVisibility: () => void;
}

/** Auth configuration for OpenAI-compatible endpoints (Bearer, custom header, or none). */
function CompatibleAuthFields({
  authType,
  onAuthTypeChange,
  headerName,
  onHeaderNameChange,
  apiKey,
  onApiKeyChange,
  showApiKey,
  onToggleApiKeyVisibility,
}: CompatibleAuthFieldsProps) {
  return (
    <>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-text-subtle">Auth</span>
        <Select value={authType} onValueChange={(v) => v && onAuthTypeChange(v as LLMAuthType)}>
          <SelectTrigger className="h-9 w-full rounded-lg">
            <SelectValue>{AUTH_LABELS[authType]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {AUTH_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {authType === "custom-header" && (
        <div>
          <label
            htmlFor="llm-auth-header"
            className="mb-1.5 block text-xs font-medium text-text-subtle"
          >
            Auth header
          </label>
          <Input
            id="llm-auth-header"
            className="h-9 rounded-lg text-sm"
            placeholder="x-api-key"
            value={headerName}
            onChange={(e) => onHeaderNameChange(e.target.value)}
          />
        </div>
      )}

      {authType !== "none" && (
        <div>
          <label
            htmlFor="llm-api-key"
            className="mb-1.5 block text-xs font-medium text-text-subtle"
          >
            API key
          </label>
          <div className="relative">
            <Input
              id="llm-api-key"
              className="h-9 rounded-lg pr-9 text-sm"
              type={showApiKey ? "text" : "password"}
              placeholder="Uses OPENREELS_LLM_API_KEY if empty"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
            />
            <button
              type="button"
              onClick={onToggleApiKeyVisibility}
              aria-label={showApiKey ? "Hide API key" : "Show API key"}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-text-faint transition-colors hover:text-foreground"
            >
              {showApiKey ? (
                <EyeOff className="size-4" strokeWidth={1.75} />
              ) : (
                <Eye className="size-4" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
