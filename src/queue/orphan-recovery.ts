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
 */
export function selectOrphanedJobs(
  candidates: OrphanCandidate[],
  isFinalised: (id: string) => boolean,
): OrphanedJob[] {
  const orphans: OrphanedJob[] = [];
  for (const candidate of candidates) {
    if (!candidate.id) continue;
    if (!isOrphaned(candidate)) continue;
    if (isFinalised(candidate.id)) continue;
    orphans.push({
      id: candidate.id,
      reason: "Job was orphaned by a server restart and never finished.",
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
