import type { CriticReview } from "@/hooks/useApi";

interface CriticScoreCardProps {
  review: CriticReview;
}

/**
 * The review is a score, not a verdict. The ring carries the accent because
 * the score is the one number on this panel that matters; the findings are
 * quiet text with a sign, not coloured pills.
 */
export function CriticScoreCard({ review }: CriticScoreCardProps) {
  const circumference = 2 * Math.PI * 36;
  const progress = (review.score / 10) * circumference;
  const dashOffset = circumference - progress;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <span className="text-[13px] text-text-subtle">Quality review</span>

      <div className="mt-4 flex gap-6">
        {/* Score */}
        <div className="shrink-0">
          <svg width="72" height="72" viewBox="0 0 80 80" className="rotate-[-90deg]">
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="var(--surface-inset)"
              strokeWidth="5"
            />
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="var(--tally)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
          </svg>
          <div className="relative -mt-[50px] flex h-6 items-center justify-center gap-0.5">
            <span className="text-[19px] font-medium text-foreground tabular">{review.score}</span>
            <span className="text-[11px] text-text-faint">/10</span>
          </div>
        </div>

        {/* Findings */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {review.strengths.map((s, i) => (
            <div key={`s-${i}`} className="flex items-start gap-2">
              <span className="shrink-0 text-[11px] text-status-success">+</span>
              <span className="text-[12px] leading-snug text-text-subtle">{s}</span>
            </div>
          ))}
          {review.weaknesses.map((w, i) => (
            <div key={`w-${i}`} className="flex items-start gap-2">
              <span className="shrink-0 text-[11px] text-destructive">&minus;</span>
              <span className="text-[12px] leading-snug text-text-subtle">{w}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
