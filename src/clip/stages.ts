/**
 * The clip job's stages.
 *
 * Kept in its own module so the API can initialise a job's stage list without
 * importing the pipeline (and, through it, the transcribe model and ffmpeg
 * harness).
 */
export const CLIP_STAGE_NAMES = ["source", "transcript", "select", "render"] as const;

export type ClipStageName = (typeof CLIP_STAGE_NAMES)[number];
