import { useState } from "react";
import { Link } from "react-router-dom";
import type { JobSummary, DirectorScore } from "@/hooks/useApi";
import { firstPosterUrl, jobPosterUrl } from "@/lib/scene-assets";
import { cn, formatArchetypeName } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, LoaderCircle } from "lucide-react";

interface GalleryCardProps {
  job: JobSummary;
  bulkMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  timeAgo: string;
}

export function GalleryCard({ job, bulkMode, selected, onToggleSelect, timeAgo }: GalleryCardProps) {
  const isFailed = job.status === "failed";
  const isRunning = job.status === "running" || job.status === "queued";
  const score = job.score as DirectorScore | undefined;
  const sceneCount = score?.scenes?.length;
  const criticScore = job.criticReview?.score;
  const cost = job.actualCost?.totalCost ?? job.costEstimate?.totalCost;

  // The pipeline's poster, or the first scene that has a still. Video scenes
  // have no still of their own.
  const thumbnailUrl =
    jobPosterUrl(job) ?? (job.runDir ? firstPosterUrl(job.id, job.runDir, score?.scenes) : null);
  const [imgError, setImgError] = useState(false);

  return (
    <div className="relative group">
      {/* Checkbox overlay */}
      {bulkMode && (
        <div className="absolute top-2 left-2 z-10">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            className="border-text-faint bg-background/70 data-[state=checked]:bg-tally data-[state=checked]:border-tally"
          />
        </div>
      )}

      <Link
        to={`/jobs/${job.id}`}
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-text-faint",
          selected ? "border-tally/70" : "border-border",
        )}
      >
        {/* Frame */}
        <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-surface-inset">
          {thumbnailUrl && !imgError ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : isRunning ? (
            <div className="flex items-center gap-2 text-[13px] text-text-faint">
              <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
              Rendering
            </div>
          ) : isFailed ? (
            <div className="flex items-center gap-2 text-[13px] text-text-faint">
              <AlertTriangle className="size-4" strokeWidth={1.75} />
              Failed
            </div>
          ) : (
            <span className="px-4 text-center text-[13px] text-text-faint">
              {job.archetype ? formatArchetypeName(job.archetype) : "Short"}
            </span>
          )}

          {/* The tally light marks the one thing that is live. */}
          {isRunning && (
            <span className="absolute top-2 right-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1">
              <span className="size-1.5 rounded-full bg-tally" />
              <span className="text-[11px] text-tally">Live</span>
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-1 flex-col p-4">
          <h3 className="text-[13px] leading-snug font-medium text-foreground line-clamp-2">
            {job.topic}
          </h3>

          <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] text-text-faint tabular">
            {job.archetype && <span>{formatArchetypeName(job.archetype)}</span>}
            {sceneCount != null && <span>{sceneCount} scenes</span>}
            {criticScore != null && <span>{criticScore}/10</span>}
            {cost != null && <span>${cost.toFixed(2)}</span>}
            <span className="ml-auto">{timeAgo}</span>
          </div>
        </div>
      </Link>
    </div>
  );
}
