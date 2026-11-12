import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Clapperboard,
  PlusCircle,
  LayoutGrid,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Film,
} from "lucide-react";
import type { StatsResponse } from "@/hooks/useApi";

const NAV_ITEMS = [
  { path: "/", label: "New short", icon: PlusCircle },
  { path: "/gallery", label: "Gallery", icon: LayoutGrid },
  { path: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  stats: StatsResponse | null;
}

export function Sidebar({ collapsed, onToggle, stats }: SidebarProps) {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/")
      return location.pathname === "/" || location.pathname.startsWith("/jobs");
    return location.pathname.startsWith(path);
  };

  const live = (stats?.activeJobs ?? 0) > 0;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
        collapsed ? "w-16" : "w-[240px]",
      )}
    >
      {/* Wordmark */}
      <div
        className={cn(
          "flex items-center gap-2.5 pt-6 pb-0 transition-[padding] duration-200",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <Clapperboard className="size-5 shrink-0 text-tally" strokeWidth={1.75} />
        {!collapsed && (
          <span className="text-[15px] font-medium tracking-tight text-foreground">
            Pitlane
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn("mt-6 flex flex-col gap-1", collapsed ? "px-2" : "px-3")}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative flex h-9 items-center rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-0" : "gap-2.5 px-3",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="size-[18px] shrink-0" strokeWidth={1.75} />
              {!collapsed && item.label}
              {/* The tally light marks the one thing that is live. */}
              {item.path === "/" && live && (
                <span
                  className={cn(
                    "size-1.5 rounded-full bg-tally",
                    collapsed ? "absolute top-2 right-2" : "ml-auto",
                  )}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Quiet footer count */}
      {!collapsed && stats && stats.totalJobs > 0 && (
        <div className="mx-5 mb-4 flex items-center gap-2 text-[11px] text-text-faint">
          <Film className="size-3.5" strokeWidth={1.75} />
          <span className="tabular">
            {stats.completedJobs} of {stats.totalJobs} rendered
          </span>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex items-center justify-center border-t border-sidebar-border py-3 text-text-faint transition-colors hover:text-foreground",
          collapsed ? "px-0" : "px-5",
        )}
      >
        {collapsed ? (
          <PanelLeft className="size-4" strokeWidth={1.75} />
        ) : (
          <div className="flex w-full items-center gap-2">
            <PanelLeftClose className="size-4" strokeWidth={1.75} />
            <span className="text-xs">Collapse</span>
          </div>
        )}
      </button>
    </aside>
  );
}
