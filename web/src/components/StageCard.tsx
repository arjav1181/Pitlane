import { Check, LoaderCircle, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

type TimelineStatus = "done" | "running" | "pending" | "error" | "skipped";

export interface StageCardProps {
  name: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  detail?: string;
  durationSec?: number;
  isFirst?: boolean;
  isLast?: boolean;
  prevStatus?: TimelineStatus;
  subStatus?: string;
  children?: React.ReactNode;
}

export const STAGE_LABELS: Record<string, string> = {
  research: "Research",
  director: "Script",
  tts: "Voice",
  visuals: "Visuals",
  assembly: "Render",
  critic: "Review",
};

const STAGE_RUNNING_TEXT: Record<string, string> = {
  research: "Researching the topic",
  director: "Writing the script",
  tts: "Synthesizing the voiceover",
  visuals: "Gathering footage",
  assembly: "Rendering the short",
  critic: "Reviewing the cut",
};

/* ------------------------------------------------------------------ */
/*  Indicator                                                          */
/* ------------------------------------------------------------------ */

/** One icon set, one size. Only the live stage carries the accent. */
function IndicatorIcon({ status }: { status: TimelineStatus }) {
  const cls = "size-3.5";
  switch (status) {
    case "done":
      return <Check className={cls} strokeWidth={2.25} />;
    case "running":
      return <LoaderCircle className={cn(cls, "animate-spin")} strokeWidth={2} />;
    case "error":
      return <X className={cls} strokeWidth={2.25} />;
    case "skipped":
      return <Minus className={cls} strokeWidth={2.25} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  StageCard                                                          */
/*                                                                     */
/*  Layout uses CSS Grid with a stretched first column:                */
/*                                                                     */
/*    grid-template-columns: 32px 1fr                                  */
/*    Row 1: auto (card height)                                        */
/*                                                                     */
/*  The lines are absolutely positioned in the first column            */
/*  to connect exactly to the next card without any gaps.              */
/* ------------------------------------------------------------------ */

export function StageCard({
  name,
  status,
  detail,
  durationSec,
  isFirst,
  isLast,
  prevStatus,
  subStatus,
  children,
}: StageCardProps) {
  const label = STAGE_LABELS[name] ?? name;

  const statusText =
    status === "done" && durationSec != null
      ? `${durationSec.toFixed(1)}s`
      : status === "done"
        ? "Done"
        : status === "running"
          ? subStatus || detail || STAGE_RUNNING_TEXT[name] || "Working"
          : status === "error"
            ? "Failed"
            : status === "skipped"
              ? "Skipped"
              : "Waiting";

  const isLive = status === "running";

  return (
    <li className={cn("relative grid grid-cols-[28px_1fr] gap-x-3", !isLast && "pb-6")}>
      {/* Col 1: Indicator and Timeline lines */}
      <div className="relative flex flex-col items-center justify-center">
        {/* Top line: from top of the grid cell down to the circle */}
        {!isFirst && prevStatus && (
          <div
            className={cn(
              "absolute top-0 bottom-[calc(50%+14px)] w-px transition-colors will-change-[background-color]",
              prevStatus === "done" ? "bg-border" : "bg-border/50",
            )}
          />
        )}

        {/* Bottom line: from the bottom of the circle, through the padding gap, to the top of the next grid cell */}
        {!isLast && (
          <div
            className={cn(
              "absolute top-[calc(50%+14px)] -bottom-6 z-[1] w-px transition-colors will-change-[background-color]",
              status === "done" ? "bg-border" : "bg-border/50",
            )}
          />
        )}

        <div
          className={cn(
            "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
            isLive
              ? "border-tally/60 bg-tally/10 text-tally"
              : status === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : status === "done"
                  ? "border-border bg-card text-text-subtle"
                  : status === "skipped"
                    ? "border-border/60 bg-transparent text-text-faint"
                    : "border-border/60 bg-transparent text-text-faint",
          )}
        >
          <IndicatorIcon status={status} />
        </div>
      </div>

      {/* Col 2: Card content */}
      <div className={cn("min-w-0 rounded-lg px-3 py-2", isLive && "bg-card")}>
        <span
          className={cn(
            "block text-[13px] leading-tight",
            status === "done" || status === "running" || status === "error"
              ? "font-medium text-foreground"
              : "text-text-faint",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-xs leading-tight",
            isLive ? "text-tally" : status === "error" ? "text-destructive" : "text-text-faint",
          )}
        >
          {statusText}
        </span>
        {children}
      </div>
    </li>
  );
}
