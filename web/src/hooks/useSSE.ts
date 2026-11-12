import { useCallback, useEffect, useRef } from "react";
import { withApiKey } from "@/lib/apiKey";

interface SSEEvent {
  event: string;
  data: unknown;
}

export function useSSE(jobId: string | undefined, onEvent: (event: SSEEvent) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  const doneRef = useRef(false);
  const unmountedRef = useRef(false);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (!jobId || doneRef.current) return;

    const es = new EventSource(withApiKey(`/api/v1/jobs/${jobId}/events`));
    eventSourceRef.current = es;

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        onEventRef.current({ event: e.type, data });

        // Stop reconnecting once the job is terminal
        if (e.type === "job:completed" || e.type === "job:failed" || e.type === "job:cancelled") {
          doneRef.current = true;
          es.close();
        }
      } catch {}
    };

    const eventTypes = [
      "stage:research",
      "stage:director",
      "stage:tts",
      "stage:visuals",
      "stage:assembly",
      "stage:critic",
      "job:snapshot",
      "job:completed",
      "job:failed",
      "job:cancelled",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, handleEvent);
    }

    es.onerror = () => {
      es.close();
      if (!doneRef.current && !unmountedRef.current) {
        setTimeout(connect, 2000);
      }
    };

    return () => {
      es.close();
    };
  }, [jobId]);

  useEffect(() => {
    doneRef.current = false;
    unmountedRef.current = false;
    const cleanup = connect();
    return () => {
      unmountedRef.current = true;
      cleanup?.();
      eventSourceRef.current?.close();
    };
  }, [connect]);
}
