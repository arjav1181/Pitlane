import * as fs from "node:fs";
import * as path from "node:path";

export interface IdempotencyRecord {
  key: string;
  jobId: string;
  createdAt: string;
}

export type IdempotencyReservation =
  | { reserved: true; record: IdempotencyRecord }
  | { reserved: false; record: IdempotencyRecord };

export interface IdempotencyStore {
  /** Look up a key. Records whose job directory no longer exists are pruned. */
  get(key: string): IdempotencyRecord | null;
  /** Atomically reserve a key for a job. Returns the existing record on conflict. */
  reserve(key: string, jobId: string): IdempotencyReservation;
  /** Remove a key (used when enqueueing fails). */
  release(key: string): void;
  /** Remove every key that points at a deleted job. */
  removeJob(jobId: string): void;
  /** All live records, for diagnostics. */
  list(): IdempotencyRecord[];
}

interface IdempotencyFile {
  version: 1;
  records: Record<string, IdempotencyRecord>;
}

const FILE_NAME = ".idempotency.json";

/**
 * A reservation is written before the job directory exists. Only prune records
 * whose job directory has been missing for longer than this grace period, so an
 * in-flight reservation is never mistaken for a stale one.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

function emptyFile(): IdempotencyFile {
  return { version: 1, records: {} };
}

function isRecord(value: unknown): value is IdempotencyRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["key"] === "string" &&
    typeof record["jobId"] === "string" &&
    typeof record["createdAt"] === "string"
  );
}

function readFile(file: string): IdempotencyFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object") return emptyFile();
    const records = (parsed as { records?: unknown }).records;
    if (!records || typeof records !== "object") return emptyFile();
    const clean: Record<string, IdempotencyRecord> = {};
    for (const [key, value] of Object.entries(records as Record<string, unknown>)) {
      if (isRecord(value) && value.key === key) clean[key] = value;
    }
    return { version: 1, records: clean };
  } catch {
    // Missing or corrupt files are treated as empty. Never crash the API.
    return emptyFile();
  }
}

function writeFile(file: string, data: IdempotencyFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * File-backed idempotency-key store.
 *
 * The API server is a single process, so synchronous read-modify-write is
 * atomic enough for reserve(). Writes use tmp+rename so a crash cannot leave
 * a truncated JSON file behind.
 */
export function createIdempotencyStore(jobsDir: string): IdempotencyStore {
  const file = path.join(jobsDir, FILE_NAME);

  function isStale(record: IdempotencyRecord): boolean {
    if (fs.existsSync(path.join(jobsDir, record.jobId))) return false;
    const createdAt = Date.parse(record.createdAt);
    if (Number.isNaN(createdAt)) return true;
    return Date.now() - createdAt > STALE_AFTER_MS;
  }

  function pruneStale(data: IdempotencyFile, keepKey?: string): boolean {
    let changed = false;
    for (const [key, record] of Object.entries(data.records)) {
      if (key === keepKey) continue;
      if (isStale(record)) {
        delete data.records[key];
        changed = true;
      }
    }
    return changed;
  }

  return {
    get(key) {
      const data = readFile(file);
      const record = data.records[key];
      if (!record) return null;
      if (isStale(record)) {
        delete data.records[key];
        writeFile(file, data);
        return null;
      }
      return record;
    },

    reserve(key, jobId) {
      const data = readFile(file);
      const existing = data.records[key];
      if (existing && !isStale(existing)) {
        return { reserved: false, record: existing };
      }

      const record: IdempotencyRecord = {
        key,
        jobId,
        createdAt: new Date().toISOString(),
      };
      data.records[key] = record;
      pruneStale(data, key);
      writeFile(file, data);
      return { reserved: true, record };
    },

    release(key) {
      const data = readFile(file);
      if (!data.records[key]) return;
      delete data.records[key];
      writeFile(file, data);
    },

    removeJob(jobId) {
      const data = readFile(file);
      let changed = false;
      for (const [key, record] of Object.entries(data.records)) {
        if (record.jobId === jobId) {
          delete data.records[key];
          changed = true;
        }
      }
      if (changed) writeFile(file, data);
    },

    list() {
      const data = readFile(file);
      if (pruneStale(data)) writeFile(file, data);
      return Object.values(data.records);
    },
  };
}
