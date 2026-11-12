import { BarChart3, CheckCircle, DollarSign, Film, KeyRound, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type StatsResponse } from "@/hooks/useApi";
import { clearApiKey, loadApiKey, saveApiKey } from "@/lib/apiKey";
import {
  AUTH_LABELS,
  clearCredentials,
  loadCredentials,
  maskSecret,
  type SavedCredentials,
} from "@/lib/credentials";
import { cn } from "@/lib/utils";

const API_KEY_FIELDS = [
  { key: "ANTHROPIC_API_KEY", label: "Anthropic (LLM)" },
  { key: "OPENAI_API_KEY", label: "OpenAI (LLM/Image)" },
  { key: "GOOGLE_API_KEY", label: "Google Gemini (LLM/Image/Video)" },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter (LLM)" },
  { key: "OPENREELS_LLM_API_KEY", label: "OpenAI-compatible endpoint (LLM)" },
  { key: "ELEVENLABS_API_KEY", label: "ElevenLabs (TTS)" },
  { key: "INWORLD_TTS_API_KEY", label: "Inworld (TTS)" },
  { key: "PEXELS_API_KEY", label: "Pexels (Stock)" },
  { key: "PIXABAY_API_KEY", label: "Pixabay (Stock)" },
];

interface HealthData {
  status: string;
  version?: string;
  redis: string;
  apiKeyRequired?: boolean;
  keys?: Record<string, boolean>;
}

export function SettingsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [saved, setSaved] = useState<SavedCredentials | null>(null);
  const [serverApiKey, setServerApiKey] = useState(loadApiKey);
  const [serverKeyStatus, setServerKeyStatus] = useState("");

  const refreshHealth = useCallback(() => {
    api
      .getHealth()
      .then((data) => setHealth(data as unknown as HealthData))
      .catch(() => {});
    api
      .getStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshHealth();
    setSaved(loadCredentials());
  }, [refreshHealth]);

  const avgCost = stats && stats.completedJobs > 0 ? stats.totalCost / stats.completedJobs : null;

  return (
    <div className="py-8 px-4 sm:px-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="max-w-[560px] flex flex-col gap-8">
        {/* Usage Statistics */}
        {stats && stats.totalJobs > 0 && (
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <BarChart3 className="size-4 text-muted-foreground" />
              Usage Statistics
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox
                icon={<Film className="size-4" />}
                label="Total Videos"
                value={String(stats.totalJobs)}
              />
              <StatBox
                icon={<CheckCircle className="size-4 text-status-success" />}
                label="Completed"
                value={String(stats.completedJobs)}
                color="text-status-success"
              />
              <StatBox
                icon={<XCircle className="size-4 text-destructive" />}
                label="Failed"
                value={String(stats.failedJobs)}
                color="text-destructive"
              />
              <StatBox
                icon={<DollarSign className="size-4 text-status-info" />}
                label="Total Spend"
                value={`$${stats.totalCost.toFixed(2)}`}
                color="text-status-info"
              />
            </div>
            {avgCost != null && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Average cost per video: ${avgCost.toFixed(2)}
              </p>
            )}
          </section>
        )}

        {/* System Status */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-foreground">System Status</h2>
          <div className="overflow-hidden rounded-[12px] border border-border bg-card">
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-[13px] text-text-subtle">API Server</span>
              <StatusDot
                ok={health?.status === "healthy"}
                label={
                  health
                    ? health.status === "healthy"
                      ? "Connected"
                      : health.status
                    : "Checking..."
                }
              />
            </div>
            <div className="border-t border-border" />
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-[13px] text-text-subtle">Redis Queue</span>
              <StatusDot
                ok={health?.redis === "connected"}
                label={
                  health
                    ? health.redis === "connected"
                      ? "Connected"
                      : health.redis
                    : "Checking..."
                }
              />
            </div>
            <div className="border-t border-border" />
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-[13px] text-text-subtle">Version</span>
              <code className="font-mono text-[12px] text-muted-foreground">
                {health?.version ?? "—"}
              </code>
            </div>
          </div>
        </section>

        {/* Saved credentials (browser) */}
        <SavedCredentialsSection
          saved={saved}
          onClear={() => {
            clearCredentials();
            setSaved(null);
          }}
        />

        {/* Server access (OPENREELS_API_KEY) */}
        <section>
          <h2 className="mb-1 text-sm font-semibold text-foreground">Server Access</h2>
          <p className="mb-4 text-[13px] text-muted-foreground">
            If the server was started with{" "}
            <code className="font-mono text-[12px]">OPENREELS_API_KEY</code>, enter it here. It is
            stored in this browser&apos;s{" "}
            <code className="font-mono text-[12px]">localStorage</code> and sent with every API
            request.
          </p>
          <div className="rounded-[12px] border border-border bg-card p-4">
            <label
              htmlFor="server-api-key"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              API key
            </label>
            <div className="flex gap-2">
              <Input
                id="server-api-key"
                type="password"
                autoComplete="off"
                placeholder={loadApiKey() ? "Saved key" : "Not set"}
                value={serverApiKey}
                onChange={(event) => {
                  setServerApiKey(event.target.value);
                  setServerKeyStatus("");
                }}
                className="h-9 rounded-lg text-sm"
              />
              <Button
                size="sm"
                onClick={() => {
                  saveApiKey(serverApiKey);
                  setServerApiKey(loadApiKey());
                  setServerKeyStatus(
                    loadApiKey() ? "Saved. Requests now include this key." : "Cleared.",
                  );
                  refreshHealth();
                }}
              >
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearApiKey();
                  setServerApiKey("");
                  setServerKeyStatus("Cleared.");
                  refreshHealth();
                }}
              >
                Clear
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-text-faint">
              {health?.apiKeyRequired
                ? "This server requires an API key."
                : "This server does not require an API key."}
              {serverKeyStatus ? ` ${serverKeyStatus}` : ""}
            </p>
          </div>
        </section>

        {/* API Keys */}
        <section>
          <h2 className="mb-1 text-sm font-semibold text-foreground">API Keys</h2>
          <p className="mb-4 text-[13px] text-muted-foreground">
            API keys are configured server-side via environment variables.
          </p>
          <div className="overflow-hidden rounded-[12px] border border-border bg-card">
            {API_KEY_FIELDS.map((field, i) => {
              const isSet = health?.keys?.[field.key] ?? null;
              return (
                <div key={field.key}>
                  {i > 0 && <div className="border-t border-border" />}
                  <div className="flex items-center justify-between px-5 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <code className="font-mono text-[13px] text-text-subtle">{field.key}</code>
                      <span className="text-[11px] text-text-faint">{field.label}</span>
                    </div>
                    {isSet !== null ? (
                      <StatusDot
                        ok={isSet}
                        label={isSet ? "Set" : "Not set"}
                        colorOk="text-emerald-400"
                        colorBad="text-amber-400"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">--</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function SavedCredentialsSection({
  saved,
  onClear,
}: {
  saved: SavedCredentials | null;
  onClear: () => void;
}) {
  const rows = saved
    ? [
        { label: "LLM provider", value: saved.llmProvider ?? "—" },
        { label: "Base URL", value: saved.llmBaseUrl || "—" },
        { label: "Model", value: saved.llmModel || "—" },
        { label: "Auth", value: AUTH_LABELS[saved.llmAuthType ?? "auto"] },
        { label: "Auth header", value: saved.llmAuthHeader || "—" },
        { label: "TTS provider", value: saved.ttsProvider ?? "—" },
        { label: "Image provider", value: saved.imageProvider ?? "—" },
        { label: "Music provider", value: saved.musicProvider ?? "—" },
      ]
    : [];

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        <KeyRound className="size-4 text-muted-foreground" />
        Saved Credentials
      </h2>
      <p className="mb-4 text-[13px] text-muted-foreground">
        Credentials remembered by this browser. They are stored in{" "}
        <code className="font-mono text-[12px]">localStorage</code> and are only sent to the API
        when you start a job.
      </p>
      {saved ? (
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          {rows.map((row, i) => (
            <div key={row.label}>
              {i > 0 && <div className="border-t border-border" />}
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="text-[13px] text-text-subtle">{row.label}</span>
                <code className="truncate font-mono text-[12px] text-muted-foreground">
                  {row.value}
                </code>
              </div>
            </div>
          ))}
          <div className="border-t border-border">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="text-[13px] text-text-subtle">API key</span>
              <code className="truncate font-mono text-[12px] text-muted-foreground">
                {saved.llmApiKey ? maskSecret(saved.llmApiKey) : "Not saved"}
              </code>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-border bg-card px-5 py-4 text-[13px] text-muted-foreground">
          No credentials saved. Turn on &quot;Remember credentials&quot; in the Advanced panel of
          the home page to save them.
        </div>
      )}
      {saved && (
        <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={onClear}>
          <Trash2 className="size-3.5" />
          Clear saved credentials
        </Button>
      )}
    </section>
  );
}

function StatusDot({
  ok,
  label,
  colorOk = "text-emerald-400",
  colorBad = "text-destructive",
}: {
  ok: boolean;
  label: string;
  colorOk?: string;
  colorBad?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2 text-sm font-medium", ok ? colorOk : colorBad)}>
      <span
        className={cn("inline-block size-2 rounded-full", ok ? "bg-emerald-400" : "bg-current")}
      />
      {label}
    </span>
  );
}

function StatBox({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[10px] border border-border bg-card py-3 px-2">
      <div className="text-muted-foreground">{icon}</div>
      <span className={cn("text-lg font-bold", color ?? "text-foreground")}>{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
