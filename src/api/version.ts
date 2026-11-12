import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Package version, used by health, OpenAPI, and webhook user agents. */
export const VERSION = (require("../../package.json") as { version: string }).version;
