import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdempotencyStore } from "./idempotency.js";

let jobsDir: string;

function makeJobDir(id: string): void {
  fs.mkdirSync(path.join(jobsDir, id), { recursive: true });
}

/** Backdate every stored record so the stale-reservation grace period expires. */
function ageRecords(ageMs = 11 * 60 * 1000): void {
  const file = path.join(jobsDir, ".idempotency.json");
  const data = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    records: Record<string, { createdAt: string }>;
  };
  for (const record of Object.values(data.records)) {
    record.createdAt = new Date(Date.now() - ageMs).toISOString();
  }
  fs.writeFileSync(file, JSON.stringify(data));
}

beforeEach(() => {
  jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openreels-idempotency-"));
});

afterEach(() => {
  fs.rmSync(jobsDir, { recursive: true, force: true });
});

describe("createIdempotencyStore", () => {
  it("reserves a new key", () => {
    makeJobDir("job-1");
    const store = createIdempotencyStore(jobsDir);
    const result = store.reserve("key-1", "job-1");
    expect(result.reserved).toBe(true);
    expect(result.record).toMatchObject({ key: "key-1", jobId: "job-1" });
    expect(store.get("key-1")?.jobId).toBe("job-1");
  });

  it("returns the existing record when a key is already reserved", () => {
    makeJobDir("job-1");
    makeJobDir("job-2");
    const store = createIdempotencyStore(jobsDir);
    store.reserve("key-1", "job-1");

    const result = store.reserve("key-1", "job-2");
    expect(result.reserved).toBe(false);
    expect(result.record.jobId).toBe("job-1");
  });

  it("persists records across store instances", () => {
    makeJobDir("job-1");
    createIdempotencyStore(jobsDir).reserve("key-1", "job-1");
    expect(createIdempotencyStore(jobsDir).get("key-1")?.jobId).toBe("job-1");
  });

  it("keeps a fresh reservation before its job directory exists", () => {
    const store = createIdempotencyStore(jobsDir);
    expect(store.reserve("key-1", "job-1").reserved).toBe(true);
    expect(store.get("key-1")?.jobId).toBe("job-1");
    expect(store.list().map((record) => record.key)).toEqual(["key-1"]);
  });

  it("prunes a key whose job directory has been gone past the grace period", () => {
    makeJobDir("job-1");
    const store = createIdempotencyStore(jobsDir);
    store.reserve("key-1", "job-1");
    fs.rmSync(path.join(jobsDir, "job-1"), { recursive: true, force: true });
    ageRecords();

    expect(store.get("key-1")).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("reclaims a stale key on reserve", () => {
    makeJobDir("job-1");
    makeJobDir("job-2");
    const store = createIdempotencyStore(jobsDir);
    store.reserve("key-1", "job-1");
    fs.rmSync(path.join(jobsDir, "job-1"), { recursive: true, force: true });
    ageRecords();

    const result = store.reserve("key-1", "job-2");
    expect(result.reserved).toBe(true);
    expect(result.record.jobId).toBe("job-2");
  });

  it("releases a key", () => {
    makeJobDir("job-1");
    const store = createIdempotencyStore(jobsDir);
    store.reserve("key-1", "job-1");
    store.release("key-1");
    expect(store.get("key-1")).toBeNull();
  });

  it("removes every key that points at a job", () => {
    makeJobDir("job-1");
    makeJobDir("job-2");
    const store = createIdempotencyStore(jobsDir);
    store.reserve("a", "job-1");
    store.reserve("b", "job-1");
    store.reserve("c", "job-2");

    store.removeJob("job-1");
    expect(store.list().map((record) => record.key)).toEqual(["c"]);
  });

  it("lists only live records", () => {
    makeJobDir("job-1");
    makeJobDir("job-2");
    const store = createIdempotencyStore(jobsDir);
    store.reserve("a", "job-1");
    store.reserve("b", "job-2");
    fs.rmSync(path.join(jobsDir, "job-1"), { recursive: true, force: true });
    ageRecords();

    expect(store.list().map((record) => record.key)).toEqual(["b"]);
  });

  it("treats a corrupt file as empty", () => {
    fs.writeFileSync(path.join(jobsDir, ".idempotency.json"), "{not json");
    const store = createIdempotencyStore(jobsDir);
    expect(store.list()).toEqual([]);

    makeJobDir("job-1");
    expect(store.reserve("key-1", "job-1").reserved).toBe(true);
  });

  it("drops malformed records when reading", () => {
    fs.writeFileSync(
      path.join(jobsDir, ".idempotency.json"),
      JSON.stringify({
        version: 1,
        records: {
          good: { key: "good", jobId: "job-1", createdAt: new Date().toISOString() },
          mismatch: { key: "other", jobId: "job-1", createdAt: new Date().toISOString() },
          bad: { key: "bad", jobId: 42 },
        },
      }),
    );
    makeJobDir("job-1");
    const store = createIdempotencyStore(jobsDir);
    expect(store.list().map((record) => record.key)).toEqual(["good"]);
  });
});
