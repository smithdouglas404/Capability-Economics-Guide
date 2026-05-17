# Why LangMem is the Right Letta Replacement (and Why Zep Isn't)

**Repository:** `smithdouglas404/Capability-Economics-Guide`
**Date:** May 2026
**Scope:** A deep-dive architectural analysis of why LangMem fits the CVI Autonomous Agent's specific Letta usage patterns better than Zep, complete with TypeScript migration snippets.

---

## 1. The Core Architectural Mismatch with Zep

Zep is currently the state-of-the-art in agent memory, scoring 80.32% on the LoCoMo benchmark with sub-200ms latency [1]. Its Graphiti engine builds a temporal knowledge graph that automatically extracts entities, tracks relationships, and invalidates old facts when new ones arrive [1].

**So why not use Zep?** Because of what you have already built.

If you look at `artifacts/api-server/src/services/agent/graphMemory.ts` and `consolidator.ts`, you have already built a custom, domain-specific knowledge graph. Your code explicitly extracts `industry` and `capability` entities, tracks `co_occurs_with` relationships, and calculates statistical variance and stability over 30-day windows. 

Adopting Zep would mean throwing away your custom `graphMemory.ts` and `consolidator.ts` entirely. Zep is an "all-in-one" memory pipeline — it wants to ingest raw chat logs and build its own graph [1]. It does not easily allow you to inject your custom statistical variance calculations into its edge weights. Furthermore, Zep competes directly with Mem0. If you adopt Zep, you should also rip out Mem0, meaning a total rewrite of your entire memory stack.

## 2. Why LangMem is the Perfect Fit

If you look at `artifacts/api-server/src/services/agent/letta.ts`, you are using Letta for exactly one thing: **Stateful Working Memory**. You maintain four core blocks: `persona`, `industry_priors`, `research_strategy`, and `current_focus`. 

You are not using Letta's agent runtime to execute tool calls. Your actual agent runtime is a LangGraph state machine defined in `artifacts/api-server/src/services/agent/graph.ts`. 

**LangMem is the official memory SDK for LangGraph** [2]. It is designed to solve exactly the problem you are currently using Letta for: persisting state across different agent runs without taking over the entire agent architecture [3].

### The Three Advantages of LangMem for Your Codebase:

1. **Zero Infrastructure Changes:** LangMem uses LangGraph's `BaseStore` (specifically `PostgresStore`), which runs on the exact same PostgreSQL database you are already using for `agent_runs` and `agent_memories` [3]. You can delete the Letta Docker container entirely.
2. **Native TypeScript Support:** Unlike Letta, which requires a separate Python service and REST API calls, LangMem and LangGraph's `BaseStore` are native to the `@langchain/langgraph` TypeScript package you already have installed [4].
3. **Procedural Memory (The Killer Feature):** LangMem introduces "Procedural Memory" — the ability to automatically optimize an agent's instructions based on past performance [2]. Right now, your `research_strategy` block is static. With LangMem, the agent can rewrite its own research strategy over time based on which capabilities yielded the best insights.

---

## 3. How to Migrate from Letta to LangMem (TypeScript Implementation)

Here is exactly how you replace Letta with LangGraph's native `BaseStore` and LangMem in your codebase.

### Step 1: Replace Letta Blocks with LangGraph `BaseStore`

Currently, `letta.ts` makes HTTP calls to a separate Letta service to read and write blocks. We will replace this with LangGraph's `PostgresStore`, which organizes memories by namespace [3].

Create a new file `artifacts/api-server/src/services/agent/store.ts`:

```typescript
import { PostgresStore } from "@langchain/langgraph/store/postgres";
import { Pool } from "pg";

// Reuse your existing database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const agentStore = new PostgresStore(pool);

// The namespace scopes these memories to the CVI agent globally
const AGENT_NAMESPACE = ["agent", "cvi_core_blocks"];

export async function initAgentStore() {
  await agentStore.setup();
  
  // Initialize default blocks if they don't exist
  const existing = await agentStore.search(AGENT_NAMESPACE);
  if (existing.length === 0) {
    await agentStore.put(AGENT_NAMESPACE, "persona", {
      value: "I am the CVI Autonomous Agent — a senior capability economics analyst..."
    });
    await agentStore.put(AGENT_NAMESPACE, "research_strategy", {
      value: "Routine cycles: prioritize stale (>7d) capabilities..."
    });
    await agentStore.put(AGENT_NAMESPACE, "industry_priors", {
      value: "(empty — populated by the reflect node)"
    });
    await agentStore.put(AGENT_NAMESPACE, "current_focus", {
      value: "(initialized)"
    });
  }
}

export async function updateCoreBlock(label: string, value: string) {
  await agentStore.put(AGENT_NAMESPACE, label, { value });
}

export async function readCoreBlock(label: string): Promise<string | null> {
  const item = await agentStore.get(AGENT_NAMESPACE, label);
  return item?.value?.value as string | null;
}
```

### Step 2: Inject the Store into the LangGraph State Machine

In `artifacts/api-server/src/services/agent/graph.ts`, you currently call `lettaUpdateBlock` inside the `recallNode` and `reflectNode`. 

Update `graph.ts` to compile the graph with the new store, and update the nodes to use it:

```typescript
// In graph.ts
import { agentStore, updateCoreBlock, readCoreBlock } from "./store";

// 1. Compile the graph with the store
export const agentGraph = workflow.compile({ store: agentStore });

// 2. Update recallNode to use the store instead of Letta
async function recallNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // ... existing memory recall ...
  
  const top = state.targets.slice(0, 8).map(t => `${t.industryName}/${t.capabilityName}`).join(", ");
  await updateCoreBlock("current_focus", `Run #${state.runId} (${state.trigger}). Top targets: ${top}.`);
  
  return { recalledMemories: patterns };
}

// 3. Update reflectNode to use the store instead of Letta
async function reflectNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // ... existing reflection logic ...
  
  if (validated.length > 0) {
    const current = (await readCoreBlock("industry_priors")) || "";
    const newLines = validated.map(f => `- [${new Date().toISOString().slice(0, 10)}] ${f.industryName} :: ${f.capabilityName} → score ${f.newScore.toFixed(1)}`);
    const merged = (current + "\n" + newLines.join("\n")).split("\n").slice(-60).join("\n");
    await updateCoreBlock("industry_priors", merged);
    priorsUpdated = true;
  }
  
  // ...
}
```

### Step 3: Inject Blocks into the Agent's Context

Currently, Letta manages the system prompt automatically. With LangGraph, you inject the stored blocks into the LLM call yourself. If you have a node that calls the LLM (e.g., inside your tools or a new reasoning node), you retrieve the blocks from the store:

```typescript
import { SystemMessage } from "@langchain/core/messages";

async function callModelNode(state: AgentStateType, config: any) {
  // The store is available in the config object
  const store = config.store;
  
  // Retrieve all core blocks
  const persona = await store.get(["agent", "cvi_core_blocks"], "persona");
  const strategy = await store.get(["agent", "cvi_core_blocks"], "research_strategy");
  const priors = await store.get(["agent", "cvi_core_blocks"], "industry_priors");
  const focus = await store.get(["agent", "cvi_core_blocks"], "current_focus");
  
  const systemPrompt = `
    ${persona?.value?.value}
    
    Current Research Strategy:
    ${strategy?.value?.value}
    
    Validated Industry Priors:
    ${priors?.value?.value}
    
    Current Cycle Focus:
    ${focus?.value?.value}
  `;
  
  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    // ... state messages
  ]);
  
  return { messages: [response] };
}
```

### Step 4: Add Procedural Memory with LangMem (Optional but Recommended)

LangMem's standout feature is procedural memory — the ability to optimize the `research_strategy` block automatically based on past runs [2].

You can run a weekly cron job that uses LangMem to review the last 10 agent runs and propose improvements to the research strategy:

```typescript
// This requires the langmem Python SDK (currently Python-only, but can be called via a microservice or script)
// Alternatively, you can implement the procedural optimization logic natively in TS using an LLM call:

import { ChatAnthropic } from "@langchain/anthropic";

export async function optimizeResearchStrategy() {
  const currentStrategy = await readCoreBlock("research_strategy");
  
  // Fetch the last 10 completed runs from your agentRunsTable
  const recentRuns = await db.select().from(agentRunsTable).orderBy(desc(agentRunsTable.completedAt)).limit(10);
  
  const llm = new ChatAnthropic({ model: "claude-3-5-sonnet-latest" });
  
  const prompt = `
    You are an AI architect optimizing an autonomous agent's research strategy.
    
    Current Strategy:
    ${currentStrategy}
    
    Recent Run Outcomes:
    ${JSON.stringify(recentRuns.map(r => ({ researched: r.capabilitiesResearched, skipped: r.capabilitiesSkipped, errors: r.errorMessage })))}
    
    Based on these outcomes, propose an updated, more efficient research strategy. 
    Keep it under 4000 characters. Focus on prioritization rules.
  `;
  
  const response = await llm.invoke(prompt);
  await updateCoreBlock("research_strategy", response.content as string);
}
```

## Summary

By migrating to LangGraph's `BaseStore`, you eliminate the Letta infrastructure dependency, remove the network latency of HTTP calls to a separate memory service, and consolidate your entire agent state machine into native TypeScript. You keep Mem0 for semantic search, keep your custom graph for structural reasoning, and use LangGraph for stateful working memory.

---

## References

[1] Zep. "End-to-End Context Engineering." https://www.getzep.com/

[2] The LangChain Team. "LangMem SDK for agent long-term memory." *LangChain Blog*, February 18, 2025. https://www.langchain.com/blog/langmem-sdk-launch

[3] Vance, Austin. "Persistent Agent Memory in LangGraph." *Focused.io*, March 10, 2026. https://focused.io/lab/persistent-agent-memory-in-langgraph

[4] Atlan. "How to Add Long-Term Memory to LangChain Agents." *Atlan Learn*, April 8, 2026. https://atlan.com/know/long-term-memory-langchain-agents/
