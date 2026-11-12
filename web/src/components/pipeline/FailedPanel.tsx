import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface FailedPanelProps {
  failedStageName: string;
  failedDetail: string | null;
}

export function FailedPanel({ failedStageName, failedDetail }: FailedPanelProps) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="size-4 text-destructive" strokeWidth={1.75} />
        <h2 className="text-[15px] font-medium text-foreground">
          Stopped at {failedStageName}
        </h2>
      </div>

      {failedDetail && (
        <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3">
          <code className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-destructive">
            {failedDetail}
          </code>
        </div>
      )}

      <div className="mt-5">
        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
          Start over
        </Button>
      </div>
    </div>
  );
}
