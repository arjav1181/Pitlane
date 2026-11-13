import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Queue } from "bullmq";
import type { JobData } from "./job-data.js";
import type { JobMeta } from "./job-meta.js";

export const STAGE_NAMES = [
  "research",
  "director",
  "tts",
  "visuals",
  "assembly",
  "critic",
] as const;

/** Job IDs are used as directory names — allow only safe characters. */
export function isValidJobId(id: string): boolean {
  return /^[\w-]+$/.test(id);
}

export function jobDirFor(jobsDir: string, id: string): string {
  return path.join(jobsDir, id);
}

function isJobMeta(value: unknown): value is JobMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as Record<string, unknown>;
  return typeof meta["id"] === "string" && typeof meta["topic"] === "string";
}

export function readJobMeta(jobsDir: string, id: string): JobMeta | null {
  if (!isValidJobId(id)) return null;
  try {
    const raw = fs.readFileSync(path.join(jobDirFor(jobsDir, id), "meta.json"), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isJobMeta(parsed)) return null;
    const meta = parsed;
    // Keep the id consistent with the directory name even if the file drifted.
    if (meta.id !== id) meta.id = id;
    if (!meta.stages) meta.stages = {};
    return meta;
  } catch {
    return null;
  }
}

let metaWriteCounter = 0;

/** Matches the temporary files created by writeJobMeta below. */
const META_TMP_PATTERN = /^\.meta\..*\.tmp$/;

/**
 * Atomic meta write (tmp + rename) so readers never see a half-written file.
 *
 * The temporary name must be unique per write: the API server and the worker
 * both update meta concurrently (create/cancel next to stage progress), and a
 * shared `.meta.tmp` made one writer rename the other's file away, which failed
 * the job with `ENOENT: rename ... .meta.tmp -> ... meta.json`.
 */
export function writeJobMeta(jobsDir: string, id: string, meta: JobMeta): void {
  const jobDir = jobDirFor(jobsDir, id);
  fs.mkdirSync(jobDir, { recursive: true });
  const metaPath = path.join(jobDir, "meta.json");
  metaWriteCounter = (metaWriteCounter + 1) % 1_000_000;
  const tmpPath = path.join(jobDir, `.meta.${process.pid}.${metaWriteCounter}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2));
  try {
    fs.renameSync(tmpPath, metaPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

export interface JobRecord {
  id: string;
  meta: JobMeta;
}

export function listJobMetas(jobsDir: string): JobRecord[] {
  if (!fs.existsSync(jobsDir)) return [];
  return fs
    .readdirSync(jobsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isValidJobId(entry.name))
    .map((entry) => {
      const meta = readJobMeta(jobsDir, entry.name);
      return {
        id: entry.name,
        meta:
          meta ??
          ({
            id: entry.name,
            topic: "",
            status: "unknown",
            createdAt: "",
            stages: {},
          } satisfies JobMeta),
      };
    });
}

export interface JobLinks {
  self: string;
  events: string;
  artifacts: string;
  video: string | null;
  poster: string | null;
  score: string;
  log: string;
  cancel: string | null;
  retry: string | null;
}

export function buildJobLinks(meta: JobMeta): JobLinks {
  const base = `/api/v1/jobs/${encodeURIComponent(meta.id)}`;
  const terminal = meta.status === "completed" || meta.status === "failed";
  const cancelled = meta.status === "cancelled";
  return {
    self: base,
    events: `${base}/events`,
    artifacts: `${base}/artifacts`,
    video: meta.videoPath ? `${base}/artifacts/${encodeArtifactPath(meta.videoPath)}` : null,
    poster: meta.posterPath ? `${base}/artifacts/${encodeArtifactPath(meta.posterPath)}` : null,
    score: `${base}/score`,
    log: `${base}/log`,
    cancel: terminal || cancelled ? null : `${base}/cancel`,
    retry: terminal || cancelled ? `${base}/retry` : null,
  };
}

/** Public projection of a job: metadata plus discoverable links. */
export function toPublicJob(meta: JobMeta): JobMeta & { links: JobLinks } {
  return { ...meta, links: buildJobLinks(meta) };
}

export function encodeArtifactPath(artifactPath: string): string {
  return artifactPath.split("/").map(encodeURIComponent).join("/");
}

export function buildPlaceholderMeta(
  id: string,
  data: JobData,
  options: { retryOf?: string; createdAt?: string } = {},
): JobMeta {
  const meta: JobMeta = {
    id,
    topic: data.topic,
    status: "queued",
    createdAt: options.createdAt ?? new Date().toISOString(),
    stages: Object.fromEntries(STAGE_NAMES.map((stage) => [stage, { status: "pending" }])),
    request: {
      providers: data.providers,
      platform: data.platform,
      pacing: data.pacing,
      dryRun: data.dryRun,
      noMusic: data.noMusic,
      noVideo: data.noVideo,
      noAiAssets: data.noAiAssets,
    },
  };
  if (data.archetype) meta.archetype = data.archetype;
  if (data.pacing) meta.pacing = data.pacing;
  if (data.platform) meta.platform = data.platform;
  if (data.noMusic) meta.noMusic = true;
  if (data.noVideo) meta.noVideo = true;
  if (data.noAiAssets) meta.noAiAssets = true;
  if (data.metadata) meta.metadata = data.metadata;
  if (options.retryOf) meta.retryOf = options.retryOf;
  return meta;
}

/**
 * Enqueue a render job and write its placeholder meta.json so the API never
 * 404s while the job is waiting in Redis.
 */
export async function createQueuedJob(
  queue: Queue,
  jobsDir: string,
  data: JobData,
  options: { id?: string; retryOf?: string; createdAt?: string } = {},
): Promise<{ id: string; meta: JobMeta }> {
  const id = options.id ?? randomUUID();
  if (!isValidJobId(id)) {
    throw new Error(`Generated an invalid job id: ${id}`);
  }

  await queue.add("render", data, { jobId: id });

  const meta = buildPlaceholderMeta(id, data, options);
  try {
    writeJobMeta(jobsDir, id, meta);
  } catch (err) {
    // The job is already queued; the worker will create meta.json itself.
    // Reporting the failure is still useful, but do not leave a phantom job.
    throw err;
  }
  return { id, meta };
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

export function contentTypeFor(artifactPath: string): string {
  return CONTENT_TYPES[path.extname(artifactPath).toLowerCase()] ?? "application/octet-stream";
}

export interface ArtifactEntry {
  path: string;
  size: number;
  modifiedAt: string;
  contentType: string;
  url: string;
}

/** List files below a job directory. Symlinks are skipped. */
export function listArtifacts(jobsDir: string, id: string): ArtifactEntry[] {
  const root = jobDirFor(jobsDir, id);
  const entries: ArtifactEntry[] = [];

  function walk(dir: string, prefix: string) {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (dirent.name === ".meta.tmp" || META_TMP_PATTERN.test(dirent.name)) continue;
      const fullPath = path.join(dir, dirent.name);
      const relative = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        walk(fullPath, relative);
        continue;
      }
      if (!dirent.isFile()) continue;
      try {
        const stat = fs.statSync(fullPath);
        entries.push({
          path: relative,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          contentType: contentTypeFor(relative),
          url: `/api/v1/jobs/${encodeURIComponent(id)}/artifacts/${encodeArtifactPath(relative)}`,
        });
      } catch {}
    }
  }

  walk(root, "");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export type ArtifactResolution =
  | {
      ok: true;
      /** Absolute path on disk. */
      fullPath: string;
      /** Path relative to the job directory (e.g. "run/assets/scene.mp4"). */
      relativePath: string;
      /** Path relative to the jobs directory (e.g. "<jobId>/run/assets/scene.mp4"). */
      relativeToJobsDir: string;
    }
  | { ok: false; status: 400 | 403 | 404; error: string };

/** Resolve an artifact path inside a job directory with traversal protection. */
export function resolveArtifact(
  jobsDir: string,
  id: string,
  artifactPath: string,
): ArtifactResolution {
  if (!isValidJobId(id)) {
    return { ok: false, status: 400, error: "Invalid job ID" };
  }
  const jobDir = path.resolve(jobDirFor(jobsDir, id));
  const fullPath = path.resolve(jobDir, artifactPath);
  if (fullPath !== jobDir && !fullPath.startsWith(jobDir + path.sep)) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  if (!fs.existsSync(fullPath)) {
    return { ok: false, status: 404, error: "Artifact not found" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(fullPath);
  } catch {
    return { ok: false, status: 404, error: "Artifact not found" };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  if (!stat.isFile()) {
    return { ok: false, status: 404, error: "Artifact not found" };
  }
  return {
    ok: true,
    fullPath,
    relativePath: path.relative(jobDir, fullPath),
    relativeToJobsDir: path.join(id, path.relative(jobDir, fullPath)),
  };
}

function existsInJob(jobsDir: string, id: string, relativePath: string): string | null {
  const resolution = resolveArtifact(jobsDir, id, relativePath);
  return resolution.ok ? resolution.relativePath : null;
}

/** Locate the rendered video relative to the job directory. */
export function findVideoPath(jobsDir: string, meta: JobMeta): string | null {
  if (meta.videoPath) {
    const found = existsInJob(jobsDir, meta.id, meta.videoPath);
    if (found) return found;
  }
  if (meta.runDir) {
    const found = existsInJob(jobsDir, meta.id, path.join(meta.runDir, "final.mp4"));
    if (found) return found;
  }
  for (const artifact of listArtifacts(jobsDir, meta.id)) {
    if (path.basename(artifact.path) === "final.mp4") return artifact.path;
  }
  return null;
}

/** Locate the run directory (from meta or by finding score.json/log.json). */
export function findRunDir(jobsDir: string, meta: JobMeta): string | null {
  if (meta.runDir) {
    const dir = jobDirFor(jobsDir, meta.id);
    if (fs.existsSync(path.join(dir, meta.runDir))) return meta.runDir;
  }
  for (const artifact of listArtifacts(jobsDir, meta.id)) {
    if (artifact.path.endsWith("/score.json") || artifact.path === "score.json") {
      return path.dirname(artifact.path);
    }
  }
  for (const artifact of listArtifacts(jobsDir, meta.id)) {
    if (artifact.path.endsWith("/log.json") || artifact.path === "log.json") {
      return path.dirname(artifact.path);
    }
  }
  return null;
}
