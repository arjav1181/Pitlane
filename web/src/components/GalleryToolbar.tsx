import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search, LayoutGrid, List } from "lucide-react";
import { cn, formatArchetypeName } from "@/lib/utils";
import type { Archetype } from "@/hooks/useApi";

export type SortBy = "newest" | "oldest" | "cost" | "score";

const STATUS_LABELS: Record<string, string> = {
  all: "All statuses",
  completed: "Completed",
  failed: "Failed",
  running: "Live",
};

const SORT_LABELS: Record<string, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  cost: "Highest cost",
  score: "Highest score",
};
export type StatusFilter = "all" | "completed" | "failed" | "running";
export type ViewMode = "grid" | "list";

interface GalleryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  archetypeFilter: string;
  onArchetypeChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  sortBy: SortBy;
  onSortChange: (value: SortBy) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  archetypes: Archetype[];
}

export function GalleryToolbar({
  searchQuery,
  onSearchChange,
  archetypeFilter,
  onArchetypeChange,
  statusFilter,
  onStatusChange,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  archetypes,
}: GalleryToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-faint" strokeWidth={1.75} />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search"
          className="h-9 rounded-md border-border bg-surface-inset pl-9 text-sm text-foreground placeholder:text-text-faint"
        />
      </div>

      {/* Archetype filter */}
      <Select value={archetypeFilter} onValueChange={(v) => v && onArchetypeChange(v)}>
        <SelectTrigger className="h-9 w-auto min-w-[120px] rounded-md border-border bg-surface-inset text-xs">
          <SelectValue placeholder="All styles">
            {archetypeFilter === "all"
              ? "All styles"
              : formatArchetypeName(archetypeFilter)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All styles</SelectItem>
          {archetypes.map((a) => (
            <SelectItem key={a.name} value={a.name}>
              {formatArchetypeName(a.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status filter */}
      <Select
        value={statusFilter}
        onValueChange={(v) => onStatusChange(v as StatusFilter)}
      >
        <SelectTrigger className="h-9 w-auto min-w-[120px] rounded-md border-border bg-surface-inset text-xs">
          <SelectValue>
            {STATUS_LABELS[statusFilter] ?? "All statuses"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="running">Live</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort */}
      <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortBy)}>
        <SelectTrigger className="h-9 w-auto min-w-[120px] rounded-md border-border bg-surface-inset text-xs">
          <SelectValue>{SORT_LABELS[sortBy] ?? "Newest first"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest first</SelectItem>
          <SelectItem value="oldest">Oldest first</SelectItem>
          <SelectItem value="cost">Highest cost</SelectItem>
          <SelectItem value="score">Highest score</SelectItem>
        </SelectContent>
      </Select>

      {/* View toggle */}
      <div className="flex rounded-md border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => onViewModeChange("grid")}
          className={cn(
            "flex items-center justify-center size-9 transition-colors",
            viewMode === "grid" ? "bg-surface-inset text-foreground" : "text-text-faint hover:text-foreground",
          )}
        >
          <LayoutGrid className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("list")}
          className={cn(
            "flex items-center justify-center size-9 border-l border-border transition-colors",
            viewMode === "list" ? "bg-surface-inset text-foreground" : "text-text-faint hover:text-foreground",
          )}
        >
          <List className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
