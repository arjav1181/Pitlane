import { Clapperboard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearApiKey, loadApiKey, saveApiKey } from "@/lib/apiKey";

/**
 * The sign-in gate.
 *
 * When the server is configured with a key, nothing is reachable until one is
 * supplied. The app asks for it once, keeps it in this browser, and checks it
 * against the server before letting the rest of the app render.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "unlocked">("checking");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  const check = useCallback(async (candidate: string) => {
    try {
      const res = await fetch("/api/v1/stats", {
        headers: candidate ? { "X-API-Key": candidate } : {},
      });
      // Only a clean 200 counts. A proxy error or an unknown route must not
      // read as "unlocked" and leave the app showing empty screens.
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/health");
        const health = (await res.json()) as { apiKeyRequired?: boolean };
        if (!active) return;

        if (!health.apiKeyRequired) {
          setState("unlocked");
          return;
        }

        const stored = loadApiKey();
        if (stored && (await check(stored))) {
          setState("unlocked");
          return;
        }
        if (stored) clearApiKey();
        setState("locked");
      } catch {
        if (active) setState("locked");
      }
    })();
    return () => {
      active = false;
    };
  }, [check]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = key.trim();
    if (!candidate) return;
    setError("");
    if (!(await check(candidate))) {
      setError("That key was not accepted.");
      return;
    }
    saveApiKey(candidate);
    setState("unlocked");
  };

  if (state === "unlocked") return <>{children}</>;

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="text-[13px] text-text-faint">Checking access</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-[368px] overflow-hidden rounded-xl border border-border bg-card">
        {/* The tally light is on: this bay is live and it is private. */}
        <div className="h-[2px] w-full bg-tally" />

        <form onSubmit={unlock} className="p-6">
          <div className="flex items-center gap-2.5">
            <Clapperboard className="size-[18px] text-tally" strokeWidth={1.75} />
            <span className="text-[15px] font-medium tracking-tight text-foreground">Pitlane</span>
          </div>

          <h1 className="mt-5 text-[15px] font-medium text-foreground">Private render bay</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-text-subtle">
            Enter the server key to continue.
          </p>

          <label htmlFor="server-key" className="mt-5 mb-1.5 block text-xs text-text-subtle">
            Server key
          </label>
          <Input
            id="server-key"
            type="password"
            autoComplete="current-password"
            autoFocus
            className="h-9 w-full rounded-md text-sm"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (error) setError("");
            }}
            placeholder="Paste the key"
            aria-invalid={error ? true : undefined}
          />

          {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}

          <Button
            type="submit"
            className="mt-5 h-9 w-full disabled:bg-muted disabled:text-text-faint disabled:opacity-100"
            disabled={!key.trim()}
          >
            Unlock
          </Button>

          <p className="mt-4 text-[11px] leading-relaxed text-text-faint">
            The key stays in this browser and is sent only to this server.
          </p>
        </form>
      </div>
    </div>
  );
}
