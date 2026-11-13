import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard for the research stage.
 *
 * The product researches. A caller may hand over a fact that was already
 * verified upstream, and that fact is passed into the research brief, but the
 * stage still searches: a script grounded in one fact is a script that can
 * only say one thing. Replay mode is the only thing that skips it.
 */
const orchestratorSource = readFileSync(
  new URL("./orchestrator.ts", import.meta.url),
  "utf8",
);

describe("research stage", () => {
  it("runs research even when the caller supplied a direction", () => {
    expect(orchestratorSource).toContain("await research(opts.llm, inputData.topic, opts.direction)");
    expect(orchestratorSource).not.toContain("Topic supplied directly");
  });

  it("passes the verified fact into the research brief", () => {
    const researchSource = readFileSync(
      new URL("../agents/research.ts", import.meta.url),
      "utf8",
    );
    expect(researchSource).toContain("already been verified");
  });

  it("still skips research in replay mode", () => {
    expect(orchestratorSource).toContain("Replaying from saved score");
    expect(orchestratorSource).toContain('cb.onStageSkip?.("research"');
  });
});
