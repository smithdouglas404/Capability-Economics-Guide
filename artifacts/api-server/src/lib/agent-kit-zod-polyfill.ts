/**
 * Runtime polyfill that adds `z.toJSONSchema` to zod's root namespace.
 *
 * Why: @inngest/agent-kit 0.13.2 declares `"zod": ">=4 <5"` as a peer
 * dependency and at runtime calls `z.toJSONSchema(schema)` (a v4-only
 * API) to serialize tool parameter schemas. The catalog in this
 * monorepo pins `zod@3.25.76` — that release ships v4 surfaces via the
 * `zod/v4` SUBPATH but the root `import { z } from "zod"` still
 * exposes v3, which has no `toJSONSchema`. Hence the production error
 * we saw when triggering synthesis manually:
 *
 *   ERROR: external_exports2.toJSONSchema is not a function
 *
 * Without this polyfill, every AgentKit-network-driven agent has been
 * silently failing on every cron tick at the tool-registration step —
 * the synthesis brief being 52h stale is the most visible symptom.
 *
 * Implementation: monkey-patch the shared `z` namespace from "zod"
 * with a `toJSONSchema(schema, options?)` function that delegates to
 * `zod-to-json-schema`, the de-facto v3-zod → JSON Schema converter.
 * Module-level side effect; the first `import` of this file mutates
 * the cached zod module and every subsequent `import { z } from "zod"`
 * in the same process sees the patched namespace.
 *
 * Import this file FIRST in entry points (src/index.ts) before any
 * AgentKit consumer runs.
 *
 * When AgentKit eventually fixes their runtime to handle v3 schemas
 * OR when this codebase bumps zod to v4 in the catalog, this polyfill
 * can be deleted.
 */

import * as zodModule from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type ZodWithJsonSchema = typeof zodModule & {
  z: typeof zodModule.z & {
    toJSONSchema?: (schema: unknown, options?: unknown) => unknown;
  };
};

const mod = zodModule as ZodWithJsonSchema;

if (typeof mod.z.toJSONSchema !== "function") {
  Object.defineProperty(mod.z, "toJSONSchema", {
    value: (schema: unknown, options?: Record<string, unknown>) => {
      // zod-to-json-schema accepts a v3 ZodSchema + an options object.
      // AgentKit passes its own options shape; pass through unchanged
      // and let zod-to-json-schema ignore unknown keys.
      return zodToJsonSchema(
        schema as Parameters<typeof zodToJsonSchema>[0],
        options as Parameters<typeof zodToJsonSchema>[1],
      );
    },
    writable: false,
    configurable: true,
    enumerable: false,
  });
}
