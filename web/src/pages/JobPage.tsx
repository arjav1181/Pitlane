import { AlertTriangle, Download, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CompletedPanel } from "@/components/pipeline/CompletedPanel";
import { CostBreakdownCard } from "@/components/pipeline/CostBreakdownCard";
import { FailedPanel } from "@/components/pipeline/FailedPanel";
import { StoryboardPanel } from "@/components/pipeline/StoryboardPanel";
import { STAGE_LABELS, StageCard } from "@/components/StageCard";
import { Button } from "@/components/ui/button";
import {
  api,
  type CostBreakdown,
  type CriticReview,
  type DirectorScore,
  type JobSummary,
  type ResearchData,
} from "@/hooks/useApi";
import { useSSE } from "@/hooks/useSSE";
import { withApiKey } from "@/lib/apiKey";
import type { SceneFallbacks } from "@/lib/scene-assets";
import { formatArchetypeName } from "@/lib/utils";

const STAGES = ["research", "director", "tts", "visuals", "assembly", "critic"] as const;

interface MusicInfo {
  status: "idle" | "generating" | "generated" | "fallback";
  provider?: string;
  prompt?: string;
  reason?: string;
}

export function JobPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobSummary | null>(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Rich SSE state
  const [score, setScore] = useState<DirectorScore | null>(null);
  const [researchData, setResearchData] = useState<ResearchData | null>(null);
  const [criticReview, setCriticReview] = useState<CriticReview | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostBreakdown | null>(null);
  const [assemblyProgress, setAssemblyProgress] = useState<{
    phase: string;
    totalFrames?: number;
  } | null>(null);
  const [assetFailures, setAssetFailures] = useState<Array<{ scene: number; error: string }>>([]);
  const [sceneFallbacks, setSceneFallbacks] = useState<SceneFallbacks>({});
  const [musicInfo, setMusicInfo] = useState<MusicInfo>({ status: "idle" });

  useEffect(() => {
    if (!id) return;
    // Reset all state when navigating to a different job
    setJob(null);
    setError("");
    setScore(null);
    setResearchData(null);
    setCriticReview(null);
    setCostEstimate(null);
    setAssemblyProgress(null);
    setAssetFailures([]);
    setSceneFallbacks({});
    setMusicInfo({ status: "idle" });
    setCancelling(false);

    api
      .getJob(id)
      .then((j) => {
        setJob(j);
        // Restore rich data from meta.json (SSE reconnection support)
        if (j.researchData) setResearchData(j.researchData);
        if (j.score) setScore(j.score as DirectorScore);
        if (j.criticReview) setCriticReview(j.criticReview);
        if (j.costEstimate) setCostEstimate(j.costEstimate);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const handleSSEEvent = useCallback(
    ({ event, data }: { event: string; data: unknown }) => {
      const d = data as Record<string, unknown>;

      if (event === "job:snapshot") {
        const snapshot = d as unknown as JobSummary;
        setJob(snapshot);
        // Restore rich data from snapshot
        if (snapshot.researchData) setResearchData(snapshot.researchData);
        if (snapshot.score) setScore(snapshot.score as DirectorScore);
        if (snapshot.criticReview) setCriticReview(snapshot.criticReview);
        if (snapshot.costEstimate) setCostEstimate(snapshot.costEstimate);
        return;
      }

      if (event === "job:completed" || event === "job:failed") {
        if (id)
          api
            .getJob(id)
            .then(setJob)
            .catch(() => {});
        return;
      }

      if (event.startsWith("stage:")) {
        const stageName = d.stage as string;
        const type = d.type as string;

        // Handle stage status updates
        if (type === "start" || type === "complete" || type === "skipped" || type === "error") {
          setJob((prev) => {
            if (!prev) return prev;
            const stages = { ...prev.stages };
            if (type === "start") {
              stages[stageName] = { status: "running" };
            } else if (type === "complete") {
              stages[stageName] = {
                status: "done",
                detail: d.detail as string,
                durationSec: d.durationSec as number,
              };
            } else if (type === "skipped") {
              stages[stageName] = { status: "skipped", detail: d.reason as string };
            } else if (type === "error") {
              stages[stageName] = { status: "error", detail: d.error as string };
            }
            return { ...prev, stages };
          });
          return;
        }

        // Handle rich progress events
        if (type === "cost_estimate") {
          setCostEstimate(d.estimate as CostBreakdown);
        } else if (type === "score") {
          setScore(d.score as DirectorScore);
        } else if (type === "results") {
          setResearchData({
            summary: d.summary as string,
            key_facts: d.key_facts as string[],
            mood: d.mood as string,
          });
        } else if (type === "review") {
          setCriticReview({
            score: d.score as number,
            strengths: d.strengths as string[],
            weaknesses: d.weaknesses as string[],
          });
        } else if (type === "bundling") {
          setAssemblyProgress({ phase: "bundling" });
        } else if (type === "rendering") {
          setAssemblyProgress({
            phase: "rendering",
            totalFrames: d.totalFrames as number | undefined,
          });
        } else if (type === "asset_failed") {
          setAssetFailures((prev) => [
            ...prev,
            { scene: d.scene as number, error: d.error as string },
          ]);
        } else if (type === "stock_fallback") {
          setSceneFallbacks((prev) => ({
            ...prev,
            [d.scene as number]: "ai_image",
          }));
        } else if (type === "video_fallback") {
          setSceneFallbacks((prev) => ({
            ...prev,
            [d.scene as number]: "ai_video_to_image",
          }));
        } else if (type === "music_generating") {
          setMusicInfo({ status: "generating", provider: d.provider as string });
        } else if (type === "music_generated") {
          setMusicInfo({
            status: "generated",
            provider: d.provider as string,
            prompt: d.prompt as string | undefined,
          });
        } else if (type === "music_fallback") {
          setMusicInfo({
            status: "fallback",
            reason: d.reason as string | undefined,
          });
        }
      }
    },
    [id],
  );

  useSSE(id, handleSSEEvent);

  const handleCancel = async () => {
    if (!id || cancelling) return;
    setCancelling(true);
    try {
      await api.cancelJob(id);
      if (id)
        api
          .getJob(id)
          .then(setJob)
          .catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
    setCancelling(false);
  };

  if (error && !job) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center text-center">
        <AlertTriangle className="mb-4 size-10 text-destructive" />
        <p className="text-destructive">{error}</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate("/")}>
          Back to home
        </Button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="px-6 py-8 lg:px-10">
        {/* Header skeleton */}
        <div className="mb-6 flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-6 w-64 animate-pulse rounded-lg bg-card" />
            <div className="h-4 w-32 animate-pulse rounded bg-card" />
          </div>
          <div className="h-8 w-28 animate-pulse rounded-lg bg-card" />
        </div>
        {/* Two-column skeleton */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Timeline */}
          <div className="w-full lg:w-[280px] space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-8 animate-pulse rounded-full bg-card" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 animate-pulse rounded bg-card" />
                  <div className="h-3 w-16 animate-pulse rounded bg-card" />
                </div>
              </div>
            ))}
          </div>
          {/* Content */}
          <div className="flex-1 space-y-3">
            <div className="h-48 animate-pulse rounded-xl bg-card" />
            <div className="h-32 animate-pulse rounded-xl bg-card" />
          </div>
        </div>
      </div>
    );
  }

  const isRunning = job.status === "running" || job.status === "queued";
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";
  const videoUrl = job.videoPath
    ? withApiKey(`/api/v1/jobs/${job.id}/artifacts/${job.videoPath}`)
    : null;

  // Find the failed stage for error display
  const failedStage = isFailed
    ? (STAGES.find((s) => job.stages?.[s]?.status === "error") ??
      STAGES.find((s) => job.stages?.[s]?.status === "running") ??
      null)
    : null;
  const failedDetail = failedStage
    ? (job.stages?.[failedStage]?.detail ?? job.error ?? null)
    : (job.error ?? null);

  // Compute total duration
  const totalDuration = STAGES.reduce((sum, s) => {
    const d = job.stages?.[s]?.durationSec;
    return sum + (d ?? 0);
  }, 0);

  const totalCost = job.actualCost?.totalCost ?? job.costEstimate?.totalCost;

  // Assembly sub-status for StageCard
  const assemblySubStatus = assemblyProgress
    ? assemblyProgress.phase === "bundling"
      ? "Bundling..."
      : assemblyProgress.totalFrames
        ? `Rendering ${assemblyProgress.totalFrames} frames`
        : "Rendering..."
    : undefined;

  // Stage status helpers
  const visualsComplete =
    job.stages?.visuals?.status === "done" || job.stages?.visuals?.status === "skipped";

  return (
    <div className="px-6 py-8 lg:px-10">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] leading-snug font-medium tracking-tight text-foreground">
            {job.topic}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-faint">
            <span>YouTube Shorts</span>
            {job.archetype && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatArchetypeName(job.archetype)}</span>
              </>
            )}
            {job.noAiAssets && (
              <>
                <span aria-hidden="true">·</span>
                <span>Stock only</span>
              </>
            )}
            {totalCost != null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular">
                  ${totalCost.toFixed(2)} {job.actualCost ? "spent" : "estimated"}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-tally" />
              <span className="text-[13px] text-tally">Rendering</span>
            </span>
          )}
          {isCompleted && (
            <span className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-status-success" />
              <span className="text-[13px] text-text-subtle">Complete</span>
            </span>
          )}
          {isFailed && (
            <span className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-destructive" />
              <span className="text-[13px] text-text-subtle">Failed</span>
            </span>
          )}
          {isCancelled && (
            <span className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-status-warning" />
              <span className="text-[13px] text-text-subtle">Cancelled</span>
            </span>
          )}

          {isRunning && (
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelling" : "Cancel"}
            </Button>
          )}
          {isCompleted && videoUrl && (
            <a href={videoUrl} download>
              <Button size="sm" className="gap-2">
                <Download className="size-4" strokeWidth={1.75} />
                Download
              </Button>
            </a>
          )}
          {!isRunning && (
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              <Plus className="size-4" strokeWidth={1.75} />
              New short
            </Button>
          )}
        </div>
      </div>

      {/* Two-column layout — stacks on mobile */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
        {/* Left: Pipeline Timeline — sticky on desktop */}
        <ol className="m-0 w-full list-none p-0 lg:w-[248px] lg:shrink-0 lg:sticky lg:top-8 lg:self-start">
          {STAGES.map((stage, i) => {
            const stageData = job.stages?.[stage];
            const prevStageName = i > 0 ? STAGES[i - 1] : undefined;
            const prevStatus = prevStageName
              ? ((job.stages?.[prevStageName]?.status as
                  | "pending"
                  | "running"
                  | "done"
                  | "skipped"
                  | "error") ?? "pending")
              : undefined;

            return (
              <StageCard
                key={stage}
                name={stage}
                status={(stageData?.status as "pending") ?? "pending"}
                detail={stageData?.detail}
                durationSec={stageData?.durationSec}
                isFirst={i === 0}
                isLast={i === STAGES.length - 1}
                prevStatus={prevStatus}
                subStatus={stage === "assembly" ? assemblySubStatus : undefined}
              />
            );
          })}
        </ol>

        {/* Right: Progressive Card Feed */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Completed: video player + stats at top */}
          {isCompleted && (
            <CompletedPanel
              job={job}
              score={score}
              criticReview={criticReview}
              costEstimate={costEstimate}
              totalDuration={totalDuration}
            />
          )}

          {/* Failed/cancelled error card */}
          {(isFailed || isCancelled) && (
            <FailedPanel
              failedStageName={
                isCancelled
                  ? "Pipeline"
                  : failedStage
                    ? (STAGE_LABELS[failedStage] ?? failedStage)
                    : "Unknown Stage"
              }
              failedDetail={isCancelled ? "Job was cancelled by user" : failedDetail}
            />
          )}

          {/* Research card — always visible once available */}
          {researchData && <ResearchCard data={researchData} />}

          {/* Storyboard — always visible once score available */}
          {score && (
            <StoryboardPanel
              score={score}
              jobId={job.id}
              runDir={job.runDir ?? null}
              visualsComplete={!!visualsComplete}
              assetFailures={assetFailures}
              sceneFallbacks={sceneFallbacks}
            />
          )}

          {/* Cost estimate — shown during generation */}
          {costEstimate && !isCompleted && (
            <CostBreakdownCard estimate={costEstimate} variant="compact" />
          )}

          {/* Music status — live during visuals */}
          {musicInfo.status !== "idle" && !isCompleted && <MusicStatusCard info={musicInfo} />}

          {/* Asset failure warnings */}
          {assetFailures.length > 0 && !isCompleted && (
            <div className="rounded-xl border border-status-warning/25 bg-card p-4">
              <span className="text-[13px] text-status-warning">Asset warnings</span>
              <div className="mt-2 flex flex-col gap-1">
                {assetFailures.map((f, i) => (
                  <p key={i} className="text-xs text-status-warning/90">
                    Scene {f.scene}: {f.error}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* TTS badge */}
          {job.stages?.tts?.status === "done" && job.stages.tts.detail && !isCompleted && (
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <span className="text-[13px] text-text-subtle">
                Voice: {job.stages.tts.detail}
              </span>
            </div>
          )}

          {/* Empty state while waiting */}
          {!researchData && !score && !costEstimate && isRunning && (
            <div className="flex h-64 items-center justify-center">
              <p className="text-[13px] text-text-faint">
                Each stage writes here as it finishes
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Inline sub-components ─── */

function ResearchCard({ data }: { data: ResearchData }) {
  const [expanded, setExpanded] = useState(false);
  const facts = expanded ? data.key_facts : data.key_facts.slice(0, 5);

  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-in fade-in duration-500">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[13px] text-text-subtle">Research</span>
        <span className="text-[11px] text-text-faint tabular">
          {data.key_facts.length} facts
          {data.mood ? ` · ${data.mood}` : ""}
        </span>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-text-subtle">{data.summary}</p>
      {data.key_facts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {facts.map((fact, i) => (
            <span
              key={i}
              className="rounded-md bg-surface-inset px-2 py-1 text-[11px] text-text-subtle"
            >
              {fact}
            </span>
          ))}
          {data.key_facts.length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="rounded-md bg-surface-inset px-2 py-1 text-[11px] text-text-subtle hover:text-foreground"
            >
              {expanded ? "Show less" : `+${data.key_facts.length - 5} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MusicStatusCard({ info }: { info: MusicInfo }) {
  const musicProviderNames: Record<string, string> = {
    lyria: "Lyria",
    bundled: "Bundled Library",
  };
  const providerLabel = musicProviderNames[info.provider ?? ""] ?? info.provider ?? "AI";
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 px-4 py-2.5 flex items-center gap-2">
      {info.status === "generating" && (
        <>
          <div className="size-3 animate-spin rounded-full border-2 border-border border-t-primary" />
          <span className="text-[11px] text-text-subtle">
            Generating music via {providerLabel}...
          </span>
        </>
      )}
      {info.status === "generated" && (
        <>
          <span className="size-2 rounded-full bg-status-success" />
          <span className="text-[11px] text-text-subtle">Music generated via {providerLabel}</span>
        </>
      )}
      {info.status === "fallback" && (
        <>
          <span className="size-2 rounded-full bg-status-warning" />
          <span className="text-[11px] text-text-subtle">
            Using bundled track{info.reason ? ` (${info.reason})` : ""}
          </span>
        </>
      )}
    </div>
  );
}
