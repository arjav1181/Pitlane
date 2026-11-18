import { describe, expect, it, vi } from "vitest";
import {
  findStaleLocalJobs,
  isOrphaned,
  planQueueSweep,
  selectOrphanedJobs,
  removeFromQueue,
} from "./orphan-recovery.js";

describe("isOrphaned", () => {
  it("treats a job whose lock is gone as orphaned", () => {
    expect(isOrphaned({ id: "a", locked: false })).toBe(true);
  });

  it("leaves a job with a live lock alone", () => {
    expect(isOrphaned({ id: "a", locked: true })).toBe(false);
  });
});

describe("selectOrphanedJobs", () => {
  it("fails only the jobs whose lock is gone", () => {
    const orphans = selectOrphanedJobs(
      [
        { id: "live", locked: true },
        { id: "dead", locked: false },
      ],
      () => false,
    );
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.id).toBe("dead");
    expect(orphans[0]?.reason).toMatch(/orphaned/i);
  });

  it("skips jobs the API has already finalised", () => {
    const orphans = selectOrphanedJobs([{ id: "done", locked: false }], (id) => id === "done");
    expect(orphans).toHaveLength(0);
  });

  it("ignores entries without an id", () => {
    const orphans = selectOrphanedJobs([{ id: "", locked: false }], () => false);
    expect(orphans).toHaveLength(0);
  });

  it("treats every active job as orphaned when forced", () => {
    const orphans = selectOrphanedJobs(
      [
        { id: "live", locked: true },
        { id: "dead", locked: false },
      ],
      () => false,
      true,
    );
    expect(orphans.map((o) => o.id)).toEqual(["live", "dead"]);
    expect(orphans[0]?.reason).toMatch(/interrupted/i);
  });

  it("still skips finalised jobs when forced", () => {
    const orphans = selectOrphanedJobs([{ id: "done", locked: true }], () => true, true);
    expect(orphans).toHaveLength(0);
  });
});

describe("removeFromQueue", () => {
  it("removes the job through the queue when it is not locked", async () => {
    const queue = {
      remove: vi.fn().mockResolvedValue(undefined),
      toKey: (key: string) => `bull:openreels:${key}`,
    };
    const redis = { lrem: vi.fn(), del: vi.fn() };
    await removeFromQueue(queue as never, redis as never, "job-1");
    expect(queue.remove).toHaveBeenCalledWith("job-1");
    expect(redis.lrem).not.toHaveBeenCalled();
  });

  it("clears the stale lock and the queue entry when the queue refuses", async () => {
    const queue = {
      remove: vi.fn().mockRejectedValue(new Error("Job job-1 is locked by another worker")),
      toKey: (key: string) => `bull:openreels:${key}`,
    };
    const redis = { lrem: vi.fn().mockResolvedValue(1), del: vi.fn().mockResolvedValue(1) };
    await removeFromQueue(queue as never, redis as never, "job-1");
    expect(redis.lrem).toHaveBeenCalledWith("bull:openreels:active", 0, "job-1");
    expect(redis.del).toHaveBeenCalledWith("bull:openreels:job-1");
  });
});

describe("findStaleLocalJobs", () => {
  it("fails a running job that has no queue entry", () => {
    const result = findStaleLocalJobs(
      [
        { id: "stuck", status: "running" },
        { id: "waiting", status: "queued" },
        { id: "done", status: "completed" },
      ],
      new Set(["waiting"]),
    );
    expect(result.map((job) => job.id)).toEqual(["stuck"]);
    expect(result[0]!.reason).toContain("Retry it");
  });

  it("leaves every in-flight job alone when the queue still owns it", () => {
    expect(
      findStaleLocalJobs(
        [{ id: "a", status: "running" }, { id: "b", status: "queued" }],
        new Set(["a", "b"]),
      ),
    ).toEqual([]);
  });
});

describe("planQueueSweep", () => {
  const entry = (over: Partial<Parameters<typeof planQueueSweep>[0][number]>) => ({
    id: "job",
    state: "waiting" as const,
    locked: false,
    finalised: false,
    started: false,
    ...over,
  });

  it("drops a finished job instead of letting the queue re-run it", () => {
    const sweep = planQueueSweep([entry({ id: "done", state: "active", locked: true, finalised: true })]);
    expect(sweep.remove).toEqual(["done"]);
    expect(sweep.fail).toEqual([]);
  });

  it("fails a waiting job that had already begun a stage", () => {
    const sweep = planQueueSweep([entry({ id: "half", started: true })]);
    expect(sweep.fail.map((j) => j.id)).toEqual(["half"]);
    expect(sweep.remove).toEqual([]);
  });

  it("leaves a queued request that never started alone", () => {
    const sweep = planQueueSweep([entry({ id: "queued" })]);
    expect(sweep.fail).toEqual([]);
    expect(sweep.remove).toEqual([]);
  });

  it("leaves the job this worker is holding alone", () => {
    const sweep = planQueueSweep([
      entry({ id: "live", state: "active", locked: true, started: true }),
    ]);
    expect(sweep.fail).toEqual([]);
  });

  it("fails a queue-completed job whose metadata still says running", () => {
    const sweep = planQueueSweep([entry({ id: "stale", state: "completed", started: true })]);
    expect(sweep.fail.map((j) => j.id)).toEqual(["stale"]);
  });

  it("removes a finished job before its queue state is considered", () => {
    const sweep = planQueueSweep([
      entry({ id: "done", state: "completed", finalised: true, started: true }),
    ]);
    expect(sweep.remove).toEqual(["done"]);
    expect(sweep.fail).toEqual([]);
  });

  it("fails an active job whose worker is gone", () => {
    const sweep = planQueueSweep([
      entry({ id: "dead", state: "active", locked: false, started: true }),
    ]);
    expect(sweep.fail[0]?.reason).toContain("orphaned");
  });
});
