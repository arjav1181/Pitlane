import { z } from "zod";

/**
 * A request to cut vertical clips out of a long video.
 *
 * The shape is the API contract, so every bound is enforced here rather than
 * in the pipeline: a clip that is 4 seconds long or 11 minutes long is not a
 * clip, and a source longer than the cap would spend the whole render bay on
 * one job.
 */
export const ClipSpec = z.object({
  /** Any yt-dlp-supported URL: YouTube, Twitch, Kick, X, TikTok, a direct MP4. */
  sourceUrl: z.string().url().max(2048),
  /** How many clips to cut. */
  count: z.number().int().min(1).max(10).default(3),
  /**
   * Clip length bounds, in seconds.
   *
   * Shorts reward 20-45s, but a tight 15s cut of a single joke is a legitimate
   * request, so the floor is low and the ceiling is what a viewer will watch
   * without a reason to stay.
   */
  minSeconds: z.number().min(5).max(120).default(20),
  maxSeconds: z.number().min(10).max(180).default(60),
  /**
   * How a 16:9 source becomes 9:16.
   *
   * `blur` keeps the whole frame on a blurred fill, which never cuts a head
   * off; `crop` fills the frame and loses the sides, which is right for a
   * subject that already sits in the middle.
   */
  fit: z.enum(["blur", "crop"]).default("blur"),
  /** Burn word-timed captions. Off is for sources that already have them. */
  captions: z.boolean().default(true),
  /** Burn a hook line at the top for the first seconds. */
  hook: z.boolean().default(true),
  /** Title for the job listing; defaults to the source's own title. */
  title: z.string().max(120).optional(),
  /**
   * Only look inside this window of the source, in seconds.
   *
   * A three-hour stream has one great hour in it; cutting from the transcript
   * of the whole thing costs transcription time and dilutes the selection.
   */
  startSeconds: z.number().min(0).optional(),
  endSeconds: z.number().min(0).optional(),
  /**
   * For a live stream: read from the beginning of the broadcast rather than
   * from "now", and stop after this many minutes of source.
   */
  liveFromStart: z.boolean().default(false),
  /** Hard cap on downloaded source length, in minutes. */
  maxSourceMinutes: z.number().min(1).max(240).default(60),
});

export type ClipSpec = z.infer<typeof ClipSpec>;
export type ClipSpecInput = z.input<typeof ClipSpec>;

/** The spec actually used by the pipeline, with every default resolved. */
export function normalizeClipSpec(input: unknown): ClipSpec {
  const spec = ClipSpec.parse(input);
  if (spec.maxSeconds < spec.minSeconds) {
    throw new Error("maxSeconds must be greater than or equal to minSeconds");
  }
  if (
    spec.startSeconds !== undefined &&
    spec.endSeconds !== undefined &&
    spec.endSeconds <= spec.startSeconds
  ) {
    throw new Error("endSeconds must be greater than startSeconds");
  }
  return spec;
}
