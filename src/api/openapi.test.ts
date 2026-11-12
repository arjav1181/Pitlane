import { describe, expect, it } from "vitest";
import { CALLBACK_EVENTS } from "./callbacks.js";
import {
  API_VERSION,
  buildOpenApiDocument,
  OPENAPI_TITLE,
  OPENAPI_VERSION,
  renderDocsHtml,
} from "./openapi.js";

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  security?: Array<Record<string, unknown>>;
  components: {
    schemas: Record<string, { properties?: Record<string, unknown> }>;
    securitySchemes: Record<string, unknown>;
  };
  paths: Record<
    string,
    Record<string, { security?: unknown[]; responses: Record<string, unknown> }>
  >;
}

describe("buildOpenApiDocument", () => {
  it("declares OpenAPI 3.1 and the documented metadata", () => {
    const doc = buildOpenApiDocument() as unknown as OpenApiDoc;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe(OPENAPI_TITLE);
    expect(doc.info.version).toBe(OPENAPI_VERSION);
    expect(doc.servers[0]?.url).toBe("/");
    expect(API_VERSION).toBeTruthy();
  });

  it("honors a custom server URL", () => {
    const doc = buildOpenApiDocument({
      serverUrl: "https://reels.example.com",
    }) as unknown as OpenApiDoc;
    expect(doc.servers[0]?.url).toBe("https://reels.example.com");
  });

  it("adds a global security requirement only when an API key is required", () => {
    const open = buildOpenApiDocument({ apiKeyRequired: false }) as unknown as OpenApiDoc;
    expect(open.security).toBeUndefined();

    const secured = buildOpenApiDocument({ apiKeyRequired: true }) as unknown as OpenApiDoc;
    expect(secured.security).toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
    expect(secured.components.securitySchemes).toHaveProperty("bearerAuth");
    expect(secured.components.securitySchemes).toHaveProperty("apiKeyAuth");
    expect(secured.components.securitySchemes).toHaveProperty("queryApiKey");
  });

  it("keeps health, OpenAPI, and docs public", () => {
    const doc = buildOpenApiDocument({ apiKeyRequired: true }) as unknown as OpenApiDoc;
    for (const path of ["/api/v1/health", "/api/v1/openapi.json", "/api/v1/docs"]) {
      expect(doc.paths[path]?.get?.security).toEqual([]);
    }
  });

  it("documents the full job lifecycle surface", () => {
    const doc = buildOpenApiDocument() as unknown as OpenApiDoc;
    expect(Object.keys(doc.paths).sort()).toEqual(
      [
        "/api/v1/archetypes",
        "/api/v1/capabilities",
        "/api/v1/docs",
        "/api/v1/health",
        "/api/v1/jobs",
        "/api/v1/jobs/batch",
        "/api/v1/jobs/{id}",
        "/api/v1/jobs/{id}/artifacts",
        "/api/v1/jobs/{id}/artifacts/{path}",
        "/api/v1/jobs/{id}/cancel",
        "/api/v1/jobs/{id}/events",
        "/api/v1/jobs/{id}/log",
        "/api/v1/jobs/{id}/retry",
        "/api/v1/jobs/{id}/score",
        "/api/v1/jobs/{id}/video",
        "/api/v1/openapi.json",
        "/api/v1/platforms",
        "/api/v1/providers",
        "/api/v1/stats",
      ].sort(),
    );
  });

  it("documents no-AI assets, callbacks, and idempotency in CreateJobRequest", () => {
    const doc = buildOpenApiDocument() as unknown as OpenApiDoc;
    const create = doc.components.schemas["CreateJobRequest"];
    expect(create?.properties).toHaveProperty("noAiAssets");
    expect(create?.properties).toHaveProperty("callbackUrl");
    expect(create?.properties).toHaveProperty("callbackSecret");
    expect(create?.properties).toHaveProperty("callbackEvents");
    expect(create?.properties).toHaveProperty("callback");
    expect(create?.properties).toHaveProperty("idempotencyKey");
    expect(create?.properties).toHaveProperty("keys");
    expect(create?.properties).toHaveProperty("metadata");

    const callbackEvents = (
      create?.properties?.["callbackEvents"] as {
        items?: { enum?: string[] };
      }
    )?.items?.enum;
    expect(callbackEvents).toEqual(CALLBACK_EVENTS);
  });

  it("never documents secrets as part of the Job response", () => {
    const doc = buildOpenApiDocument() as unknown as OpenApiDoc;
    const jobProperties = doc.components.schemas["Job"]?.properties ?? {};
    expect(jobProperties).not.toHaveProperty("keys");
    expect(jobProperties).not.toHaveProperty("callbacks");
    expect(jobProperties).not.toHaveProperty("callbackUrl");
  });
});

describe("renderDocsHtml", () => {
  it("renders a Redoc shell that points at the OpenAPI route", () => {
    const html = renderDocsHtml();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(OPENAPI_TITLE);
    expect(html).toContain('spec-url="/api/v1/openapi.json"');
    expect(html).toContain("redoc.standalone.js");
  });
});
