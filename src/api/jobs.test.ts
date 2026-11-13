import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildJobLinks, listArtifacts, resolveArtifact, writeJobMeta } from "./jobs.js";
import type { JobMeta } from "./job-meta.js";

let jobsDir: string;

beforeEach(() => {
  jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openreels-artifacts-"));
  const jobDir = path.join(jobsDir, "job-1");
  fs.mkdirSync(path.join(jobDir, "run", "assets"), { recursive: true });
  fs.writeFileSync(path.join(jobDir, "run", "assets", "scene.mp4"), "video");
  fs.writeFileSync(path.join(jobDir, "meta.json"), "{}");
});

afterEach(() => {
  fs.rmSync(jobsDir, { recursive: true, force: true });
});

describe("resolveArtifact", () => {
  it("resolves a file inside the job directory", () => {
    const result = resolveArtifact(jobsDir, "job-1", "run/assets/scene.mp4");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relativePath).toBe("run/assets/scene.mp4");
    expect(result.fullPath).toBe(path.join(jobsDir, "job-1", "run", "assets", "scene.mp4"));
  });

  it("returns a path relative to the jobs directory for serving", () => {
    const result = resolveArtifact(jobsDir, "job-1", "run/assets/scene.mp4");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The serving route resolves against the jobs directory, so the path it
    // gets has to include the job id.
    expect(result.relativeToJobsDir).toBe("job-1/run/assets/scene.mp4");
    expect(path.resolve(jobsDir, result.relativeToJobsDir)).toBe(result.fullPath);
  });

  it("rejects a missing file", () => {
    const result = resolveArtifact(jobsDir, "job-1", "nope.mp4");
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects path traversal", () => {
    const result = resolveArtifact(jobsDir, "job-1", "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });

  it("rejects an invalid job id", () => {
    const result = resolveArtifact(jobsDir, "../escape", "meta.json");
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});

describe("writeJobMeta", () => {
  it("writes meta atomically", () => {
    const meta = { id: "job-1", topic: "topic", status: "queued", createdAt: "", stages: {} };
    writeJobMeta(jobsDir, "job-1", meta);

    const parsed = JSON.parse(fs.readFileSync(path.join(jobsDir, "job-1", "meta.json"), "utf-8"));
    expect(parsed.topic).toBe("topic");
    const leftovers = fs.readdirSync(path.join(jobsDir, "job-1")).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("does not lose meta when writers race (server + worker)", async () => {
    const meta = { id: "job-1", topic: "topic", status: "running", createdAt: "", stages: {} };
    // A shared `.meta.tmp` made one writer rename the other's file away:
    // ENOENT .meta.tmp -> meta.json. Unique temp names must survive this.
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        Promise.resolve().then(() => {
          writeJobMeta(jobsDir, "job-1", { ...meta, topic: `topic-${i}` });
        }),
      ),
    );

    const parsed = JSON.parse(fs.readFileSync(path.join(jobsDir, "job-1", "meta.json"), "utf-8"));
    expect(parsed.topic).toMatch(/^topic-\d+$/);
    const leftovers = fs.readdirSync(path.join(jobsDir, "job-1")).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("hides temporary meta files from artifact listings", () => {
    fs.writeFileSync(path.join(jobsDir, "job-1", ".meta.123.1.tmp"), "{}");
    fs.writeFileSync(path.join(jobsDir, "job-1", ".meta.tmp"), "{}");

    const paths = listArtifacts(jobsDir, "job-1").map((entry) => entry.path);
    expect(paths).toContain("meta.json");
    expect(paths.some((p) => p.endsWith(".tmp"))).toBe(false);
  });
});

describe("buildJobLinks", () => {
  it("links the poster when the job has one", () => {
    const links = buildJobLinks({
      id: "abc",
      topic: "t",
      status: "completed",
      videoPath: "run/final.mp4",
      posterPath: "run/poster.jpg",
      stages: {},
    } as JobMeta);

    expect(links.video).toBe("/api/v1/jobs/abc/artifacts/run/final.mp4");
    expect(links.poster).toBe("/api/v1/jobs/abc/artifacts/run/poster.jpg");
  });

  it("leaves the poster null when the job has none", () => {
    const links = buildJobLinks({
      id: "abc",
      topic: "t",
      status: "failed",
      stages: {},
    } as JobMeta);

    expect(links.poster).toBeNull();
  });
});
