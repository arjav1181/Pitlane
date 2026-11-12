import { cn, formatArchetypeName } from "@/lib/utils";
import { Check } from "lucide-react";
import type { Archetype } from "@/hooks/useApi";

interface ArchetypeCardProps {
  archetype: Archetype | null; // null = "Auto"
  selected: boolean;
  onClick: () => void;
}

const SWATCH_WIDTHS = ["flex-[3]", "flex-[2]", "flex-[1]"] as const;

/**
 * One visual style. The palette strip is the style's own colours — the colour
 * the video will actually be rendered in — so it belongs here, once, instead
 * of a gradient panel behind the label and loose dots on top of it.
 */
export function ArchetypeCard({ archetype, selected, onClick }: ArchetypeCardProps) {
  const isAuto = archetype === null;
  const palette = archetype?.colorPalette;
  const pacing = archetype?.scenePacing;
  const mood = archetype?.mood?.split(",")[0]?.trim();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-[168px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border text-left transition-colors",
        selected
          ? "border-tally/70 bg-surface-inset"
          : "border-border bg-card hover:border-text-faint",
      )}
    >
      {selected && (
        <span className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-tally">
          <Check className="size-2.5 text-tally-foreground" strokeWidth={3} />
        </span>
      )}

      {palette ? (
        <span className="flex h-1.5 w-full shrink-0" aria-hidden="true">
          {[palette.background, palette.accent, palette.text].map((colour, i) => (
            <span
              key={i}
              className={cn("h-full", SWATCH_WIDTHS[i])}
              style={{ backgroundColor: colour }}
            />
          ))}
        </span>
      ) : (
        <span className="h-1.5 w-full shrink-0 bg-surface-sunken" aria-hidden="true" />
      )}

      <span className="flex flex-col gap-0.5 px-3 py-2.5">
        <span
          className={cn(
            "truncate text-[13px] font-medium leading-tight",
            selected ? "text-foreground" : "text-text-subtle group-hover:text-foreground",
          )}
        >
          {isAuto ? "Auto" : formatArchetypeName(archetype!.name)}
        </span>
        <span className="truncate text-[11px] leading-tight text-text-faint">
          {isAuto ? "Director chooses" : [mood, pacing].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
