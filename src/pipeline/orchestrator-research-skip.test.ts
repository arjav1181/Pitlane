import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the research stage.
 *
 * When the caller supplies a direction - which is what the automation does:
 * the topic, the fact and its source are researched and verified upstream -
 * the pipeline must not run its own web research. That call is a redundant
 * LLM request that can stall the whole job on a gateway rate limit without
 * changing the result, because the director reads the direction directly.
 */
const orchestratorSource = readFileSync(
  new URL("./orchestrator.ts", import.meta.url),
  "utf8",
);

describe("research stage", () => {
  it("skips research when the caller supplied a direction", () => {
    expect(orchestratorSource).toMatch(
      /if \(opts\.direction\?\.trim\(\)\) \{[\s\S]{0,400}?onStageSkip\?\.\("research"/,
    );
  });

  it("still runs research when no direction was supplied", () => {
    // The live research call must remain, just behind the skip.
    expect(orchestratorSource).toContain("await research(opts.llm, inputData.topic)");
  });

  it("does not skip research in replay mode before the direction check", () => {
    const replay = orchestratorSource.indexOf("Replaying from saved score");
    const direction = orchestratorSource.indexOf("Topic supplied directly");
    expect(replay).toBeGreaterThan(-1);
    expect(direction).toBeGreaterThan(replay);
  });
});
