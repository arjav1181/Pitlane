import { CALLBACK_EVENTS } from "./callbacks.js";
import { VERSION } from "./version.js";

export const OPENAPI_TITLE = "OpenReels API";
export const OPENAPI_VERSION = "1.0.0";

const jobSchema = {
  type: "object",
  description:
    "Job metadata persisted in meta.json. Provider API keys and webhook secrets are never included.",
  properties: {
    id: { type: "string" },
    topic: { type: "string" },
    archetype: { type: "string" },
    pacing: { type: "string" },
    platform: { type: "string" },
    status: {
      type: "string",
      enum: ["queued", "running", "completed", "failed", "cancelled", "unknown"],
    },
    createdAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
    noAiAssets: { type: "boolean" },
    retryOf: { type: "string", description: "Original job id when created via /retry." },
    metadata: { type: "object", additionalProperties: true },
    stages: { type: "object", additionalProperties: true },
    videoPath: { type: "string", nullable: true },
    runDir: { type: "string", nullable: true },
    score: { type: "object", additionalProperties: true },
    costEstimate: { type: "object", additionalProperties: true },
    actualCost: { type: "object", additionalProperties: true },
    error: { type: "string" },
    links: { $ref: "#/components/schemas/JobLinks" },
  },
  required: ["id", "topic", "status", "createdAt", "stages"],
} as const;

const createJobSchema = {
  type: "object",
  required: ["topic"],
  properties: {
    topic: { type: "string", maxLength: 500 },
    archetype: { type: "string" },
    pacing: { type: "string" },
    platform: { type: "string", default: "youtube" },
    dryRun: { type: "boolean", default: false },
    noMusic: { type: "boolean", default: false },
    noVideo: { type: "boolean", default: false },
    noAiAssets: {
      type: "boolean",
      default: false,
      description:
        "Disable AI image and AI video generation. Scenes use stock media when available and procedural text cards otherwise.",
    },
    direction: { type: "string", description: "Creative direction text (max 10 KB UTF-8)." },
    score: {
      type: "object",
      additionalProperties: true,
      description: "A previously saved DirectorScore to replay instead of generating a new one.",
    },
    metadata: {
      type: "object",
      additionalProperties: true,
      description: "Caller-defined metadata stored with the job (max 8 KB JSON).",
    },
    idempotencyKey: {
      type: "string",
      maxLength: 255,
      description: "Alternative to the Idempotency-Key header.",
    },
    callbackUrl: {
      type: "string",
      format: "uri",
      description: "HTTPS endpoint that receives signed job lifecycle webhooks.",
    },
    callbackSecret: {
      type: "string",
      maxLength: 512,
      description: "HMAC-SHA256 signing secret. Never stored in meta.json.",
    },
    callbackEvents: {
      type: "array",
      items: { type: "string", enum: [...CALLBACK_EVENTS] },
    },
    callback: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        secret: { type: "string" },
        events: { type: "array", items: { type: "string", enum: [...CALLBACK_EVENTS] } },
      },
      required: ["url"],
    },
    providers: {
      type: "object",
      properties: {
        llm: { type: "string" },
        tts: { type: "string" },
        image: { type: "string" },
        stock: { type: "string" },
        video: { type: "string" },
        videoModel: { type: "string" },
        music: { type: "string" },
        llmModel: { type: "string" },
        llmFallbackModels: {
          type: "array",
          items: { type: "string" },
          maxItems: 5,
          description: "Ordered backup model IDs tried when the primary model fails.",
        },
        llmBaseUrl: { type: "string", format: "uri" },
        llmAuthType: { type: "string", enum: ["auto", "none", "bearer", "custom-header"] },
        llmAuthHeader: { type: "string" },
        searchProvider: { type: "string" },
      },
    },
    keys: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "Bring-your-own-key credentials for this job. Sent to the worker through Redis and never written to meta.json.",
    },
  },
} as const;

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const jobLinksSchema = {
  type: "object",
  properties: {
    self: { type: "string" },
    events: { type: "string" },
    artifacts: { type: "string" },
    video: { type: "string", nullable: true },
    score: { type: "string" },
    log: { type: "string" },
    cancel: { type: "string", nullable: true },
    retry: { type: "string", nullable: true },
  },
} as const;

const standardErrors = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "404": { $ref: "#/components/responses/NotFound" },
  "409": { $ref: "#/components/responses/Conflict" },
} as const;

const jobIdParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

export interface OpenApiOptions {
  serverUrl?: string;
  apiKeyRequired?: boolean;
}

/**
 * Build the OpenAPI 3.1 description of the REST API. Kept as a pure function so
 * it can be tested and served without touching Redis or the filesystem.
 */
export function buildOpenApiDocument(options: OpenApiOptions = {}): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: OPENAPI_TITLE,
      version: OPENAPI_VERSION,
      description:
        "Create and manage OpenReels video generation jobs, stream progress, download artifacts, and receive signed webhooks.",
      license: { name: "MIT" },
    },
    servers: [{ url: options.serverUrl ?? "/", description: "This OpenReels server" }],
    tags: [
      { name: "System" },
      { name: "Catalog" },
      { name: "Jobs" },
      { name: "Artifacts" },
      { name: "Realtime" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
        queryApiKey: {
          type: "apiKey",
          in: "query",
          name: "api_key",
          description: "Only for EventSource/media URLs that cannot set headers.",
        },
      },
      schemas: {
        Job: jobSchema,
        JobLinks: jobLinksSchema,
        CreateJobRequest: createJobSchema,
        Error: errorSchema,
      },
      responses: {
        BadRequest: {
          description: "Invalid request",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Unauthorized: {
          description: "Missing or invalid API key",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        NotFound: {
          description: "Resource not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Conflict: {
          description: "Job state does not allow the operation",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
    ...(options.apiKeyRequired ? { security: [{ bearerAuth: [] }, { apiKeyAuth: [] }] } : {}),
    paths: {
      "/api/v1/health": {
        get: {
          tags: ["System"],
          summary: "Health check",
          security: [],
          responses: {
            "200": {
              description: "Server health, Redis connectivity, configured key names, and version.",
            },
          },
        },
      },
      "/api/v1/openapi.json": {
        get: {
          tags: ["System"],
          summary: "OpenAPI document",
          security: [],
          responses: { "200": { description: "This document" } },
        },
      },
      "/api/v1/docs": {
        get: {
          tags: ["System"],
          summary: "Interactive API documentation",
          security: [],
          responses: { "200": { description: "HTML documentation page" } },
        },
      },
      "/api/v1/capabilities": {
        get: {
          tags: ["System"],
          summary: "Server capabilities and limits",
          responses: { "200": { description: "Feature flags, provider catalog, and limits" } },
        },
      },
      "/api/v1/stats": {
        get: {
          tags: ["System"],
          summary: "Aggregate job statistics",
          responses: { "200": { description: "Job counts and total cost" } },
        },
      },
      "/api/v1/archetypes": {
        get: {
          tags: ["Catalog"],
          summary: "List archetypes",
          responses: { "200": { description: "Available visual archetypes" } },
        },
      },
      "/api/v1/platforms": {
        get: {
          tags: ["Catalog"],
          summary: "List platforms",
          responses: { "200": { description: "Supported output platforms" } },
        },
      },
      "/api/v1/providers": {
        get: {
          tags: ["Catalog"],
          summary: "List provider keys",
          responses: { "200": { description: "Supported provider keys and labels" } },
        },
      },
      "/api/v1/jobs": {
        get: {
          tags: ["Jobs"],
          summary: "List jobs",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "archetype", in: "query", schema: { type: "string" } },
            { name: "platform", in: "query", schema: { type: "string" } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "until", in: "query", schema: { type: "string", format: "date-time" } },
            {
              name: "sort",
              in: "query",
              schema: { type: "string", enum: ["newest", "oldest"] },
            },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: {
            "200": {
              description: "Paginated jobs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } },
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Jobs"],
          summary: "Create a job",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              schema: { type: "string", maxLength: 255 },
              description: "Replay-safe job creation.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CreateJobRequest" } },
            },
          },
          responses: {
            "201": {
              description: "Job queued",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Job" } },
              },
            },
            "200": {
              description:
                "Existing job returned for a replayed Idempotency-Key (Idempotency-Replayed: true)",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Job" } },
              },
            },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/batch": {
        post: {
          tags: ["Jobs"],
          summary: "Create up to 25 jobs in one request",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jobs: {
                      type: "array",
                      maxItems: 25,
                      items: { $ref: "#/components/schemas/CreateJobRequest" },
                    },
                  },
                  required: ["jobs"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created jobs and per-item errors",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      jobs: { type: "array", items: { $ref: "#/components/schemas/Job" } },
                      errors: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            index: { type: "integer" },
                            error: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/{id}": {
        get: {
          tags: ["Jobs"],
          summary: "Get a job",
          parameters: [jobIdParameter],
          responses: {
            "200": {
              description: "Job metadata and links",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Job" } },
              },
            },
            ...standardErrors,
          },
        },
        delete: {
          tags: ["Jobs"],
          summary: "Delete a finished job and its artifacts",
          parameters: [jobIdParameter],
          responses: {
            "200": { description: "Job deleted" },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/{id}/cancel": {
        post: {
          tags: ["Jobs"],
          summary: "Cancel a queued or running job",
          parameters: [jobIdParameter],
          responses: {
            "200": { description: "Cancellation requested" },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/{id}/retry": {
        post: {
          tags: ["Jobs"],
          summary: "Re-run a finished job as a new job",
          parameters: [jobIdParameter],
          responses: {
            "201": {
              description: "New job queued",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Job" } },
              },
            },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/{id}/events": {
        get: {
          tags: ["Realtime"],
          summary: "Stream job progress with Server-Sent Events",
          description:
            "Emits job:snapshot, stage:<name>, job:completed, job:failed, and job:cancelled events. Use ?api_key= when the EventSource API cannot set headers.",
          parameters: [jobIdParameter],
          responses: { "200": { description: "text/event-stream" } },
        },
      },
      "/api/v1/jobs/{id}/artifacts": {
        get: {
          tags: ["Artifacts"],
          summary: "List job artifacts",
          parameters: [jobIdParameter],
          responses: {
            "200": {
              description: "Files with sizes, timestamps, content types, and download URLs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      jobId: { type: "string" },
                      artifacts: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            path: { type: "string" },
                            size: { type: "integer" },
                            modifiedAt: { type: "string", format: "date-time" },
                            contentType: { type: "string" },
                            url: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/{id}/artifacts/{path}": {
        get: {
          tags: ["Artifacts"],
          summary: "Download an artifact",
          parameters: [
            jobIdParameter,
            { name: "path", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "File contents" },
            "403": { description: "Path traversal or symlink rejected" },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/{id}/video": {
        get: {
          tags: ["Artifacts"],
          summary: "Download the rendered video",
          parameters: [jobIdParameter],
          responses: { "200": { description: "MP4 video" }, ...standardErrors },
        },
      },
      "/api/v1/jobs/{id}/score": {
        get: {
          tags: ["Artifacts"],
          summary: "Get the DirectorScore",
          parameters: [jobIdParameter],
          responses: {
            "200": { description: "DirectorScore JSON" },
            ...standardErrors,
          },
        },
      },
      "/api/v1/jobs/{id}/log": {
        get: {
          tags: ["Artifacts"],
          summary: "Get the run log",
          parameters: [jobIdParameter],
          responses: {
            "200": { description: "Run log JSON" },
            ...standardErrors,
          },
        },
      },
    },
  };
}

/** Small HTML shell that renders the OpenAPI document with Redoc. */
export function renderDocsHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${OPENAPI_TITLE}</title>
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/api/v1/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundled/redoc.standalone.js"></script>
  </body>
</html>`;
}

/** Version reported by health and capabilities endpoints. */
export const API_VERSION = VERSION;
