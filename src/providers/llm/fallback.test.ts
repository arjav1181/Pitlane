import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LLMProvider, LLMProviderKey, LLMUsage } from "../../schema/providers.js";
import { FallbackLLM } from "./fallback.js";

const schema = z.object({ value: z.string() });

class FakeLLM implements LLMProvider {
  readonly id: LLMProviderKey = "openai-compatible";
  calls = 0;

  constructor(
    private readonly behaviour:
      | { ok: string; usage?: LLMUsage }
      | { error: Error },
    private readonly delayMs = 0,
  ) {}

  async generate<T extends z.ZodType>(_opts: { systemPrompt: string; userMessage: string; schema: T }) {
    this.calls += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if ("error" in this.behaviour) throw this.behaviour.error;
    return {
      data: { value: this.behaviour.ok } as z.infer<T>,
      usage: this.behaviour.usage ?? { inputTokens: 10, outputTokens: 5 },
    };
  }
}

describe("FallbackLLM", () => {
  it("returns the first model's result without trying the fallback", async () => {
    const primary = new FakeLLM({ ok: "primary" });
    const backup = new FakeLLM({ ok: "backup" });
    const llm = new FallbackLLM([
      { provider: primary, label: "gateway/primary" },
      { provider: backup, label: "gateway/backup" },
    ]);

    const result = await llm.generate({ systemPrompt: "s", userMessage: "u", schema });

    expect(result.data).toEqual({ value: "primary" });
    expect(primary.calls).toBe(1);
    expect(backup.calls).toBe(0);
    expect(llm.labels).toEqual(["gateway/primary", "gateway/backup"]);
    expect(llm.id).toBe("openai-compatible");
  });

  it("moves to the next model when the primary fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = new FakeLLM({ error: new Error("502 Bad Gateway") });
    const backup = new FakeLLM({ ok: "backup", usage: { inputTokens: 7, outputTokens: 3 } });
    const llm = new FallbackLLM([primary, backup]);

    const result = await llm.generate({ systemPrompt: "s", userMessage: "u", schema });

    expect(result.data).toEqual({ value: "backup" });
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(primary.calls).toBe(1);
    expect(backup.calls).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("502 Bad Gateway"));
    warnSpy.mockRestore();
  });

  it("tries every model in order and reports all failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = new FakeLLM({ error: new Error("timeout") });
    const second = new FakeLLM({ error: new Error("schema mismatch") });
    const third = new FakeLLM({ error: new Error("rate limited") });
    const llm = new FallbackLLM([
      { provider: first, label: "first" },
      { provider: second, label: "second" },
      { provider: third, label: "third" },
    ]);

    await expect(
      llm.generate({ systemPrompt: "s", userMessage: "u", schema }),
    ).rejects.toThrow("All LLM models failed (first -> second -> third). Last error: rate limited");
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
    expect(third.calls).toBe(1);
    warnSpy.mockRestore();
  });

  it("stops immediately on cancellation", async () => {
    const cancel = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const primary = new FakeLLM({ error: cancel });
    const backup = new FakeLLM({ ok: "backup" });
    const llm = new FallbackLLM([primary, backup]);

    await expect(
      llm.generate({ systemPrompt: "s", userMessage: "u", schema }),
    ).rejects.toThrow("The operation was aborted");
    expect(backup.calls).toBe(0);
  });

  it("stops trying models once the budget is exhausted", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = new FakeLLM({ error: new Error("timeout") }, 20);
    const backup = new FakeLLM({ ok: "backup" });
    const llm = new FallbackLLM(
      [
        { provider: primary, label: "primary" },
        { provider: backup, label: "backup" },
      ],
      { budgetMs: 5 },
    );

    await expect(
      llm.generate({ systemPrompt: "s", userMessage: "u", schema }),
    ).rejects.toThrow("All LLM models failed (primary -> backup). Last error: timeout");
    expect(primary.calls).toBe(1);
    expect(backup.calls).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Budget of 5ms exhausted"));
    warnSpy.mockRestore();
  });

  it("requires at least one provider", () => {
    expect(() => new FallbackLLM([])).toThrow("at least one provider");
  });
});
