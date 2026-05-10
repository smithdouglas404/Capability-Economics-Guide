/**
 * Zod schemas for the public /v1 surface. The OpenAPI spec served at
 * /v1/openapi.json is generated from these via @asteasolutions/zod-to-openapi —
 * single source of truth for both runtime validation and the published
 * contract.
 */
import { z } from "zod";
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { ALL_V1_SCOPES } from "./api-keys";

extendZodWithOpenApi(z);

// ---------- Reusable param schemas ----------
const LimitQuery = z.coerce.number().int().min(1).max(500).default(100).openapi({
  param: { name: "limit", in: "query" },
  description: "Page size (1–500; /cei/history allows up to 1000).",
});
const OffsetQuery = z.coerce.number().int().min(0).default(0).openapi({
  param: { name: "offset", in: "query" },
});

// ---------- Response schemas ----------
const Industry = z
  .object({
    id: z.number().int(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    icon: z.string().nullable().optional(),
    createdAt: z.string().datetime().optional(),
  })
  .openapi("Industry");

const Capability = z
  .object({
    id: z.number().int(),
    industryId: z.number().int(),
    slug: z.string(),
    name: z.string(),
    description: z.string().optional(),
    traditionalView: z.string().optional(),
    economicView: z.string().optional(),
    benchmarkScore: z.number().optional(),
    valueChainStage: z.string().nullable().optional(),
    patentCount: z.number().int().optional(),
    startupCount: z.number().int().optional(),
    vcCapitalUsd: z.number().optional(),
  })
  .openapi("Capability");

const CeiSnapshot = z
  .object({
    id: z.number().int(),
    overallIndex: z.number(),
    overallCiLow: z.number().nullable().optional(),
    overallCiHigh: z.number().nullable().optional(),
    marketSentiment: z.number().nullable().optional(),
    volatility: z.number().nullable().optional(),
    methodologyVersion: z.string().optional(),
    snapshotAt: z.string().datetime(),
    industryBreakdowns: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("CeiSnapshot");

const MacroEvent = z
  .object({
    id: z.number().int(),
    eventType: z.string(),
    severity: z.number(),
    title: z.string(),
    description: z.string().optional(),
    affectedIndustryIds: z.array(z.number().int()).optional(),
    affectedCapabilityIds: z.array(z.number().int()).optional(),
    sentimentDirection: z.enum(["positive", "negative", "neutral"]).optional(),
    startedAt: z.string().datetime(),
    decayDays: z.number().optional(),
    source: z.string().optional(),
    citations: z.array(z.string()).optional(),
  })
  .openapi("MacroEvent");

const ValueChainStage = z
  .object({
    id: z.number().int(),
    industryId: z.number().int(),
    stageName: z.string(),
    stageOrder: z.number().int(),
    disruptionSummary: z.string().optional(),
    hhiScore: z.number().nullable().optional(),
    patentCount: z.number().int().nullable().optional(),
    startupCount: z.number().int().nullable().optional(),
    capitalFlowMm: z.number().nullable().optional(),
    shifts: z.array(z.string()).nullable().optional(),
    risks: z.array(z.string()).nullable().optional(),
  })
  .openapi("ValueChainStage");

const ApiError = z
  .object({
    error: z.string(),
    message: z.string().optional(),
  })
  .openapi("ApiError");

const MeResponse = z
  .object({
    keyId: z.number().int(),
    orgId: z.string().nullable(),
    scopes: z.array(z.enum(ALL_V1_SCOPES)),
    rateLimitPerMin: z.number().int().nullable(),
    monthlyQuota: z.number().int().nullable(),
    monthlyUsageCount: z.number().int(),
    quotaResetAt: z.string().datetime().nullable(),
  })
  .openapi("MeResponse");

const PaginatedIndustries = z.object({
  data: z.array(Industry),
  total: z.number().int(),
});
const PaginatedCapabilities = z.object({
  data: z.array(Capability),
  total: z.number().int(),
});
const CeiHistoryResponse = z.object({ data: z.array(CeiSnapshot) });
const PaginatedMacroEvents = z.object({
  data: z.array(MacroEvent),
  total: z.number().int(),
});
const PaginatedValueChainStages = z.object({
  data: z.array(ValueChainStage),
  total: z.number().int(),
});

// ---------- Build the OpenAPI document ----------
function jsonContent<T extends z.ZodTypeAny>(schema: T) {
  return { content: { "application/json": { schema } } };
}
const errors = {
  401: { description: "Missing or invalid API key", ...jsonContent(ApiError) },
  403: { description: "Key lacks the required scope", ...jsonContent(ApiError) },
  404: { description: "Not found", ...jsonContent(ApiError) },
  429: { description: "Rate limit or monthly quota exceeded", ...jsonContent(ApiError) },
  503: { description: "Quota check temporarily unavailable", ...jsonContent(ApiError) },
};

export function buildOpenApiSpec(serverUrl: string): Record<string, unknown> {
  const r = new OpenAPIRegistry();

  r.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "ce_live_...",
    description: "Per-organization API key. Issue at /developers.",
  });

  r.registerPath({
    method: "get", path: "/v1/industries", tags: ["Industries"],
    summary: "List industries",
    request: { query: z.object({ limit: LimitQuery, offset: OffsetQuery }) },
    responses: {
      200: { description: "OK", ...jsonContent(PaginatedIndustries) },
      401: errors[401], 403: errors[403], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/industries/{slug}", tags: ["Industries"],
    summary: "Get an industry by slug",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: { description: "OK", ...jsonContent(Industry) },
      401: errors[401], 403: errors[403], 404: errors[404], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/capabilities", tags: ["Capabilities"],
    summary: "List capabilities",
    description: "Filter by `industryId` or `industrySlug`.",
    request: {
      query: z.object({
        industryId: z.coerce.number().int().optional(),
        industrySlug: z.string().optional(),
        limit: LimitQuery,
        offset: OffsetQuery,
      }),
    },
    responses: {
      200: { description: "OK", ...jsonContent(PaginatedCapabilities) },
      401: errors[401], 403: errors[403], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/capabilities/{id}", tags: ["Capabilities"],
    summary: "Get a capability by id",
    request: { params: z.object({ id: z.coerce.number().int() }) },
    responses: {
      200: { description: "OK", ...jsonContent(Capability) },
      401: errors[401], 403: errors[403], 404: errors[404], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/cei/current", tags: ["CEI"],
    summary: "Latest Capability Economic Index snapshot",
    responses: {
      200: { description: "OK", ...jsonContent(CeiSnapshot) },
      401: errors[401], 403: errors[403], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/cei/history", tags: ["CEI"],
    summary: "Historical CEI snapshots",
    request: {
      query: z.object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(100).openapi({
          param: { name: "limit", in: "query" },
          description: "Page size (1–1000).",
        }),
      }),
    },
    responses: {
      200: { description: "OK", ...jsonContent(CeiHistoryResponse) },
      401: errors[401], 403: errors[403], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/macro-events", tags: ["Macro Events"],
    summary: "List macro events",
    request: {
      query: z.object({
        since: z.string().datetime().optional(),
        industryId: z.coerce.number().int().optional(),
        limit: LimitQuery,
        offset: OffsetQuery,
      }),
    },
    responses: {
      200: { description: "OK", ...jsonContent(PaginatedMacroEvents) },
      401: errors[401], 403: errors[403], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/value-chain-stages", tags: ["Value Chain"],
    summary: "List value-chain stages",
    request: {
      query: z.object({
        industryId: z.coerce.number().int().optional(),
        limit: LimitQuery,
        offset: OffsetQuery,
      }),
    },
    responses: {
      200: { description: "OK", ...jsonContent(PaginatedValueChainStages) },
      401: errors[401], 403: errors[403], 429: errors[429], 503: errors[503],
    },
  });
  r.registerPath({
    method: "get", path: "/v1/me", tags: ["Meta"],
    summary: "Inspect the calling API key",
    description:
      "Returns the key's scopes, organization, rate limit, and current monthly usage. Available to any valid key — does not require a specific scope. Still rate-limited and quota-counted.",
    responses: {
      200: { description: "OK", ...jsonContent(MeResponse) },
      401: errors[401], 429: errors[429], 503: errors[503],
    },
  });

  const generator = new OpenApiGeneratorV3(r.definitions);
  const doc = generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Capability Economics Public Data API",
      version: "1.0.0",
      description:
        "Stable, versioned access to industries, capabilities, the Capability Economic Index (CEI), macro events, and value-chain stages. Authenticate every request with `Authorization: Bearer ce_live_...`. Issue a key at /developers.",
      contact: { name: "Capability Economics", url: "https://capability-economics.com" },
    },
    servers: [{ url: serverUrl, description: "Production" }],
    security: [{ bearerAuth: [] }],
  });
  return doc as unknown as Record<string, unknown>;
}
