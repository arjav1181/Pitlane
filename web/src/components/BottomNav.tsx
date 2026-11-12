import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { PlusCircle, LayoutGrid, Settings } from "lucide-react";
import type { StatsResponse } from "@/hooks/useApi";

const NAV_ITEMS = [
  { path: "/", label: "New", icon: PlusCircle },
  { path: "/gallery", label: "Gallery", icon: LayoutGrid },
  { path: "/settings", label: "Settings", icon: Settings },
];

interface BottomNavProps {
  stats: StatsResponse | null;
}

export function BottomNav({ stats }: BottomNavProps) {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/")
      return location.pathname === "/" || location.pathname.startsWith("/jobs");
    return location.pathname.startsWith(path);
  };

  const live = (stats?.activeJobs ?? 0) > 0;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-sidebar-border bg-sidebar">
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "relative flex flex-col items-center gap-1 px-4 py-1.5",
              active ? "text-foreground" : "text-text-faint hover:text-foreground",
            )}
          >
            <item.icon className="size-5" strokeWidth={1.75} />
            <span className="text-[11px]">{item.label}</span>
            {item.path === "/" && live && (
              <span className="absolute top-1 right-2 size-1.5 rounded-full bg-tally" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
