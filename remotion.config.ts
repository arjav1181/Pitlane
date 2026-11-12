import { Config } from "@remotion/cli/config";

Config.setEntryPoint("src/remotion/index.ts");

// The default delayRender timeout is 28s. On a small CPU-only machine the
// renderer can spend longer than that extracting a frame from a stock clip,
// which fails the whole render with a timeout error.
Config.setDelayRenderTimeoutInMilliseconds(120_000);
