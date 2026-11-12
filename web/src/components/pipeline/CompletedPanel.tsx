import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { CostBreakdown, CriticReview, DirectorScore, JobSummary } from "@/hooks/useApi";
import { withApiKey } from "@/lib/apiKey";
import { firstPosterUrl } from "@/lib/scene-assets";
import { formatArchetypeName } from "@/lib/utils";
import { CostBreakdownCard } from "./CostBreakdownCard";
import { CriticScoreCard } from "./CriticScoreCard";

interface CompletedPanelProps {
  job: JobSummary;
  score: DirectorScore | null;
  criticReview: CriticReview | null;
  costEstimate: CostBreakdown | null;
  totalDuration: number;
}

const STAGE_ORDER = ["research", "director", "tts", "visuals", "assembly", "critic"] as const;
const STAGE_LABELS: Record<string, string> = {
  research: "Research",
  director: "Script",
  tts: "Voice",
  visuals: "Visuals",
  assembly: "Render",
  critic: "Review",
};

/**
 * The render is the stage that costs the most time and the one the product
 * exists to deliver, so it is the only segment that carries the accent.
 */
const ACCENT_STAGE = "assembly";

/** Neutral steps of the same ramp, lightest for the shortest stage. */
const NEUTRAL_STEPS = [
  "bg-foreground/18",
  "bg-foreground/24",
  "bg-foreground/30",
  "bg-foreground/36",
  "bg-foreground/42",
  "bg-foreground/48",
];

export function CompletedPanel({
  job,
  score,
  criticReview,
  costEstimate,
  totalDuration,
}: CompletedPanelProps) {
  const videoUrl = job.videoPath
    ? withApiKey(`/api/v1/jobs/${job.id}/artifacts/${job.videoPath}`)
    : null;
  const totalCost = job.actualCost?.totalCost ?? job.costEstimate?.totalCost;

  // Fetch score.json for completed jobs if not already available from SSE
  const [fetchedScore, setFetchedScore] = useState<DirectorScore | null>(null);
  useEffect(() => {
    if (score || !job.runDir) return;
    fetch(withApiKey(`/api/v1/jobs/${job.id}/artifacts/${job.runDir}/score.json`))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setFetchedScore(data as DirectorScore);
      })
      .catch(() => {});
  }, [score, job.id, job.runDir]);

  const displayScore = score ?? fetchedScore;
  const displayCritic = criticReview ?? job.criticReview;
  const sceneCount = displayScore?.scenes.length ?? null;
  // A still from the short itself, so the player is not an empty black box
  // before it is played.
  const poster = job.runDir
    ? firstPosterUrl(job.id, job.runDir, displayScore?.scenes)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Top row: the finished short + what it cost */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {/* The short itself */}
        <div className="shrink-0 sm:w-[248px]">
          <div className="flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-black">
            {videoUrl ? (
              <video
                src={videoUrl}
                poster={poster ?? undefined}
                controls
                playsInline
                className="h-full w-full object-contain"
              >
                <track kind="captions" />
              </video>
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 text-center">
                <Play className="size-6 text-text-faint" strokeWidth={1.75} />
                <span className="text-[13px] text-text-faint">Video unavailable</span>
              </div>
            )}
          </div>
          <p className="mt-2 px-0.5 text-[11px] leading-snug text-text-faint">
            {displayScore?.scenes.length ?? sceneCount ?? 0} scenes, vertical 1080x1920
          </p>
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {/* Figures, in one strip rather than three boxes */}
          <div className="flex divide-x divide-border rounded-xl border border-border bg-card">
            <Figure label="Render time" value={`${totalDuration.toFixed(1)}s`} />
            <Figure
              label="Cost"
              value={totalCost != null ? `$${totalCost.toFixed(2)}` : "—"}
            />
            <Figure label="Scenes" value={sceneCount != null ? String(sceneCount) : "—"} />
          </div>

          {/* What the short is about */}
          {displayScore && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-subtle">
              <span>{formatArchetypeName(displayScore.archetype)}</span>
              <span className="text-text-faint">·</span>
              <span>{displayScore.emotional_arc}</span>
              <span className="text-text-faint">·</span>
              <span>{displayScore.music_mood.replace(/_/g, " ")}</span>
            </div>
          )}

          {/* Music Preview */}
          {job.runDir && <MusicPreview jobId={job.id} runDir={job.runDir} />}

          {/* Stage duration breakdown */}
          {totalDuration > 0 && (
            <StageDurationRail stages={job.stages} totalDuration={totalDuration} />
          )}

          {/* Cost comparison: estimated vs actual */}
          {costEstimate && job.actualCost && costEstimate.totalCost > 0 && (
            <CostComparisonRow
              estimated={costEstimate.totalCost}
              actual={job.actualCost.totalCost}
            />
          )}
        </div>
      </div>

      {/* Quality Review */}
      {displayCritic && <CriticScoreCard review={displayCritic} />}

      {/* Cost Breakdown */}
      <CostBreakdownCard
        estimate={costEstimate ?? job.costEstimate}
        actual={job.actualCost}
        variant="full"
      />
    </div>
  );
}

/** One figure: a label and a number. Nothing else. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 px-4 py-3">
      <span className="text-[11px] text-text-faint">{label}</span>
      <span className="text-[15px] font-medium text-foreground tabular">{value}</span>
    </div>
  );
}

function MusicPreview({ jobId, runDir }: { jobId: string; runDir: string }) {
  const musicUrl = withApiKey(
    `/api/v1/jobs/${jobId}/artifacts/${runDir}/_remotion_public/music.mp3`,
  );
  const [hasMusic, setHasMusic] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(musicUrl, { method: "HEAD" })
      .then((res) => setHasMusic(res.ok))
      .catch(() => setHasMusic(false));
  }, [musicUrl]);

  if (hasMusic === null || !hasMusic) return null;

  return (
    <div>
      <span className="mb-1.5 block text-[13px] text-text-subtle">Background music</span>
      <audio src={musicUrl} controls className="h-8 w-full" preload="metadata">
        <track kind="captions" />
      </audio>
    </div>
  );
}

/**
 * Where the time went. One rail: the render carries the accent, every other
 * stage sits in a neutral step of the same ramp.
 */
function StageDurationRail({
  stages,
  totalDuration,
}: {
  stages?: Record<string, { status: string; durationSec?: number }>;
  totalDuration: number;
}) {
  if (!stages || totalDuration <= 0) return null;

  const rows = STAGE_ORDER.map((s) => ({ key: s, dur: stages[s]?.durationSec ?? 0 })).filter(
    (r) => r.dur > 0,
  );
  if (!rows.length) return null;

  const longest = rows.reduce((a, b) => (b.dur > a.dur ? b : a));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] text-text-subtle">Where the time went</span>
        <span className="text-[11px] text-text-faint tabular">
          {STAGE_LABELS[longest.key]} {longest.dur.toFixed(1)}s
        </span>
      </div>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden">
        {rows.map((r, i) => (
          <div
            key={r.key}
            className={
              r.key === ACCENT_STAGE
                ? "h-full bg-tally"
                : NEUTRAL_STEPS[Math.min(i, NEUTRAL_STEPS.length - 1)]
            }
            style={{ width: `${(r.dur / totalDuration) * 100}%` }}
            title={`${STAGE_LABELS[r.key]}: ${r.dur.toFixed(1)}s`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-faint tabular">
        {rows.map((r) => (
          <span key={r.key} className={r.key === ACCENT_STAGE ? "text-tally" : undefined}>
            {STAGE_LABELS[r.key]} {r.dur.toFixed(1)}s
          </span>
        ))}
      </div>
    </div>
  );
}

function CostComparisonRow({ estimated, actual }: { estimated: number; actual: number }) {
  const maxCost = Math.max(estimated, actual, 0.01);
  const savedPct = estimated > 0 ? ((estimated - actual) / estimated) * 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <span className="text-[13px] text-text-subtle">Cost against the estimate</span>
      <div className="mt-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="w-16 text-[11px] text-text-faint">Estimated</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-inset">
            <div
              className="h-full rounded-full bg-foreground/25"
              style={{ width: `${(estimated / maxCost) * 100}%` }}
            />
          </div>
          <span className="w-14 text-right text-[11px] text-text-subtle tabular">
            ${estimated.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-16 text-[11px] text-text-faint">Actual</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-inset">
            <div
              className="h-full rounded-full bg-tally"
              style={{ width: `${(actual / maxCost) * 100}%` }}
            />
          </div>
          <span className="w-14 text-right text-[11px] text-foreground tabular">
            ${actual.toFixed(2)}
          </span>
        </div>
        {Math.abs(savedPct) >= 1 && (
          <span className="text-right text-[11px] text-text-faint tabular">
            {savedPct > 0
              ? `${savedPct.toFixed(0)}% under the estimate`
              : `${Math.abs(savedPct).toFixed(0)}% over the estimate`}
          </span>
        )}
      </div>
    </div>
  );
}
