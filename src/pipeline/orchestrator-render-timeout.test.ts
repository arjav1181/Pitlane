import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the delayRender timeout bug.
 *
 * The renderer is driven programmatically. `@remotion/cli/config` is only
 * read by the Remotion CLI, which forwards its own
 * `--delay-render-timeout-in-milliseconds` flag to the renderer. A
 * programmatic `renderMedia` call ignores that config entirely and keeps the
 * renderer's 30s default — which it reports to the browser as a 28s
 * delayRender budget. On a CPU-only machine that killed the assembly stage
 * with:
 *
 *   A delayRender() "Fetching ... from server" was called but not cleared
 *   after 28000ms.
 *
 * These assertions fail if the timeout stops reaching the renderer, or if the
 * ineffective CLI-config call comes back.
 */

const orchestratorSource = readFileSync(
  new URL("./orchestrator.ts", import.meta.url),
  "utf8",
);

/** Strip comments so prose about the CLI config does not trip the assertions. */
const orchestratorCode = orchestratorSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("assembly render timeout", () => {
  it("passes timeoutInMilliseconds to renderMedia", () => {
    expect(orchestratorCode).toMatch(/renderMedia\(\{[\s\S]*?timeoutInMilliseconds:/);
  });

  it("passes timeoutInMilliseconds to selectComposition", () => {
    expect(orchestratorCode).toMatch(
      /selectComposition\(\{[\s\S]*?timeoutInMilliseconds:/,
    );
  });

  it("does not rely on the Remotion CLI config, which the renderer ignores", () => {
    expect(orchestratorCode).not.toContain("setDelayRenderTimeoutInMilliseconds");
    expect(orchestratorCode).not.toContain("@remotion/cli/config");
  });

  it("resolves the render options through the shared helper", () => {
    expect(orchestratorCode).toContain("resolveRenderOptions(");
  });
});
