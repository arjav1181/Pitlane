/**
 * Options for the Remotion render step.
 *
 * The renderer is driven programmatically (`renderMedia`/`selectComposition`
 * from `@remotion/renderer`), not through the Remotion CLI. That matters for
 * the timeout: the CLI reads `--delay-render-timeout-in-milliseconds` and
 * forwards it to the renderer, but `renderMedia` never reads
 * `@remotion/cli/config`. Setting the CLI config therefore has no effect on a
 * programmatic render — the renderer keeps its own default of 30s, which it
 * reports to the browser as a 28s delayRender budget (the renderer reserves
 * the last 2s of the timeout for reporting the failure).
 *
 * On a small CPU-only machine extracting a frame from a stock clip can take
 * longer than that, so the timeout has to be passed to the renderer directly.
 */

export interface RenderOptions {
  /** Timeout handed to `renderMedia`/`selectComposition`, in milliseconds. */
  timeoutInMilliseconds: number;
  /**
   * How many browser tabs render frames in parallel.
   *
   * The default is the number of CPUs, which on a 2 vCPU Space means two
   * Chrome instances plus the frame-extraction threads competing for the same
   * two cores. Each tab then gets slower, not faster.
   */
  concurrency: number;
  /**
   * H.264 constant rate factor for the rendered file.
   *
   * The renderer's default is 18, which produced a 38MB file for a one minute
   * vertical short - slow to upload and slow to serve. 23 is visually clean at
   * 1080x1920 and roughly a third of the size.
   */
  crf: number;
  /**
   * Size of the OffthreadVideo frame cache, in bytes.
   *
   * `null` means "half of the system memory available when the render
   * starts". On a Space with a small memory allowance that can be tiny, which
   * makes the renderer re-extract the same frame over and over. A fixed
   * budget is predictable.
   */
  offthreadVideoCacheSizeInBytes: number;
}

/** Default render timeout. Long enough for a CPU-only box to extract a frame. */
/**
 * Default render timeout.
 *
 * Five minutes. The renderer pulls every frame of every stock clip through a
 * proxy, and on two cores with six clips in a video that queue gets long
 * enough for a single request to time out, which kills the render. A second
 * attempt is made on failure, but the budget should be generous enough that
 * the first attempt is the one that succeeds.
 */
export const DEFAULT_RENDER_TIMEOUT_MS = 300_000;

/** Default OffthreadVideo frame cache: 1 GB. */
export const DEFAULT_OFFTHREAD_CACHE_BYTES = 1024 * 1024 * 1024;

/** Default H.264 CRF. 23 is visually clean for 1080x1920 and a third the size. */
export const DEFAULT_CRF = 23;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Resolve the render options from the environment.
 *
 * - `OPENREELS_RENDER_TIMEOUT_MS` — render timeout in milliseconds.
 * - `OPENREELS_RENDER_CONCURRENCY` — parallel browser tabs (1 = serial).
 * - `OPENREELS_RENDER_OFFTHREAD_CACHE_MB` — OffthreadVideo frame cache in MB.
 */
export function resolveRenderOptions(
  env: NodeJS.ProcessEnv = process.env,
): RenderOptions {
  const timeoutInMilliseconds = positiveInt(
    env["OPENREELS_RENDER_TIMEOUT_MS"],
    DEFAULT_RENDER_TIMEOUT_MS,
  );
  const concurrency = positiveInt(env["OPENREELS_RENDER_CONCURRENCY"], 1);
  const cacheMb = positiveInt(
    env["OPENREELS_RENDER_OFFTHREAD_CACHE_MB"],
    DEFAULT_OFFTHREAD_CACHE_BYTES / (1024 * 1024),
  );

  const crf = positiveInt(env["OPENREELS_RENDER_CRF"], DEFAULT_CRF);

  return {
    timeoutInMilliseconds,
    concurrency,
    crf,
    offthreadVideoCacheSizeInBytes: cacheMb * 1024 * 1024,
  };
}
