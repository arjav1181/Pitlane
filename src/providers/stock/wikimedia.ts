import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  Attribution,
  StockAsset,
  StockCandidate,
  StockProvider,
} from "../../schema/providers.js";
import { prepareStockVideo } from "./prepare.js";

/**
 * Wikimedia Commons, with no API key.
 *
 * Everything on Commons is free-licensed (public domain, CC0, CC BY or CC BY-SA),
 * which makes it the one stock library that can be used on a channel without
 * a subscription and without a licensing question. The price is attribution:
 * every file carries a licence and an author, so both are kept with the
 * candidate and written into the job's credits file.
 *
 * Commons is also a deep archive of real motorsport photography and film from
 * the public domain, which is exactly the kind of material a documentary
 * short about a historic car needs.
 */

const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "Pitlane/0.4 (vertical video pipeline)";

export type WikimediaCredit = Attribution;

interface CommonsPage {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{
    url?: string;
    descriptionurl?: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width?: number;
    height?: number;
    duration?: number;
    extmetadata?: {
      LicenseShortName?: { value?: string };
      LicenseUrl?: { value?: string };
      Artist?: { value?: string };
      Credit?: { value?: string };
    };
  }>;
}

async function fetchJson(params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${API}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Commons API failed: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

/** Strip the HTML that MediaWiki puts in the author field. */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function creditOf(page: CommonsPage): WikimediaCredit {
  const meta = page.imageinfo?.[0]?.extmetadata ?? {};
  return {
    license: stripHtml(meta.LicenseShortName?.value ?? "see source"),
    licenseUrl: meta.LicenseUrl?.value,
    author: stripHtml(meta.Artist?.value ?? meta.Credit?.value ?? "Unknown author"),
    sourceUrl: page.imageinfo?.[0]?.descriptionurl ?? `https://commons.wikimedia.org/wiki/${page.pageid}`,
  };
}

/**
 * Words that describe how a shot was made, not what is in it.
 *
 * Commons ranks by keyword, and every extra word narrows the result set. A
 * prompt like "vintage three wheeled motor car in a museum" asks for a file
 * that mentions all of those words and often returns nothing, while "three
 * wheeled motor car" returns the Patent-Motorwagen. The proper nouns - the
 * ones that actually name the subject - are never in this list.
 */
const NOISE_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "from",
  "into",
  "over",
  "under",
  "near",
  "with",
  "vintage",
  "old",
  "antique",
  "historic",
  "historical",
  "cinematic",
  "dramatic",
  "moody",
  "atmospheric",
  "close",
  "closeup",
  "up",
  "wide",
  "shot",
  "angle",
  "footage",
  "photo",
  "photograph",
  "image",
  "black",
  "white",
  "sepia",
  "grainy",
  "blurry",
  "background",
  "foreground",
  "style",
  "styled",
  "lighting",
  "lit",
  "4k",
  "high",
  "quality",
  "detailed",
  "realistic",
  "scene",
  "view",
  "showing",
  "shows",
]);

/** The part of a visual prompt Commons can actually match on. */
export function distillCommonsQuery(prompt: string, maxWords = 5): string {
  const words = prompt
    .toLowerCase()
    // "close-up" is two staging words wearing a hyphen; "Mercedes-Benz" does
    // not mind being searched as two words either.
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !NOISE_WORDS.has(word));

  return words.slice(0, maxWords).join(" ");
}

async function searchOnce(query: string, kind: "image" | "video", limit: number): Promise<StockCandidate[]> {
  const params: Record<string, string> = {
    action: "query",
    generator: "search",
    gsrsearch: `${query} filetype:${kind === "video" ? "video" : "bitmap"}`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime|mediatype",
    iiurlwidth: "1280",
    format: "json",
    origin: "*",
  };

  const data = await fetchJson(params);
  const pages = (data["query"] as { pages?: CommonsPage[] } | undefined)?.pages ?? [];

  const candidates: StockCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    const mime = String((info as { mime?: string }).mime ?? "");
    if (kind === "video") {
      if (!mime.startsWith("video/")) continue;
      if (!/\.(webm|ogv|mp4)$/i.test(info.url)) continue;
    } else {
      if (!mime.startsWith("image/")) continue;
      if (mime.includes("svg") || mime.includes("gif")) continue;
    }

    const pageId = page.pageid ?? 0;
    const title = page.title ?? `commons-${pageId}`;
    candidates.push({
      id: `wikimedia-${pageId}`,
      url: info.thumburl ?? info.url,
      width: info.thumbwidth ?? info.width ?? 0,
      height: info.thumbheight ?? info.height ?? 0,
      duration: info.duration,
      credit: { ...creditOf(page), label: title.replace(/^File:/, "") },
      label: title.replace(/^File:/, ""),
    });
  }

  return candidates;
}

/**
 * Search the literal prompt, then the distilled one.
 *
 * One result is not a choice, and a Commons search that returns nothing is
 * usually a prompt with three adjectives too many rather than a subject the
 * archive does not have. The distilled query is tried before the resolver
 * decides the scene has no footage at all.
 */
async function search(query: string, kind: "image" | "video", limit: number): Promise<StockCandidate[]> {
  const results = await searchOnce(query, kind, limit);
  if (results.length >= 2) return results;

  const distilled = distillCommonsQuery(query);
  if (!distilled || distilled === query.trim().toLowerCase()) return results;

  const more = await searchOnce(distilled, kind, limit);
  const byId = new Map(results.map((candidate) => [candidate.id, candidate]));
  for (const candidate of more) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return [...byId.values()];
}

export class WikimediaStock implements StockProvider {
  private readonly creditById = new Map<string, WikimediaCredit>();

  async searchVideo(query: string): Promise<StockCandidate[]> {
    const candidates = await search(query, "video", 6);
    for (const candidate of candidates) {
      if (candidate.credit) this.creditById.set(candidate.id, candidate.credit);
    }
    return candidates;
  }

  async searchImage(query: string): Promise<StockCandidate[]> {
    const candidates = await search(query, "image", 10);
    for (const candidate of candidates) {
      if (candidate.credit) this.creditById.set(candidate.id, candidate.credit);
    }
    return candidates;
  }

  /** Credit for a candidate, if this provider produced it. */
  creditFor(candidateId: string): WikimediaCredit | undefined {
    return this.creditById.get(candidateId);
  }

  async download(candidate: StockCandidate): Promise<StockAsset> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commons-"));
    const isVideo = /\.webm$|\.ogv$|\.mp4$/i.test(candidate.url) || (candidate.duration ?? 0) > 0;

    try {
      const rawPath = path.join(dir, "source");
      const response = await fetch(candidate.url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`Commons download failed: HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(rawPath, buffer);

      if (!isVideo) {
        const filePath = path.join(dir, "image.jpg");
        fs.copyFileSync(rawPath, filePath);
        return { filePath, width: candidate.width, height: candidate.height };
      }

      // Commons video is WebM or Ogg. The renderer wants MP4, so it is
      // transcoded and trimmed to a short clip.
      const filePath = path.join(dir, "clip.mp4");
      await new Promise<void>((resolve, reject) => {
        execFile(
          "ffmpeg",
          [
            "-y",
            "-loglevel",
            "error",
            "-i",
            rawPath,
            "-t",
            "12",
            "-vf",
            "scale=-2:720",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "26",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            filePath,
          ],
          { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
          (error) => (error ? reject(error) : resolve()),
        );
      });

      const prepared = await prepareStockVideo(filePath);
      return {
        filePath: prepared.filePath,
        width: candidate.width,
        height: candidate.height,
        duration: prepared.duration ?? candidate.duration,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
