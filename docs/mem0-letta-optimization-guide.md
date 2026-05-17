# Mem0 and Letta Optimization Guide

**Repository:** `smithdouglas404/Capability-Economics-Guide`
**Date:** May 2026
**Scope:** Comprehensive analysis of the current Mem0 and Letta integration with actionable optimization strategies and full, ready-to-paste TypeScript implementation snippets.

---

## 1. Current Architecture Overview

The repository implements a sophisticated, multi-layered memory system for the CVI Autonomous Agent — a LangGraph state machine that runs every 30 minutes to research and score industry capabilities. The memory architecture spans three distinct layers that work in concert:

| Layer | Technology | Files | Role |
|---|---|---|---|
| **Semantic Memory** | Mem0 (self-hosted v2.0.2) | `memory.ts` | Stores and retrieves episodic observations, patterns, and validated insights via vector similarity |
| **Stateful Working Memory** | Letta (self-hosted) | `letta.ts` | Maintains persistent in-context blocks: `persona`, `industry_priors`, `research_strategy`, `current_focus` |
| **Structural Knowledge Graph** | Custom PostgreSQL | `graphMemory.ts` | Tracks entity relationships (industries, capabilities, concepts) with weighted evidence |
| **Background Consolidation** | Custom Scheduler | `consolidator.ts` | Runs daily to synthesize raw observations into `validated_pattern` memories via Claude |

The agent graph follows the state machine: `evaluate → recall → decide → research → compute → reflect → memorize → finalize`. Both Mem0 and Letta are wired into multiple nodes of this pipeline, and both gracefully degrade when unavailable.

---

## 2. What Your Code Is Already Doing Well

Before identifying gaps, it is worth acknowledging the architectural strengths already present in the codebase.

**Dual-write with local fallback.** Every `storeMemory` call writes to Mem0 first, then mirrors to the local `agent_memories` PostgreSQL table with the `mem0Id` as a foreign key. If Mem0 is unreachable, the local DB takes over as the authoritative store. This is a production-grade pattern that prevents data loss during service restarts or network partitions.

**Graceful degradation throughout.** Neither `MEM0_API_KEY` nor `LETTA_BASE_URL` being absent causes the process to crash. The `isMem0Available()` and `LETTA_ENABLED` guards ensure the agent continues operating on local data alone. This is explicitly documented in `CLAUDE.md` as a load-bearing invariant.

**Hybrid retrieval.** The `recallMemories` function first queries Mem0 for semantic similarity results, then supplements with local keyword-scored results if the Mem0 result set is below the requested limit. This hybrid approach is aligned with the 2026 state-of-the-art in agent memory, which shows that multi-signal retrieval (semantic + keyword + entity matching) outperforms any single signal [1].

**Sleeptime consolidation pattern.** The `consolidator.ts` module implements the core idea behind Letta's official sleep-time compute feature: a background process that runs outside the hot path to synthesize and compress raw observations into higher-quality, longer-lived patterns. The use of Claude Haiku for synthesis with a deterministic statistical fallback is a well-designed resilience pattern.

**Graph memory for structural reasoning.** The custom `graphMemory.ts` layer records entity-level co-occurrence and correlation data that pure vector search cannot capture. This is particularly valuable for the CVI use case, where understanding that "AI Adoption in Healthcare" and "Regulatory Compliance" are structurally linked is more useful than semantic similarity alone.

---

## 3. Mem0 Optimization Implementations

### 3.1. Upgrade to Enhanced Metadata Filtering

**Current gap.** The `recallMemories` function passes only `agent_id`, `run_id`, and `limit` to the Mem0 `/search` endpoint. Post-retrieval filtering by `memoryType` and `category` is done in TypeScript after the API returns results. This means Mem0 may return 10 results, several of which are immediately discarded, wasting both the retrieval budget and downstream LLM context.

**Available feature.** Mem0 v1.0.0 introduced enhanced metadata filtering with full logical operators (`AND`, `OR`, `NOT`) and comparison operators (`gt`, `gte`, `lt`, `lte`, `eq`, `ne`, `in`, `nin`, `contains`, `icontains`) [2]. These filters are evaluated at the vector store level before results are returned.

**Implementation Snippet:** Replace the `recallMemories` function in `artifacts/api-server/src/services/agent/memory.ts` (around line 266):

```typescript
export async function recallMemories(
  query: string,
  type?: MemoryType,
  limit: number = 10,
  options: {
    runId?: number;
    category?: MemoryCategory;
    minConfidence?: number;
    createdAfter?: Date;
  } = {},
): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];

  if (isMem0Available()) {
    try {
      // Build Mem0 v1.0.0+ enhanced metadata filters
      const andClauses: Record<string, unknown>[] = [
        { agent_id: MEM0_AGENT_ID },
      ];
      if (options.runId) andClauses.push({ run_id: `cycle-${options.runId}` });
      if (type) andClauses.push({ metadata: { memoryType: type } });
      if (options.category) andClauses.push({ metadata: { category: options.category } });
      if (options.minConfidence) {
        andClauses.push({ metadata: { confidence: { gte: options.minConfidence } } });
      }
      if (options.createdAfter) {
        andClauses.push({ created_at: { gte: options.createdAfter.toISOString() } });
      }

      const res = await mem0Fetch("/search", "POST", {
        query,
        filters: { AND: andClauses },
        limit,
      }) as { results?: Array<{ id?: string; memory?: string; score?: number; metadata?: Record<string, unknown>; created_at?: string }> };

      for (const m of res?.results ?? []) {
        const meta = m.metadata || {};
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: (meta.memoryType as string) || type || "observation",
          category: (meta.category as string) ?? null,
          runScope: (meta.runId as string) || null,
          content: m.memory || "",
          metadata: meta,
          relevanceScore: m.score ?? 0.8,
          accessCount: 0,
          createdAt: m.created_at ? new Date(m.created_at) : new Date(),
          source: "mem0",
          mem0Id: m.id ?? null,
        });
      }
      console.log(`[Mem0] recalled ${results.length} for "${query.slice(0, 50)}"`);
      if (results.length >= limit) return results.slice(0, limit);
    } catch (err) {
      console.error("[Mem0] search failed, falling back to local DB:", err instanceof Error ? err.message : err);
    }
  }

  // ... (keep existing local DB fallback logic)
```

### 3.2. Adopt Multi-Signal Retrieval

**Current gap.** The Mem0 search call uses only semantic similarity (vector search). The 2026 Mem0 research paper reports that their new multi-signal retrieval algorithm — which fuses semantic similarity, keyword matching, and entity matching in parallel — achieved +29.6 points improvement on temporal reasoning and +23.1 points on multi-hop queries [1].

**Implementation Snippet:** Update the `MEM0_VERSION` build argument in `mem0/Dockerfile` to the latest stable release (v2.1.0 or higher) to enable this improvement without any code changes:

```dockerfile
# In mem0/Dockerfile
ARG MEM0_VERSION=v2.1.0   # Upgrade from v2.0.2 to get multi-signal retrieval
```

### 3.3. Add `topic` Metadata to All Observation Stores

**Current gap.** The `consolidator.ts` groups observations by `industryName::capabilityName::topic`, but the `topic` field defaults to `"general"` for most observations because upstream `storeMemory` calls in `reflect.ts` and `tools.ts` do not populate `metadata.topic`.

**Implementation Snippet:** Add a topic inference utility and apply it in `artifacts/api-server/src/services/agent/reflect.ts` (around line 88):

```typescript
// Add this helper function
function inferTopic(content: string): string {
  const lower = content.toLowerCase();
  if (/regulat|compliance|policy|legislation|law|sec|gdpr/.test(lower)) return "regulatory";
  if (/acqui|merger|m&a|deal|buyout|ipo/.test(lower)) return "m_and_a";
  if (/talent|hiring|workforce|skill|headcount|layoff/.test(lower)) return "talent";
  if (/automat|ai adoption|llm|generative|model|copilot/.test(lower)) return "ai_adoption";
  if (/cloud|infrastructure|platform|migration|saas/.test(lower)) return "infrastructure";
  if (/revenue|earnings|margin|profit|cost|pricing/.test(lower)) return "financial";
  return "general";
}

// Update the storeMemory call in reflectOnFindings
      const memoryContent = isRefinement
        ? `Refined: ${f.capabilityName} (${f.industryName}) holds at ~${f.newScore.toFixed(1)} with ${f.confidence.toFixed(2)} confidence. Prior signals corroborate.`
        : `${f.capabilityName} in ${f.industryName} scored ${f.newScore.toFixed(1)} with confidence ${f.confidence.toFixed(2)}. Captured during run #${runId}.`;
      
      await storeMemory(
        "pattern",
        memoryContent,
        {
          capabilityId: f.capabilityId,
          capabilityName: f.capabilityName,
          industryId: f.industryId,
          industryName: f.industryName,
          score: f.newScore,
          confidence: f.confidence,
          isRefinement,
          topic: inferTopic(memoryContent), // NEW: Infer and store topic
        },
        { category: tier, runId },
      );
```

### 3.4. Implement Memory Staleness Expiry in Mem0

**Current gap.** The `storeMemory` function sets a `ttlDays` value (default 90 days) and stores an `expiresAt` timestamp in the local `agent_memories` table. However, this TTL is not passed to Mem0 — memories in Mem0 never expire unless explicitly deleted.

**Implementation Snippet:** Update `storeMemory` in `artifacts/api-server/src/services/agent/memory.ts` (around line 177) to pass the expiry timestamp to Mem0:

```typescript
        metadata: {
          ...metadata,
          memoryType: type,
          category: category ?? type,
          runId: runId ?? null,
          ttlDays,
          expiresAt: expiresAt.toISOString(), // NEW: Pass expiry to Mem0
        },
```

Then, create a new cron job or add to `consolidator.ts` to periodically clean up expired Mem0 memories:

```typescript
// Add to consolidator.ts or a new cleanup script
export async function cleanupExpiredMem0Memories(): Promise<number> {
  if (!isMem0Available()) return 0;
  let deletedCount = 0;
  try {
    // Find memories where expiresAt is in the past
    const filters = {
      AND: [
        { agent_id: MEM0_AGENT_ID },
        { metadata: { expiresAt: { lt: new Date().toISOString() } } }
      ]
    };
    
    const res = await mem0Fetch("/search", "POST", {
      query: "", // Empty query to match all that fit the filter
      filters,
      limit: 100,
    }) as { results?: Array<{ id?: string }> };
    
    for (const m of res?.results ?? []) {
      if (m.id) {
        await deleteMemory(m.id);
        deletedCount++;
      }
    }
    console.log(`[Mem0] Cleaned up ${deletedCount} expired memories`);
  } catch (err) {
    console.error("[Mem0] Cleanup failed:", err instanceof Error ? err.message : err);
  }
  return deletedCount;
}
```

---

## 4. Letta Optimization Implementations

### 4.1. Enable Native Sleep-Time Agents

**Current gap.** The `consolidator.ts` module implements a manual sleep-time pattern. Letta now natively supports sleep-time agents [4]. When `enable_sleeptime: true` is set on an agent, Letta automatically creates a background "sleep-time agent" that shares the primary agent's memory blocks.

**Implementation Snippet:** Update the agent creation logic in `artifacts/api-server/src/services/agent/letta.ts` (around line 142):

```typescript
      const newAgent = await (lettaClient.agents as unknown as {
        create: (body: Record<string, unknown>) => Promise<{ id: string; managed_group?: { id: string } }>;
      }).create({
        name: LETTA_AGENT_NAME,
        description: "CVI Autonomous Agent — tracks capability economics patterns, institutional memory, and research decisions.",
        include_base_tools: true,
        model: LETTA_MODEL,
        embedding: LETTA_EMBEDDING,
        enable_sleeptime: true, // NEW: Enable native sleep-time consolidation
        memory_blocks: CORE_BLOCKS.map((b) => ({
          label: b.label,
          value: b.value,
          description: b.description,
          limit: b.limit,
        })),
      });
      lettaAgentId = newAgent.id;
      console.log(`[Letta] Connected — created agent "${LETTA_AGENT_NAME}" (${lettaAgentId}) with ${CORE_BLOCKS.length} blocks`);

      // NEW: Configure sleep-time frequency
      if (newAgent.managed_group?.id) {
        try {
          await (lettaClient.groups as unknown as {
            update: (groupId: string, config: Record<string, unknown>) => Promise<unknown>;
          }).update(newAgent.managed_group.id, {
            manager_config: { sleeptime_agent_frequency: 1 }, // Run after every primary agent step
          });
          console.log(`[Letta] Sleep-time agent enabled for group ${newAgent.managed_group.id}`);
        } catch (err) {
          console.log(`[Letta] Sleep-time configuration failed (non-fatal): ${err instanceof Error ? err.message : err}`);
        }
      }
```

### 4.2. Add a `market_context` Core Block

**Current gap.** There is no block for real-time market context — macro events, regulatory changes, or breaking news that should influence the current cycle's research priorities.

**Implementation Snippet:** Update the `CORE_BLOCKS` array in `artifacts/api-server/src/services/agent/letta.ts` (around line 28):

```typescript
export type CoreBlockLabel = "persona" | "industry_priors" | "research_strategy" | "current_focus" | "market_context";

const CORE_BLOCKS: Array<{ label: CoreBlockLabel; value: string; description: string; limit: number; read_only?: boolean }> = [
  // ... existing blocks ...
  {
    label: "market_context",
    value: "(empty — populated by the scheduler when macro events are detected)",
    description: "Current macro-economic and regulatory context that should bias this cycle's research priorities. Updated when significant market events are detected. Examples: Fed rate decision, major regulatory ruling, sector-wide earnings surprise.",
    limit: 3000,
  },
];
```

Then, update this block from the macro-events service or scheduler when new events are detected:

```typescript
// Example integration in scheduler.ts or macro-events.ts
import { lettaUpdateBlock } from "./letta";
import { listActiveEvents } from "../macro-events";

export async function updateMarketContextBlock(): Promise<void> {
  const activeEvents = await listActiveEvents();
  if (activeEvents.length === 0) return;
  
  const summary = activeEvents
    .slice(0, 5)
    .map(e => `- [${e.severity.toFixed(1)}] ${e.title} (${e.eventType})`)
    .join("\n");
    
  await lettaUpdateBlock("market_context", `Active Macro Events:\n${summary}`);
}
```

### 4.3. Implement Read-Only Policy Blocks

**Current gap.** The `research_strategy` block is both read and written by the agent. This means the agent could theoretically overwrite its own research strategy with incorrect or degraded content.

**Implementation Snippet:** Update the `ensureCoreBlocks` function in `artifacts/api-server/src/services/agent/letta.ts` (around line 95) to support the `read_only` flag:

```typescript
// First, update CORE_BLOCKS definition to include read_only
const CORE_BLOCKS: Array<{ label: CoreBlockLabel; value: string; description: string; limit: number; read_only?: boolean }> = [
  {
    label: "persona",
    value: "...",
    description: "Identity and reasoning style for the agent.",
    limit: 4000,
    read_only: true, // NEW
  },
  // ... industry_priors (writable) ...
  {
    label: "research_strategy",
    value: "...",
    description: "How the agent decides what to research, what to recall, and what to consolidate.",
    limit: 4000,
    read_only: true, // NEW
  },
  // ... current_focus (writable) ...
];

// Then update ensureCoreBlocks
        const created = await (lettaClient.blocks as unknown as {
          create: (body: { label: string; value: string; description?: string; limit?: number; read_only?: boolean }) => Promise<{ id: string }>;
        }).create({
          label: block.label,
          value: block.value,
          description: block.description,
          limit: block.limit,
          read_only: block.read_only, // NEW: Pass read_only flag
        });
```

### 4.4. Expose Block Contents via the Admin API

**Current gap.** The `getLettaStatus()` function returns only the block labels, not their current values, making debugging difficult.

**Implementation Snippet:** Add a `lettaReadAllBlocks()` function to `artifacts/api-server/src/services/agent/letta.ts`:

```typescript
export async function lettaReadAllBlocks(): Promise<Record<CoreBlockLabel, string | null>> {
  if (!lettaConnected && !await initLettaClient()) {
    return { persona: null, industry_priors: null, research_strategy: null, current_focus: null, market_context: null };
  }
  const results: Record<string, string | null> = {};
  for (const block of CORE_BLOCKS) {
    results[block.label] = await lettaReadBlock(block.label as CoreBlockLabel);
  }
  return results as Record<CoreBlockLabel, string | null>;
}
```

Then expose this in `artifacts/api-server/src/routes/agent.ts` (in the `/memory/stats` endpoint):

```typescript
// In routes/agent.ts
import { lettaReadAllBlocks } from "../services/agent/letta";

router.get("/memory/stats", async (req, res) => {
  // ... existing stats gathering ...
  const lettaBlocks = await lettaReadAllBlocks(); // NEW
  
  res.json({
    // ... existing response ...
    lettaBlocks, // NEW: Include full block contents in response
  });
});
```

### 4.5. Strengthen the Health Probe with Latency Thresholds

**Current gap.** The health probe in `probes.ts` classifies Mem0 and Letta as `ok` even if they are extremely slow, which can functionally degrade the agent's 30-minute cycle.

**Implementation Snippet:** Update the probes in `artifacts/api-server/src/services/health/probes.ts` (around line 89):

```typescript
const MEM0_LATENCY_WARN_MS = 2000;   // Warn if Mem0 takes > 2s
const LETTA_LATENCY_WARN_MS = 5000;  // Warn if Letta takes > 5s

const probeMem0: Probe = async () => {
  if (!isMem0Available()) {
    return { status: "not_configured", latencyMs: null, lastError: "MEM0_BASE_URL or MEM0_API_KEY not set" };
  }
  try {
    const { latencyMs } = await timed(() => withTimeout(mem0Ping(), PROBE_TIMEOUT_MS, "mem0"));
    // NEW: Latency threshold check
    if (latencyMs > MEM0_LATENCY_WARN_MS) {
      return { status: "degraded", latencyMs, lastError: `High latency: ${latencyMs}ms (threshold: ${MEM0_LATENCY_WARN_MS}ms)` };
    }
    return { status: "ok", latencyMs, lastError: null };
  } catch (err) {
    // ... existing error handling ...
  }
};

const probeLetta: Probe = async () => {
  const { value, latencyMs } = await timed(() => withTimeout(lettaPing(), PROBE_TIMEOUT_MS, "letta"));
  if (!value.configured) {
    return { status: "not_configured", latencyMs: null, lastError: "LETTA_API_KEY and LETTA_BASE_URL not set" };
  }
  if (value.ok) {
    // NEW: Latency threshold check
    if (latencyMs > LETTA_LATENCY_WARN_MS) {
      return { status: "degraded", latencyMs, lastError: `High latency: ${latencyMs}ms (threshold: ${LETTA_LATENCY_WARN_MS}ms)` };
    }
    return { status: "ok", latencyMs, lastError: null };
  }
  // ... existing error handling ...
};
```

---

## 5. References

[1] Mem0 Engineering Team. "State of AI Agent Memory 2026: Benchmarks, Architectures & Production Gaps." *Mem0 Blog*, April 1, 2026. https://mem0.ai/blog/state-of-ai-agent-memory-2026

[2] Mem0 Documentation. "Enhanced Metadata Filtering." https://docs.mem0.ai/open-source/features/metadata-filtering

[3] Mem0 Documentation. "Custom Categories." https://docs.mem0.ai/platform/features/custom-categories

[4] Letta Documentation. "Sleep-time agents." https://docs.letta.com/guides/agents/architectures/sleeptime/

[5] Letta Documentation. "Memory blocks (core memory)." https://docs.letta.com/guides/core-concepts/memory/memory-blocks/

[6] Letta Blog. "Remote Environments for Letta Code." https://www.letta.com/blog/remote-environments-for-letta-code

[7] Elemuwa, Fimber. "How to Design Multi-Agent Memory Systems for Production." *Mem0 Blog*, March 3, 2026. https://mem0.ai/blog/multi-agent-memory-systems

[8] Letta Blog. "Sleep-Time Compute." April 21, 2025. https://www.letta.com/blog/sleep-time-compute
