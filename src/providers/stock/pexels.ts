import * as fs from "node:fs";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StockAsset, StockCandidate, StockProvider } from "../../schema/providers.js";
import { prepareStockVideo } from "./prepare.js";

const PEXELS_BASE = "https://api.pexels.com";

/** Largest stock video we are willing to download (40 MB). */
const MAX_STOCK_VIDEO_BYTES = 40 * 1024 * 1024;
/** Above this, the clip is downloaded but immediately replaced by a smaller one. */
const LIGHT_VIDEO_BYTES = 12 * 1024 * 1024;

export class PexelsStock implements StockProvider {
  private apiKey: string | null;
  private cacheDir: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env["PEXELS_API_KEY"] ?? null;
    this.cacheDir = path.join(process.env["HOME"] ?? "/tmp", ".openreels", "cache", "stock");
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async searchVideo(query: string): Promise<StockCandidate[]> {
    if (!this.apiKey) return [];

    const url = `${PEXELS_BASE}/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait&size=large`;
    const response = await fetch(url, {
      headers: { Authorization: this.apiKey },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn("[stock] Pexels rate limited, skipping video search");
        return [];
      }
      throw new Error(`Pexels API error: ${response.status}`);
    }

    const data = (await response.json()) as PexelsVideoResponse;
    const videos = data.videos ?? [];

    // Try without orientation filter if no portrait results
    if (videos.length === 0) {
      const fallback = await this.searchVideoLandscapeFallback(query);
      if (fallback.length > 0) return fallback;
    }

    const candidates: StockCandidate[] = [];
    for (const video of videos) {
      const videoFile = this.pickVideoFile(video.video_files);
      if (!videoFile?.link) continue;
      candidates.push({
        url: videoFile.link,
        width: videoFile.width ?? 1080,
        height: videoFile.height ?? 1920,
        duration: video.duration,
        id: `pexels-video-${video.id}`,
      });
    }
    return candidates;
  }

  private async searchVideoLandscapeFallback(query: string): Promise<StockCandidate[]> {
    if (!this.apiKey) return [];

    const url = `${PEXELS_BASE}/videos/search?query=${encodeURIComponent(query)}&per_page=3&size=large`;
    const response = await fetch(url, {
      headers: { Authorization: this.apiKey },
    });

    if (!response.ok) return [];
    const data = (await response.json()) as PexelsVideoResponse;
    const videos = data.videos ?? [];

    const candidates: StockCandidate[] = [];
    for (const video of videos) {
      const videoFile = this.pickVideoFile(video.video_files);
      if (!videoFile?.link) continue;
      candidates.push({
        url: videoFile.link,
        width: videoFile.width ?? 1920,
        height: videoFile.height ?? 1080,
        duration: video.duration,
        id: `pexels-video-${video.id}`,
      });
    }
    return candidates;
  }

  /**
   * Pick the best video file for a short vertical video.
   *
   * Pexels offers the same clip in many resolutions, and the largest one can
   * be hundreds of megabytes (a 4K, multi-minute file). Rendering only uses a
   * few seconds of it, so files above the size cap are skipped in favour of a
   * smaller variant of the same clip.
   */
  /**
   * Pick the file to download.
   *
   * The short is 1080 wide, so a bigger file buys nothing that the picture
   * can show, but it costs a long download and a slow frame extraction later.
   * The smallest file that still fills the frame is the right one.
   */
  private pickVideoFile(files: PexelsVideoResponse["videos"][number]["video_files"]) {
    const withinSize = (f: { file_size?: number }) =>
      f.file_size == null || f.file_size <= MAX_STOCK_VIDEO_BYTES;
    const candidates = files.filter(withinSize);

    // The short side is what fills the vertical frame.
    const shortSide = (f: { width?: number; height?: number }) =>
      Math.min(f.width ?? 0, f.height ?? 0);

    const light =
      candidates
        .filter((f) => (f.file_size ?? 0) > 0 && (f.file_size ?? 0) <= LIGHT_VIDEO_BYTES)
        .filter((f) => shortSide(f) >= 720)
        .sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0))[0] ??
      candidates
        .filter((f) => shortSide(f) >= 720)
        .sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0))[0] ??
      candidates
        .filter((f) => (f.width ?? 0) >= 720 && (f.width ?? 0) <= 1920)
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ??
      candidates
        .filter((f) => (f.width ?? 0) >= 720)
        .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0] ??
      candidates
        .filter((f) => (f.file_size ?? 0) <= MAX_STOCK_VIDEO_BYTES)
        .sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0))[0];

    return light;
  }

  async searchImage(query: string): Promise<StockCandidate[]> {
    if (!this.apiKey) return [];

    const url = `${PEXELS_BASE}/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait&size=large`;
    const response = await fetch(url, {
      headers: { Authorization: this.apiKey },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn("[stock] Pexels rate limited, skipping image search");
        return [];
      }
      throw new Error(`Pexels API error: ${response.status}`);
    }

    const data = (await response.json()) as PexelsImageResponse;
    return (data.photos ?? []).map((photo) => ({
      url: photo.src.large2x ?? photo.src.large ?? photo.src.original,
      width: photo.width,
      height: photo.height,
      id: `pexels-image-${photo.id}`,
    }));
  }

  async download(candidate: StockCandidate): Promise<StockAsset> {
    const ext = candidate.duration != null ? "mp4" : "jpg";
    const filename = `${candidate.id}.${ext}`;
    const filePath = await this.downloadToCache(candidate.url, filename);

    // A library will hand over a four-minute 4K file. The renderer pays for
    // every frame of it, so the clip is trimmed and scaled first.
    if (candidate.duration != null) {
      const prepared = await prepareStockVideo(filePath);
      return {
        filePath: prepared.filePath,
        width: candidate.width,
        height: candidate.height,
        duration: prepared.duration ?? candidate.duration,
      };
    }

    return {
      filePath,
      width: candidate.width,
      height: candidate.height,
      duration: candidate.duration,
    };
  }

  private async downloadToCache(url: string, filename: string): Promise<string> {
    const filePath = path.join(this.cacheDir, filename);

    // Return cached if exists
    if (fs.existsSync(filePath)) return filePath;

    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download: ${url}`);
    }

    // Guard against multi-hundred-megabyte clips: a short only uses a few
    // seconds, so an oversized file is rejected instead of filling the disk.
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_STOCK_VIDEO_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new Error(
        `Stock file is too large (${Math.round(declaredSize / 1024 / 1024)}MB): ${url}`,
      );
    }

    // Enforce the cap while streaming too: the CDN often answers without a
    // content-length header, so the byte count is checked as it arrives.
    let bytesWritten = 0;
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > MAX_STOCK_VIDEO_BYTES) {
          callback(
            new Error(`Stock file exceeds the ${MAX_STOCK_VIDEO_BYTES / 1024 / 1024}MB limit`),
          );
          return;
        }
        callback(null, chunk);
      },
    });

    const fileStream = fs.createWriteStream(filePath);
    try {
      await pipeline(Readable.fromWeb(response.body as any), guard, fileStream);
    } catch (err) {
      fs.rmSync(filePath, { force: true });
      throw err;
    }

    return filePath;
  }
}

interface PexelsVideoResponse {
  videos: {
    id: number;
    duration: number;
    video_files: {
      link: string;
      width?: number;
      height?: number;
      quality?: string;
      /** Size of the file in bytes, when Pexels reports it. */
      file_size?: number;
    }[];
  }[];
}

interface PexelsImageResponse {
  photos: {
    id: number;
    width: number;
    height: number;
    src: {
      original: string;
      large2x: string;
      large: string;
    };
  }[];
}
