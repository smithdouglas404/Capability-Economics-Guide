/**
 * Hand-authored OpenAPI 3.0 spec for the public /v1 surface.
 *
 * Why hand-authored: Zod→OpenAPI generators (orval, zod-to-openapi) buy
 * little for a 6-endpoint surface, add a build step, and obscure the exact
 * shape that goes out the wire. This is the contract we ship — keeping it
 * in one file makes it readable for paying customers and reviewable in PRs.
 */
export function buildOpenApiSpec(serverUrl: string): Record<string, unknown> {
  return {
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
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "ce_live_...",
          description: "Per-organization API key. Issue at /developers.",
        },
      },
      schemas: {
        Industry: {
          type: "object",
          required: ["id", "slug", "name", "description"],
          properties: {
            id: { type: "integer" },
            slug: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            icon: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Capability: {
          type: "object",
          required: ["id", "industryId", "slug", "name"],
          properties: {
            id: { type: "integer" },
            industryId: { type: "integer" },
            slug: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            traditionalView: { type: "string" },
            economicView: { type: "string" },
            benchmarkScore: { type: "number" },
            valueChainStage: { type: "string", nullable: true },
            patentCount: { type: "integer" },
            startupCount: { type: "integer" },
            vcCapitalUsd: { type: "number" },
          },
        },
        CeiSnapshot: {
          type: "object",
          required: ["id", "overallIndex", "snapshotAt"],
          properties: {
            id: { type: "integer" },
            overallIndex: { type: "number" },
            overallCiLow: { type: "number", nullable: true },
            overallCiHigh: { type: "number", nullable: true },
            marketSentiment: { type: "number", nullable: true },
            volatility: { type: "number", nullable: true },
            methodologyVersion: { type: "string" },
            snapshotAt: { type: "string", format: "date-time" },
            industryBreakdowns: { type: "object", additionalProperties: true },
          },
        },
        MacroEvent: {
          type: "object",
          required: ["id", "eventType", "severity", "title"],
          properties: {
            id: { type: "integer" },
            eventType: { type: "string" },
            severity: { type: "number" },
            title: { type: "string" },
            description: { type: "string" },
            affectedIndustryIds: { type: "array", items: { type: "integer" } },
            affectedCapabilityIds: { type: "array", items: { type: "integer" } },
            sentimentDirection: { type: "string", enum: ["positive", "negative", "neutral"] },
            startedAt: { type: "string", format: "date-time" },
            decayDays: { type: "number" },
            source: { type: "string" },
            citations: { type: "array", items: { type: "string" } },
          },
        },
        ValueChainStage: {
          type: "object",
          required: ["id", "industryId", "stageName", "stageOrder"],
          properties: {
            id: { type: "integer" },
            industryId: { type: "integer" },
            stageName: { type: "string" },
            stageOrder: { type: "integer" },
            disruptionSummary: { type: "string" },
            hhiScore: { type: "number", nullable: true },
            patentCount: { type: "integer", nullable: true },
            startupCount: { type: "integer", nullable: true },
            capitalFlowMm: { type: "number", nullable: true },
            shifts: { type: "array", items: { type: "string" }, nullable: true },
            risks: { type: "array", items: { type: "string" }, nullable: true },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
      parameters: {
        Limit: {
          name: "limit",
          in: "query",
          description: "Page size. Most endpoints cap at 500; /cei/history caps at 1000.",
          schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        },
        Offset: {
          name: "offset",
          in: "query",
          schema: { type: "integer", minimum: 0, default: 0 },
        },
      },
      responses: {
        Unauthorized: { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Forbidden: { description: "Key lacks required scope", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        TooManyRequests: { description: "Rate limit or monthly quota exceeded", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    paths: {
      "/v1/industries": {
        get: {
          summary: "List industries",
          description: "Returns the canonical industry taxonomy. Read-only.",
          tags: ["Industries"],
          parameters: [{ $ref: "#/components/parameters/Limit" }, { $ref: "#/components/parameters/Offset" }],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Industry" } },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/industries/{slug}": {
        get: {
          summary: "Get an industry by slug",
          tags: ["Industries"],
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Industry" } } } },
            404: { description: "Not found" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/capabilities": {
        get: {
          summary: "List capabilities",
          description: "Filter by industryId or industry slug. Read-only.",
          tags: ["Capabilities"],
          parameters: [
            { name: "industryId", in: "query", schema: { type: "integer" } },
            { name: "industrySlug", in: "query", schema: { type: "string" } },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Offset" },
          ],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Capability" } },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/capabilities/{id}": {
        get: {
          summary: "Get a capability by id",
          tags: ["Capabilities"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Capability" } } } },
            404: { description: "Not found" },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/cei/current": {
        get: {
          summary: "Latest Capability Economic Index snapshot",
          description: "Returns the most recent CEI snapshot with industry breakdowns.",
          tags: ["CEI"],
          responses: {
            200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/CeiSnapshot" } } } },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/cei/history": {
        get: {
          summary: "Historical CEI snapshots",
          description: "Filter by date range. Returns up to `limit` snapshots ordered most-recent first.",
          tags: ["CEI"],
          parameters: [
            { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 } },
          ],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/CeiSnapshot" } },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/macro-events": {
        get: {
          summary: "List macro events",
          tags: ["Macro Events"],
          parameters: [
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "industryId", in: "query", schema: { type: "integer" } },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Offset" },
          ],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/MacroEvent" } },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/value-chain-stages": {
        get: {
          summary: "List value-chain stages",
          tags: ["Value Chain"],
          parameters: [
            { name: "industryId", in: "query", schema: { type: "integer" } },
            { $ref: "#/components/parameters/Limit" },
            { $ref: "#/components/parameters/Offset" },
          ],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/ValueChainStage" } },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
      "/v1/me": {
        get: {
          summary: "Inspect the calling API key",
          description:
            "Returns the key's scopes, rate limit, and current monthly usage. Available to any valid key — does not require a specific scope, but is rate-limited and quota-counted like any other call.",
          tags: ["Meta"],
          responses: {
            200: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      keyId: { type: "integer" },
                      scopes: { type: "array", items: { type: "string" } },
                      rateLimitPerMin: { type: "integer", nullable: true },
                      monthlyQuota: { type: "integer", nullable: true },
                      monthlyUsageCount: { type: "integer" },
                      quotaResetAt: { type: "string", format: "date-time", nullable: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            429: { $ref: "#/components/responses/TooManyRequests" },
          },
        },
      },
    },
  };
}
