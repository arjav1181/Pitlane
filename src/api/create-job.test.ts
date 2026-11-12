import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Queue } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobFromBody, retryJob } from "./create-job.js";
import { createIdempotencyStore } from "./idempotency.js";
import { readJobMeta, writeJobMeta } from "./jobs.js";

let jobsDir: string;

interface TestContext {
  queue: Queue;
  jobsDir: string;
  idempotency: ReturnType<typeof createIdempotencyStore>;
  allowPrivateCallbacks: boolean;
  add: ReturnType<typeof vi.fn>;
}

function makeContext(allowPrivateCallbacks = false): TestContext {
  const add = vi.fn(async () => ({}));
  return {
    queue: { add } as unknown as Queue,
    jobsDir,
    idempotency: createIdempotencyStore(jobsDir),
    allowPrivateCallbacks,
    add,
  };
}

function bodyOf(result: { body: unknown }): Record<string, unknown> {
  return result.body as Record<string, unknown>;
}

const minimalScore = {
  emotional_arc: "curiosity-to-wisdom",
  archetype: "editorial_caricature",
  music_mood: "epic_cinematic",
  scenes: [
    {
      visual_type: "text_card",
      visual_prompt: "Title",
      motion: "static",
      script_line: "One.",
      transition: null,
    },
    {
      visual_type: "ai_image",
      visual_prompt: "Image",
      motion: "zoom_in",
      script_line: "Two.",
      transition: null,
    },
    {
      visual_type: "stock_video",
      visual_prompt: "Video",
      motion: "static",
      script_line: "Three.",
      transition: null,
    },
  ],
};

beforeEach(() => {
  jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openreels-create-job-"));
});

afterEach(() => {
  fs.rmSync(jobsDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("createJobFromBody", () => {
  it("queues a job and writes a public placeholder", async () => {
    const ctx = makeContext();
    const result = await createJobFromBody(
      {
        topic: "  The history of coffee  ",
        archetype: "editorial_caricature",
        pacing: "moderate",
        platform: "youtube",
        noAiAssets: true,
        metadata: { customer: "acme" },
      },
      undefined,
      ctx,
    );

    expect(result.status).toBe(201);
    const job = bodyOf(result);
    expect(job["topic"]).toBe("The history of coffee");
    expect(job["status"]).toBe("queued");
    expect(job["noAiAssets"]).toBe(true);
    expect(job["metadata"]).toEqual({ customer: "acme" });
    expect(job["links"]).toMatchObject({ self: `/api/v1/jobs/${job["id"]}` });
    expect(result.headers?.["Location"]).toBe(`/api/v1/jobs/${job["id"]}`);

    expect(ctx.add).toHaveBeenCalledTimes(1);
    const [name, data, options] = ctx.add.mock.calls[0]!;
    expect(name).toBe("render");
    expect((data as { topic: string }).topic).toBe("The history of coffee");
    expect(options).toMatchObject({ jobId: job["id"] });

    const meta = readJobMeta(jobsDir, job["id"] as string);
    expect(meta?.request?.providers.llm).toBe("anthropic");
    expect(meta?.request?.noAiAssets).toBe(true);
  });

  it("applies the OPENREELS_NO_AI_ASSETS server policy", async () => {
    vi.stubEnv("OPENREELS_NO_AI_ASSETS", "true");
    const ctx = makeContext();
    const result = await createJobFromBody({ topic: "Policy", noAiAssets: false }, undefined, ctx);
    expect(result.status).toBe(201);
    expect(bodyOf(result)["noAiAssets"]).toBe(true);
    const [, data] = ctx.add.mock.calls[0]!;
    expect((data as { noAiAssets: boolean }).noAiAssets).toBe(true);
  });

  it("never writes provider keys or webhook secrets to meta.json", async () => {
    const ctx = makeContext();
    const result = await createJobFromBody(
      {
        topic: "Secret handling",
        keys: { ANTHROPIC_API_KEY: "sk-ant-secret" },
        callbackUrl: "https://example.com/hook",
        callbackSecret: "webhook-secret",
      },
      undefined,
      ctx,
    );

    expect(result.status).toBe(201);
    const id = bodyOf(result)["id"] as string;
    const raw = fs.readFileSync(path.join(jobsDir, id, "meta.json"), "utf-8");
    expect(raw).not.toContain("sk-ant-secret");
    expect(raw).not.toContain("webhook-secret");
    expect(raw).not.toContain("callbackUrl");

    const [, data] = ctx.add.mock.calls[0]!;
    const payload = data as { keys: Record<string, string>; callbacks?: { secret?: string } };
    expect(payload.keys["ANTHROPIC_API_KEY"]).toBe("sk-ant-secret");
    expect(payload.callbacks?.secret).toBe("webhook-secret");
  });

  it("accepts a nested callback configuration", async () => {
    const ctx = makeContext();
    const result = await createJobFromBody(
      {
        topic: "Nested callback",
        callback: {
          url: "https://example.com/hook",
          secret: "s3cret",
          events: ["job.completed", "job.failed", "job.completed"],
        },
      },
      undefined,
      ctx,
    );

    expect(result.status).toBe(201);
    const [, data] = ctx.add.mock.calls[0]!;
    expect((data as { callbacks?: unknown }).callbacks).toEqual({
      url: "https://example.com/hook",
      secret: "s3cret",
      events: ["job.completed", "job.failed"],
    });
  });

  it("accepts a valid replay score", async () => {
    const ctx = makeContext();
    const result = await createJobFromBody(
      { topic: "Replay", score: minimalScore },
      undefined,
      ctx,
    );

    expect(result.status).toBe(201);
    const [, data] = ctx.add.mock.calls[0]!;
    expect((data as { score?: { scenes: unknown[] } }).score?.scenes).toHaveLength(3);
  });

  describe("request validation", () => {
    it("rejects a non-object body", async () => {
      const ctx = makeContext();
      for (const body of [null, [], "topic", 42]) {
        const result = await createJobFromBody(body, undefined, ctx);
        expect(result.status).toBe(400);
        expect(bodyOf(result)["error"]).toMatch(/JSON object/);
      }
      expect(ctx.add).not.toHaveBeenCalled();
    });

    it("requires a non-empty topic", async () => {
      const ctx = makeContext();
      expect((await createJobFromBody({}, undefined, ctx)).status).toBe(400);
      expect((await createJobFromBody({ topic: "   " }, undefined, ctx)).status).toBe(400);
      expect((await createJobFromBody({ topic: 7 }, undefined, ctx)).status).toBe(400);
      expect((await createJobFromBody({ topic: "a".repeat(501) }, undefined, ctx)).status).toBe(
        400,
      );
    });

    it("rejects unknown archetypes, pacing tiers, and platforms", async () => {
      const ctx = makeContext();
      expect(
        (await createJobFromBody({ topic: "x", archetype: "not-real" }, undefined, ctx)).status,
      ).toBe(400);
      expect(
        (await createJobFromBody({ topic: "x", pacing: "warp-speed" }, undefined, ctx)).status,
      ).toBe(400);
      expect(
        (await createJobFromBody({ topic: "x", platform: "myspace" }, undefined, ctx)).status,
      ).toBe(400);
    });

    it("rejects non-boolean flags", async () => {
      const ctx = makeContext();
      for (const flag of ["dryRun", "noMusic", "noVideo", "noAiAssets"]) {
        const result = await createJobFromBody({ topic: "x", [flag]: "true" }, undefined, ctx);
        expect(result.status).toBe(400);
        expect(bodyOf(result)["error"]).toContain(flag);
      }
    });

    it("enforces the direction size limit", async () => {
      const ctx = makeContext();
      const result = await createJobFromBody(
        { topic: "x", direction: "a".repeat(10 * 1024 + 1) },
        undefined,
        ctx,
      );
      expect(result.status).toBe(400);
      expect(bodyOf(result)["error"]).toMatch(/10KB/);
    });

    it("enforces metadata shape and size", async () => {
      const ctx = makeContext();
      expect((await createJobFromBody({ topic: "x", metadata: [] }, undefined, ctx)).status).toBe(
        400,
      );
      const big = await createJobFromBody(
        { topic: "x", metadata: { blob: "a".repeat(8193) } },
        undefined,
        ctx,
      );
      expect(big.status).toBe(400);
      expect(bodyOf(big)["error"]).toMatch(/8192 bytes/);
    });

    it("validates key names and values", async () => {
      const ctx = makeContext();
      expect(
        (await createJobFromBody({ topic: "x", keys: { lower: "v" } }, undefined, ctx)).status,
      ).toBe(400);
      expect(
        (await createJobFromBody({ topic: "x", keys: { OK: 1 } }, undefined, ctx)).status,
      ).toBe(400);
      expect((await createJobFromBody({ topic: "x", keys: ["nope"] }, undefined, ctx)).status).toBe(
        400,
      );
    });

    it("validates llmAuthType and openai-compatible configuration", async () => {
      const ctx = makeContext();
      expect(
        (
          await createJobFromBody(
            { topic: "x", providers: { llmAuthType: "magic" } },
            undefined,
            ctx,
          )
        ).status,
      ).toBe(400);

      vi.stubEnv("OPENREELS_LLM_BASE_URL", "");
      vi.stubEnv("OPENREELS_LLM_MODEL", "");
      const missing = await createJobFromBody(
        { topic: "x", providers: { llm: "openai-compatible" } },
        undefined,
        ctx,
      );
      expect(missing.status).toBe(400);
      expect(bodyOf(missing)["error"]).toMatch(/llmBaseUrl/);

      const customHeader = await createJobFromBody(
        {
          topic: "x",
          providers: {
            llm: "openai-compatible",
            llmBaseUrl: "http://localhost:11434/v1",
            llmModel: "llama3.2",
            llmAuthType: "custom-header",
          },
        },
        undefined,
        ctx,
      );
      expect(customHeader.status).toBe(400);
      expect(bodyOf(customHeader)["error"]).toMatch(/llmAuthHeader/);
    });

    it("rejects an invalid DirectorScore", async () => {
      const ctx = makeContext();
      const invalid = await createJobFromBody(
        { topic: "x", score: { ...minimalScore, scenes: minimalScore.scenes.slice(0, 1) } },
        undefined,
        ctx,
      );
      expect(invalid.status).toBe(400);
      expect(bodyOf(invalid)["error"]).toMatch(/Invalid DirectorScore/);

      const unknownArchetype = await createJobFromBody(
        { topic: "x", score: { ...minimalScore, archetype: "not-real" } },
        undefined,
        ctx,
      );
      expect(unknownArchetype.status).toBe(400);
      expect(bodyOf(unknownArchetype)["error"]).toMatch(/unknown archetype/);
    });

    it("validates webhook configuration", async () => {
      const ctx = makeContext();
      expect(
        (await createJobFromBody({ topic: "x", callbackSecret: "s" }, undefined, ctx)).status,
      ).toBe(400);
      expect(
        (
          await createJobFromBody(
            { topic: "x", callbackUrl: "https://example.com", callbackEvents: [] },
            undefined,
            ctx,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await createJobFromBody(
            { topic: "x", callbackUrl: "https://example.com", callbackEvents: ["nope"] },
            undefined,
            ctx,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await createJobFromBody(
            { topic: "x", callbackUrl: "http://127.0.0.1/hook" },
            undefined,
            ctx,
          )
        ).status,
      ).toBe(400);
      expect(
        (await createJobFromBody({ topic: "x", callbackUrl: "not a url" }, undefined, ctx)).status,
      ).toBe(400);
    });

    it("allows private callback targets when explicitly enabled", async () => {
      const ctx = makeContext(true);
      const result = await createJobFromBody(
        { topic: "x", callbackUrl: "http://127.0.0.1:9000/hook" },
        undefined,
        ctx,
      );
      expect(result.status).toBe(201);
    });
  });

  describe("idempotency", () => {
    it("rejects malformed keys", async () => {
      const ctx = makeContext();
      expect(
        (await createJobFromBody({ topic: "x", idempotencyKey: "a".repeat(256) }, undefined, ctx))
          .status,
      ).toBe(400);
      expect(
        (await createJobFromBody({ topic: "x", idempotencyKey: "has space" }, undefined, ctx))
          .status,
      ).toBe(400);
      expect((await createJobFromBody({ topic: "x" }, "has space", ctx)).status).toBe(400);
    });

    it("replays the existing job for a repeated key", async () => {
      const ctx = makeContext();
      const first = await createJobFromBody({ topic: "Idempotent" }, "key-1", ctx);
      const second = await createJobFromBody({ topic: "Different topic" }, "key-1", ctx);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(bodyOf(second)["id"]).toBe(bodyOf(first)["id"]);
      expect(second.headers?.["Idempotency-Replayed"]).toBe("true");
      expect(ctx.add).toHaveBeenCalledTimes(1);
    });

    it("prefers the header over the body key", async () => {
      const ctx = makeContext();
      const first = await createJobFromBody({ topic: "one" }, "header-key", ctx);
      const second = await createJobFromBody(
        { topic: "two", idempotencyKey: "body-key" },
        "header-key",
        ctx,
      );
      expect(second.status).toBe(200);
      expect(bodyOf(second)["id"]).toBe(bodyOf(first)["id"]);
    });

    it("releases the key when enqueueing fails", async () => {
      const ctx = makeContext();
      ctx.add.mockRejectedValueOnce(new Error("redis down"));
      const failed = await createJobFromBody({ topic: "x" }, "key-1", ctx);
      expect(failed.status).toBe(500);
      expect(ctx.idempotency.get("key-1")).toBeNull();

      const retried = await createJobFromBody({ topic: "x" }, "key-1", ctx);
      expect(retried.status).toBe(201);
    });
  });
});

describe("retryJob", () => {
  function writeMeta(
    id: string,
    meta: Partial<Parameters<typeof writeJobMeta>[2]> & {
      id: string;
      topic: string;
      status: string;
      createdAt: string;
      stages: Record<string, { status: string }>;
    },
  ) {
    writeJobMeta(jobsDir, id, meta);
  }

  const ctxWithData = (data: Record<string, unknown> | null, ctx = makeContext()) => ({
    ...ctx,
    getJobData: async () => data as never,
  });

  it("returns 404 for an unknown job", async () => {
    const result = await retryJob("missing", ctxWithData(null));
    expect(result.status).toBe(404);
  });

  it("refuses to retry a queued or running job", async () => {
    for (const status of ["queued", "running"]) {
      writeMeta("job-1", {
        id: "job-1",
        topic: "x",
        status,
        createdAt: new Date().toISOString(),
        stages: {},
      });
      const result = await retryJob("job-1", ctxWithData(null));
      expect(result.status).toBe(409);
    }
  });

  it("refuses when neither the queue payload nor the request snapshot exists", async () => {
    writeMeta("job-1", {
      id: "job-1",
      topic: "x",
      status: "failed",
      createdAt: new Date().toISOString(),
      stages: {},
    });
    const result = await retryJob("job-1", ctxWithData(null));
    expect(result.status).toBe(409);
    expect(bodyOf(result)["error"]).toMatch(/unavailable/);
  });

  it("re-enqueues from meta.request when the BullMQ payload is gone", async () => {
    writeMeta("job-1", {
      id: "job-1",
      topic: "Retry me",
      status: "failed",
      createdAt: new Date().toISOString(),
      archetype: "editorial_caricature",
      pacing: "standard",
      platform: "youtube",
      noAiAssets: true,
      metadata: { customer: "acme" },
      request: {
        providers: {
          llm: "openai",
          tts: "openai-tts",
          image: "openai",
          stock: "pexels",
          music: "bundled",
          llmAuthType: "none",
        },
        platform: "youtube",
        pacing: "moderate",
        dryRun: true,
      },
      stages: {},
    });

    const ctx = ctxWithData(null);
    const result = await retryJob("job-1", ctx);
    expect(result.status).toBe(201);
    const job = bodyOf(result);
    expect(job["retryOf"]).toBe("job-1");
    expect(job["noAiAssets"]).toBe(true);
    expect(job["metadata"]).toEqual({ customer: "acme" });

    const [, data] = ctx.add.mock.calls[0]!;
    const payload = data as {
      dryRun: boolean;
      noAiAssets: boolean;
      providers: { llm: string; llmAuthType: string };
    };
    expect(payload.dryRun).toBe(true);
    expect(payload.noAiAssets).toBe(true);
    expect(payload.providers.llm).toBe("openai");
    expect(payload.providers.llmAuthType).toBe("none");
  });

  it("reuses the original BullMQ payload when it is still available", async () => {
    writeMeta("job-1", {
      id: "job-1",
      topic: "Retry me",
      status: "completed",
      createdAt: new Date().toISOString(),
      stages: {},
    });

    const ctx = ctxWithData({
      topic: "Retry me",
      platform: "youtube",
      dryRun: false,
      noVideo: true,
      direction: "be bold",
      providers: { llm: "anthropic", tts: "elevenlabs", image: "gemini", stock: "pexels" },
      keys: { ANTHROPIC_API_KEY: "sk-ant" },
      jobsDir: "/tmp/wrong",
      callbacks: { url: "https://example.com/hook" },
    });

    const result = await retryJob("job-1", ctx);
    expect(result.status).toBe(201);
    const [, data] = ctx.add.mock.calls[0]!;
    const payload = data as {
      topic: string;
      noVideo: boolean;
      direction: string;
      keys: Record<string, string>;
      jobsDir: string;
      callbacks?: unknown;
    };
    expect(payload.topic).toBe("Retry me");
    expect(payload.noVideo).toBe(true);
    expect(payload.direction).toBe("be bold");
    expect(payload.keys["ANTHROPIC_API_KEY"]).toBe("sk-ant");
    expect(payload.jobsDir).toBe(jobsDir);
    expect(payload.callbacks).toEqual({ url: "https://example.com/hook" });
  });

  it("returns 500 when enqueueing fails", async () => {
    writeMeta("job-1", {
      id: "job-1",
      topic: "Retry me",
      status: "failed",
      createdAt: new Date().toISOString(),
      request: {
        providers: { llm: "anthropic", tts: "elevenlabs", image: "gemini", stock: "pexels" },
      },
      stages: {},
    });
    const ctx = ctxWithData(null);
    ctx.add.mockRejectedValueOnce(new Error("redis down"));
    const result = await retryJob("job-1", ctx);
    expect(result.status).toBe(500);
  });
});
