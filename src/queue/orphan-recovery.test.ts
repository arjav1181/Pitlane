import { describe, expect, it, vi } from "vitest";
import {
  isOrphaned,
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
