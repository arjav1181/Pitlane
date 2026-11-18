import { ArrowRight, LoaderCircle, Scissors, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, type CreateClipRequest, type ProviderOptions } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

/** Clip lengths worth offering as presets; a range is also editable by hand. */
const LENGTH_PRESETS = [
  { id: "tight", label: "Tight 15-25s", min: 15, max: 25 },
  { id: "shorts", label: "Shorts 20-45s", min: 20, max: 45 },
  { id: "story", label: "Story 45-60s", min: 45, max: 60 },
] as const;

export function ClipsPage() {
  const navigate = useNavigate();

  const [sourceUrl, setSourceUrl] = useState("");
  const [count, setCount] = useState(3);
  const [preset, setPreset] = useState<string>("shorts");
  const [minSeconds, setMinSeconds] = useState(20);
  const [maxSeconds, setMaxSeconds] = useState(45);
  const [fit, setFit] = useState<"blur" | "crop">("blur");
  const [captions, setCaptions] = useState(true);
  const [hook, setHook] = useState(true);
  const [liveFromStart, setLiveFromStart] = useState(false);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [maxSourceMinutes, setMaxSourceMinutes] = useState(60);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [providers, setProviders] = useState<ProviderOptions | null>(null);
  const [llmModel, setLlmModel] = useState("gemini/gemini-flash-lite-latest");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listProviders()
      .then(setProviders)
      .catch(() => {});
  }, []);

  const applyPreset = (id: string) => {
    setPreset(id);
    const found = LENGTH_PRESETS.find((p) => p.id === id);
    if (found) {
      setMinSeconds(found.min);
      setMaxSeconds(found.max);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceUrl.trim() || loading) return;

    setLoading(true);
    setError("");

    const body: CreateClipRequest = {
      sourceUrl: sourceUrl.trim(),
      count,
      minSeconds,
      maxSeconds,
      fit,
      captions,
      hook,
      liveFromStart,
      maxSourceMinutes,
      providers: { llm: "openai-compatible", llmModel },
    };

    // An empty window means "the whole source"; only a real number is sent.
    const start = Number.parseFloat(windowStart);
    const end = Number.parseFloat(windowEnd);
    if (Number.isFinite(start) && start > 0) body.startSeconds = Math.floor(start);
    if (Number.isFinite(end) && end > 0 && end > start) body.endSeconds = Math.floor(end);

    try {
      const job = await api.createClip(body);
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the clip job");
      setLoading(false);
    }
  };

  const ready = sourceUrl.trim().length > 0;

  return (
    <div className="min-h-screen px-6 py-10 lg:px-10 lg:py-12">
      <div className="mx-auto flex max-w-[760px] flex-col gap-8">
        <div>
          <h1 className="text-[28px] leading-tight font-medium tracking-tight text-foreground">
            Clip a long video into vertical shorts
          </h1>
          <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-text-subtle">
            Point it at a YouTube video, a VOD, a live stream or a direct MP4. Pitlane downloads the
            source, transcribes the speech, picks the moments that stand alone, and cuts each one to
            1080x1920 with word-timed captions and the source credited.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div
            className={cn(
              "rounded-xl border bg-card px-5 py-5 transition-colors",
              ready ? "border-text-faint" : "border-border",
            )}
          >
            <div className="flex items-center gap-2">
              <Scissors className="size-4 text-text-faint" strokeWidth={1.75} />
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full bg-transparent text-[15px] text-foreground placeholder:text-text-faint focus:outline-none"
                aria-label="Source video URL"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Select value={preset} onValueChange={(v) => v && applyPreset(v)}>
                <SelectTrigger
                  size="sm"
                  className="h-8 gap-1.5 rounded-md border-border bg-transparent px-3 text-xs font-medium text-text-subtle"
                >
                  <SelectValue>
                    {LENGTH_PRESETS.find((p) => p.id === preset)?.label ?? "Custom length"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LENGTH_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={String(count)} onValueChange={(v) => v && setCount(Number(v))}>
                <SelectTrigger
                  size="sm"
                  className="h-8 gap-1.5 rounded-md border-border bg-transparent px-3 text-xs font-medium text-text-subtle"
                >
                  <SelectValue>{count} clips</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} {n === 1 ? "clip" : "clips"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                  showAdvanced
                    ? "border-text-faint bg-surface-inset text-foreground"
                    : "border-border bg-transparent text-text-subtle hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="size-3.5 text-text-faint" strokeWidth={1.75} />
                Options
              </button>
            </div>
          </div>

          {showAdvanced && (
            <div className="grid gap-5 rounded-xl border border-border bg-card px-5 py-5 sm:grid-cols-2">
              <Field label="Shortest clip (seconds)">
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={minSeconds}
                  onChange={(e) => {
                    setPreset("custom");
                    setMinSeconds(Number(e.target.value));
                  }}
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground tabular focus:outline-none"
                />
              </Field>

              <Field label="Longest clip (seconds)">
                <input
                  type="number"
                  min={10}
                  max={180}
                  value={maxSeconds}
                  onChange={(e) => {
                    setPreset("custom");
                    setMaxSeconds(Number(e.target.value));
                  }}
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground tabular focus:outline-none"
                />
              </Field>

              <Field label="Reframe">
                <Select value={fit} onValueChange={(v) => v && setFit(v as "blur" | "crop")}>
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-full rounded-md border-border bg-transparent px-2.5 text-[13px] text-foreground"
                  >
                    <SelectValue>{fit === "blur" ? "Whole frame on blur" : "Crop to fill"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blur">Whole frame on blur</SelectItem>
                    <SelectItem value="crop">Crop to fill</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Source cap (minutes)">
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={maxSourceMinutes}
                  onChange={(e) => setMaxSourceMinutes(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground tabular focus:outline-none"
                />
              </Field>

              <Field label="Only look from (seconds)" hint="Blank reads the whole source">
                <input
                  type="number"
                  min={0}
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground tabular placeholder:text-text-faint focus:outline-none"
                />
              </Field>

              <Field label="Only look to (seconds)">
                <input
                  type="number"
                  min={0}
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  placeholder="end"
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground tabular placeholder:text-text-faint focus:outline-none"
                />
              </Field>

              <Field label="Editor model" hint="Reads the transcript and picks the moments">
                <input
                  type="text"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground focus:outline-none"
                />
              </Field>

              <div className="flex flex-col gap-2">
                <Toggle
                  label="Word-timed captions"
                  checked={captions}
                  onChange={setCaptions}
                />
                <Toggle label="Hook line on the opening" checked={hook} onChange={setHook} />
                <Toggle
                  label="Stream from the start"
                  checked={liveFromStart}
                  onChange={setLiveFromStart}
                  hint="For a live broadcast still running"
                />
              </div>

              {providers && providers.llm.length > 0 && (
                <p className="sm:col-span-2 text-[11px] leading-relaxed text-text-faint">
                  The editor model runs through the server's configured LLM provider. A model
                  unavailable at run time falls back to speech-density selection, so the job still
                  produces clips.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[46ch] text-[11px] leading-relaxed text-text-faint">
              Clips are cut locally on your server. Every clip keeps the source title, channel and
              URL in its suggested description.
            </p>
            <Button type="submit" disabled={!ready || loading} className="gap-2">
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" strokeWidth={2} />
              ) : (
                <Scissors className="size-4" strokeWidth={1.75} />
              )}
              {loading ? "Queueing" : "Cut clips"}
              {!loading && <ArrowRight className="size-4" strokeWidth={1.75} />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-text-faint">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="text-[13px] text-text-subtle">{label}</span>
        {hint && <p className="text-[11px] text-text-faint">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
