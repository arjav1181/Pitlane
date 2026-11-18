import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ClipRecord, ClipSource, JobSummary } from "@/hooks/useApi";
import { withApiKey } from "@/lib/apiKey";

interface ClipsPanelProps {
  job: JobSummary;
  clips: ClipRecord[];
}

/** Seconds as `1:07`, which is how a clip length is read at a glance. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function artifactUrl(jobId: string, path: string): string {
  return withApiKey(
    `/api/v1/jobs/${jobId}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`,
  );
}

/**
 * The clips a job produced.
 *
 * Each row is one finished vertical, playable in place, with the two strings
 * the operator actually needs to paste into a description: the clipped title
 * and the attribution line the pipeline wrote for it.
 */
export function ClipsPanel({ job, clips }: ClipsPanelProps) {
  const totalSeconds = clips.reduce((sum, clip) => sum + clip.durationSeconds, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] text-text-subtle">
          {clips.length} vertical {clips.length === 1 ? "clip" : "clips"}
        </span>
        <span className="text-[11px] text-text-faint tabular">
          {clock(totalSeconds)} of video · 1080x1920
        </span>
      </div>

      {job.source && <SourceLine source={job.source} />}

      <div className="grid gap-4 sm:grid-cols-2">
        {clips.map((clip, i) => (
          <ClipCard key={clip.path || i} jobId={job.id} clip={clip} index={i + 1} />
        ))}
      </div>
    </div>
  );
}

function SourceLine({ source }: { source: ClipSource }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-text-faint">Source</span>
        <a
          href={source.webpageUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate text-[13px] text-text-subtle hover:text-foreground"
          title={source.title}
        >
          {source.title}
        </a>
        {source.uploader && (
          <span className="text-[11px] text-text-faint">· {source.uploader}</span>
        )}
        {source.wasLive && <span className="text-[11px] text-text-faint">· live</span>}
      </div>
      <p className="mt-1 text-[11px] text-text-faint tabular">
        {clock(source.durationSeconds)} total, read from {clock(source.window.start)} to{" "}
        {clock(source.window.end)}
      </p>
    </div>
  );
}

function ClipCard({ jobId, clip, index }: { jobId: string; clip: ClipRecord; index: number }) {
  const [copied, setCopied] = useState<"title" | "description" | null>(null);

  const videoUrl = clip.path ? artifactUrl(jobId, clip.path) : null;
  const posterUrl = clip.posterPath ? artifactUrl(jobId, clip.posterPath) : undefined;
  const downloadUrl = clip.path ? `${videoUrl}&download=1` : null;

  const copy = async (what: "title" | "description", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access can be denied; the text is still selectable on screen.
    }
  };

  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-3">
      {/* The clip itself, already vertical */}
      <div className="w-[124px] shrink-0">
        <div className="flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-black">
          {videoUrl ? (
            <video
              src={videoUrl}
              poster={posterUrl}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
            >
              <track kind="captions" />
            </video>
          ) : (
            <span className="px-3 text-center text-[11px] text-text-faint">Not rendered</span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-text-faint tabular">{index}</span>
          <span className="text-[11px] text-text-faint tabular">
            {clock(clip.sourceStart)}–{clock(clip.sourceEnd)}
          </span>
          <span className="text-[11px] text-text-faint tabular">
            · {clip.durationSeconds.toFixed(1)}s
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-foreground" title={clip.title}>
          {clip.suggestedTitle || clip.title}
        </p>

        {clip.hook && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-text-subtle">
            Hook: {clip.hook}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1 pt-3">
          {downloadUrl && (
            <a href={downloadUrl} download>
              <Button variant="outline" size="xs" className="gap-1">
                <Download className="size-3" strokeWidth={1.75} />
                MP4
              </Button>
            </a>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="gap-1"
            onClick={() => copy("title", `${clip.suggestedTitle || clip.title} #Shorts`)}
          >
            {copied === "title" ? (
              <Check className="size-3" strokeWidth={2} />
            ) : (
              <Copy className="size-3" strokeWidth={1.75} />
            )}
            Title
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="gap-1"
            onClick={() => copy("description", clip.suggestedDescription)}
            disabled={!clip.suggestedDescription}
          >
            {copied === "description" ? (
              <Check className="size-3" strokeWidth={2} />
            ) : (
              <Copy className="size-3" strokeWidth={1.75} />
            )}
            Caption
          </Button>
        </div>
      </div>
    </div>
  );
}
