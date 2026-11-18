import type { Queue } from "bullmq";

/**
 * Recovery for jobs orphaned by a server restart.
 *
 * The worker holds a job's lock for ten minutes at a time, because a Remotion
 * render can take much longer than the BullMQ default. When the container is
 * replaced mid-render - a Space restart, a rebuild, a deploy - the job stays
 * in the queue's active set until its lock expires. With a concurrency of one
 * it blocks every other job in the meantime, and the API keeps reporting it
 * as "running" the whole time.
 *
 * BullMQ eventually notices the missing lock and re-runs the job, which
 * burns the slot again for the full pipeline duration. Instead, a job whose
 * lock is gone belonged to a worker that no longer exists: fail it, free the
 * slot, and let the caller retry it if it still wants to.
 *
 * The check matches BullMQ's own: the lock is a Redis key with the lock
 * duration as its TTL, so a missing lock key means the worker is gone.
 */

/** The parts of a BullMQ job this needs. */
export interface OrphanCandidate {
  id: string;
  /** Whether the job's lock key still exists. */
  locked: boolean;
}

/**
 * True when the job is no longer held by a worker.
 *
 * A live worker renews its lock key, so a missing key means the process that
 * owned the job is gone.
 */
export function isOrphaned(job: OrphanCandidate): boolean {
  return !job.locked;
}

/** A job that no longer has a worker to finish it. */
export interface OrphanedJob {
  id: string;
  reason: string;
}

/**
 * Pick the jobs that should be failed out of the queue's active set.
 *
 * Jobs the API has already finalised are skipped - their metadata is
 * settled, only the queue entry is stale.
 *
 * `force` treats every active job as orphaned. That is right right after a
 * restart: the worker that owned those locks died with the previous
 * container, and the lock key survives for up to the lock duration, so
 * waiting for it to expire would idle the only worker slot for minutes.
 */
export function selectOrphanedJobs(
  candidates: OrphanCandidate[],
  isFinalised: (id: string) => boolean,
  force = false,
): OrphanedJob[] {
  const orphans: OrphanedJob[] = [];
  for (const candidate of candidates) {
    if (!candidate.id) continue;
    if (!force && !isOrphaned(candidate)) continue;
    if (isFinalised(candidate.id)) continue;
    orphans.push({
      id: candidate.id,
      reason: force
        ? "Job was interrupted by a server restart and never finished."
        : "Job was orphaned by a server restart and never finished.",
    });
  }
  return orphans;
}

/**
 * Drop a job from the queue.
 *
 * `job.remove()` refuses to touch a job the queue still considers locked, and
 * an orphaned job keeps its stale lock field. So the queue entry is removed
 * directly: the id comes off the active list and the job hash goes away.
 */
export async function removeFromQueue(
  queue: Queue,
  redis: {
    lrem(key: string, count: number, element: string): Promise<number>;
    del(...keys: string[]): Promise<number>;
  },
  jobId: string,
): Promise<void> {
  try {
    await queue.remove(jobId);
    return;
  } catch {
    // The queue still reports the job as locked, which is exactly the stale
    // state this function exists to clean up.
  }
  await redis.lrem(queue.toKey("active"), 0, jobId);
  await redis.del(queue.toKey(jobId));
}

/**
 * List the jobs the queue currently believes are active, and whether each one
 * is still locked by a live worker.
 */
export async function listActiveJobs(
  queue: Queue,
  redis: { exists(...keys: string[]): Promise<number> },
): Promise<OrphanCandidate[]> {
  const jobs = await queue.getJobs(["active"], 0, 100);
  const candidates: OrphanCandidate[] = [];
  for (const job of jobs) {
    if (!job.id) continue;
    const lockExists = await redis.exists(`${queue.toKey(job.id)}:lock`);
    candidates.push({ id: job.id, locked: lockExists > 0 });
  }
  return candidates;
}

/** One entry in the queue, whatever list it is currently sitting in. */
export interface QueueEntry {
  id: string;
  state: "active" | "waiting" | "delayed";
  /** Active and still held by a worker that is alive. */
  locked: boolean;
  /** The metadata says the job already finished, one way or another. */
  finalised: boolean;
  /** The metadata proves a stage ran, so this is not a request that never started. */
  started: boolean;
}

/**
 * What to do with the queue on a recovery tick.
 *
 * The subtle case is a restart in the middle of a render. BullMQ moves the
 * stalled job out of `active` and back to `wait`, so a sweep that only reads
 * the active list sees nothing to clean up and the job is re-run from the
 * first stage - or, worse, its metadata sits at "assembly: running" forever
 * while no worker owns it. So the sweep reads every list:
 *
 * - a finished job is removed from the queue, because re-running it would
 *   overwrite a render that has already been published;
 * - a waiting job that visibly began a stage was interrupted by a restart and
 *   is failed, not re-run;
 * - a waiting job with no stage progress is a real queued request and is left
 *   alone;
 * - an unlocked active job is already covered by the orphan rule.
 */
export function planQueueSweep(entries: QueueEntry[]): {
  remove: string[];
  fail: OrphanedJob[];
} {
  const remove: string[] = [];
  const fail: OrphanedJob[] = [];

  for (const entry of entries) {
    if (!entry.id) continue;
    if (entry.finalised) {
      remove.push(entry.id);
      continue;
    }
    if (entry.state === "active" && !entry.locked) {
      fail.push({
        id: entry.id,
        reason: "Job was orphaned by a server restart and never finished.",
      });
      continue;
    }
    if (entry.state !== "active" && entry.started) {
      fail.push({
        id: entry.id,
        reason: "Job was interrupted by a server restart and never finished.",
      });
    }
  }

  return { remove, fail };
}

/** Read every list the queue keeps, with the facts the sweep needs. */
export async function listQueueEntries(
  queue: Queue,
  redis: { exists(...keys: string[]): Promise<number> },
  hasStarted: (id: string) => boolean,
  isFinalised: (id: string) => boolean,
): Promise<QueueEntry[]> {
  const entries: QueueEntry[] = [];
  const states: QueueEntry["state"][] = ["active", "waiting", "delayed"];

  for (const state of states) {
    const jobs = await queue.getJobs([state], 0, 100);
    for (const job of jobs) {
      if (!job.id) continue;
      const lockExists =
        state === "active" ? await redis.exists(`${queue.toKey(job.id)}:lock`) : 0;
      entries.push({
        id: job.id,
        state,
        locked: lockExists > 0,
        finalised: isFinalised(job.id),
        started: hasStarted(job.id),
      });
    }
  }

  return entries;
}
