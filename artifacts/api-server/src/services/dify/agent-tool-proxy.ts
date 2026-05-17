/**
 * Bridges Dify Workflow HTTP-Request nodes into the inflexcvi agent-tool
 * surface. Used by `/api/dify/callback/agent-tool-invoke`. The HMAC gate
 * on the callback route already authenticated the caller; this file just
 * dispatches.
 *
 * Kept in a separate file so the callback router doesn't transitively
 * import the entire agent stack (which has heavy LangChain deps) at boot
 * — the agent-tool-proxy is loaded lazily.
 *
 * Today only `recall_memories` and `store_memory` are wired (those map
 * onto `recallMemories` / `storeMemory` in `services/agent/memory.ts`).
 * The other three (`perplexity_research`, `compute_cvi`, `query_database`)
 * need a thin wrapper around the existing internals before being exposed —
 * tracked under Phase D follow-up.
 */

import { logger } from "../../lib/logger";
import type { MemoryType } from "../agent/memory";

type ToolArgs = Record<string, unknown>;

const VALID_MEMORY_TYPES: ReadonlySet<MemoryType> = new Set([
  "pattern",
  "observation",
  "insight",
  "decision_context",
]);

function coerceMemoryType(value: unknown, fallback: MemoryType): MemoryType {
  if (typeof value === "string" && VALID_MEMORY_TYPES.has(value as MemoryType)) {
    return value as MemoryType;
  }
  return fallback;
}

export async function invokeAgentTool(
  tool: string,
  args: ToolArgs,
): Promise<unknown> {
  switch (tool) {
    case "recall_memories": {
      const { recallMemories } = await import("../agent/memory");
      const query = String(args.query ?? "");
      if (!query) throw new Error("recall_memories requires a query");
      const limit = typeof args.limit === "number" ? args.limit : 5;
      const type = typeof args.type === "string"
        ? coerceMemoryType(args.type, "observation")
        : undefined;
      return await recallMemories(query, type, limit, {
        agentName: typeof args.agentName === "string" ? args.agentName : undefined,
      });
    }
    case "store_memory": {
      const { storeMemory } = await import("../agent/memory");
      const text = String(args.text ?? args.content ?? "");
      if (!text) throw new Error("store_memory requires text");
      const type = coerceMemoryType(args.type, "observation");
      const category = typeof args.category === "string" ? args.category : "dify_workflow_note";
      return await storeMemory(
        type,
        text,
        { source: "dify_workflow_callback" },
        {
          category: category as never,
          agentName: typeof args.agentName === "string" ? args.agentName : undefined,
        },
      );
    }
    case "perplexity_research":
    case "compute_cvi":
    case "query_database":
      logger.warn({ tool }, "[dify-agent-tool] tool not yet wired");
      throw new Error(`tool "${tool}" is not yet wired to Dify callbacks — track under Phase D`);
    default:
      logger.warn({ tool }, "[dify-agent-tool] unknown tool requested");
      throw new Error(`unknown tool: ${tool}`);
  }
}
