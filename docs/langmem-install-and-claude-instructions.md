# LangMem: Installation Guide & CLAUDE.md Instructions

---

## Critical Fact: LangMem is Python-Only

**LangMem (`langmem` on PyPI, v0.0.30) is a Python library only.** There is no `langmem` package on npm. Your project (`@workspace/api-server`) is a TypeScript/Node.js monorepo, so you cannot `pnpm add langmem` and import it directly.

However, **you already have everything you need** to implement the same capabilities that LangMem provides. Here is the exact mapping:

| LangMem Python Feature | Your TypeScript Equivalent (already installed) |
|---|---|
| `InMemoryStore` / `AsyncPostgresStore` | `@langchain/langgraph` `BaseStore` + `@langchain/langgraph-checkpoint-postgres` |
| `create_manage_memory_tool` | Custom `storeMemoryTool` in `tools.ts` (already built) |
| `create_search_memory_tool` | Custom `recallMemoriesTool` in `tools.ts` (already built) |
| `create_prompt_optimizer` | Custom optimization loop using `langchain` + `ChatAnthropic` (needs building) |
| Namespaced memory | `BaseStore.put(namespace, key, value)` from `@langchain/langgraph` |

---

## Step 1: Install the Missing Packages

You need two packages that are **not yet in your `artifacts/api-server/package.json`**:

```bash
# Run from the repo root
cd /your-repo-root

pnpm --filter @workspace/api-server add @langchain/langgraph-checkpoint-postgres
pnpm --filter @workspace/api-server add @langchain/anthropic
```

**Why these two?**

- `@langchain/langgraph-checkpoint-postgres` gives you `PostgresSaver` (for agent run checkpointing) and `PostgresStore` (for the shared namespaced memory graph that replaces Letta blocks). It connects to your existing `DATABASE_URL` — no new service required.
- `@langchain/anthropic` gives you `ChatAnthropic` as a first-class LangChain model, which is needed to build the prompt optimizer loop. You currently call Anthropic via your custom `@workspace/integrations-anthropic-ai` wrapper, which is fine for direct calls but is not compatible with LangChain's `AgentExecutor`.

**Verify your existing packages are sufficient (they are):**

```
@langchain/core     ^1.1.39   ✓ already installed
@langchain/langgraph ^1.2.8   ✓ already installed  
langchain           ^1.3.1    ✓ already installed
```

---

## Step 2: Add the Shared Store to Your Project

Create a new file `artifacts/api-server/src/services/agent/store.ts`:

```typescript
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres";

// Singleton shared store — all agents read and write here
let _store: PostgresStore | null = null;

export function getSharedStore(): PostgresStore {
  if (!_store) {
    const connString = process.env.DATABASE_URL;
    if (!connString) throw new Error("DATABASE_URL is required for shared agent store");
    _store = new PostgresStore(connString);
  }
  return _store;
}

// Namespace helpers — keeps namespaces consistent across agents
export const NS = {
  // Shared knowledge written by one agent, read by all others
  industryPatterns: (industryName: string) => ["shared", "industry_patterns", industryName],
  macroEvents:      () => ["shared", "macro_events"],
  disruptionRisks:  () => ["shared", "disruption_risks"],
  peerBenchmarks:   () => ["shared", "peer_benchmarks"],

  // Per-agent private instructions (replaces Letta core blocks)
  agentPriors:      (agentName: string) => ["agent_priors", agentName],

  // Per-client private knowledge (VCE agent only)
  clientKnowledge:  (clientId: string) => ["client", clientId],
} as const;
```

---

## Step 3: The Prompt Optimizer (TypeScript equivalent of LangMem's `create_prompt_optimizer`)

Create `artifacts/api-server/src/services/agent/optimizer.ts`:

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { getSharedStore, NS } from "./store";
import { db } from "@workspace/db";
import { agentRunsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

/**
 * Reviews the last N agent run outcomes and rewrites the agent's
 * instruction block to improve future performance.
 * 
 * This is the TypeScript equivalent of LangMem's create_prompt_optimizer.
 * Run this as a weekly cron job for each agent.
 */
export async function optimizeAgentInstructions(agentName: string, lookbackRuns = 20): Promise<void> {
  const store = getSharedStore();
  const llm = new ChatAnthropic({ model: "claude-haiku-4-5" });

  // 1. Fetch recent run outcomes from your existing agent_runs table
  const recentRuns = await db
    .select()
    .from(agentRunsTable)
    .orderBy(desc(agentRunsTable.startedAt))
    .limit(lookbackRuns);

  if (recentRuns.length < 5) {
    console.log(`[Optimizer] Not enough runs to optimize ${agentName} (need 5, have ${recentRuns.length})`);
    return;
  }

  // 2. Read the current instructions for this agent
  const currentInstructions = await store.get(NS.agentPriors(agentName), "instructions");
  const currentText = (currentInstructions?.value as string) ?? "No instructions set yet.";

  // 3. Build a summary of what worked and what didn't
  const runSummaries = recentRuns.map(r => {
    const memoriesStored = (r as any).memoriesStored ?? 0;
    const perplexityCalls = (r as any).perplexityCalls ?? 0;
    const error = (r as any).error ?? null;
    const score = error ? 0.0 : Math.min(1.0, memoriesStored / 5); // simple heuristic
    return `Run ${r.id}: score=${score.toFixed(2)}, memories_stored=${memoriesStored}, perplexity_calls=${perplexityCalls}, error=${error ?? "none"}`;
  }).join("\n");

  // 4. Ask the LLM to rewrite the instructions based on the evidence
  const optimizerPrompt = `You are improving the instructions for an autonomous AI agent called "${agentName}".

CURRENT INSTRUCTIONS:
${currentText}

RECENT RUN PERFORMANCE (last ${recentRuns.length} runs):
${runSummaries}

Analyze the performance data. Identify patterns in what caused high-scoring runs vs low-scoring or errored runs.
Rewrite the instructions to improve future performance. Keep the same format and length.
Be specific — if low-confidence research is causing errors, add an instruction to skip low-confidence targets.
Output ONLY the new instructions text, nothing else.`;

  const response = await llm.invoke(optimizerPrompt);
  const newInstructions = response.content as string;

  // 5. Save the improved instructions
  await store.put(NS.agentPriors(agentName), "instructions", {
    value: newInstructions,
    optimizedAt: new Date().toISOString(),
    basedOnRuns: recentRuns.length,
  });

  console.log(`[Optimizer] Updated instructions for ${agentName} based on ${recentRuns.length} runs`);
}
```

---

## Step 4: Environment Variables to Add

No new services are required. Add these to your `.env` and Railway environment:

```env
# Already required — used by the new PostgresStore as well
DATABASE_URL=postgresql://...

# New — needed for @langchain/anthropic in the optimizer
ANTHROPIC_API_KEY=sk-ant-...

# Optional — enables LangSmith tracing for agent debugging
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=ls__...
LANGCHAIN_PROJECT=inflexcvi-agents
```

---

## What to Tell Claude in CLAUDE.md

Add the following section to your `CLAUDE.md` file, directly after the existing **Agent Architecture** section (after line 87):

---

```markdown
### LangMem / Shared Agent Store

**LangMem is Python-only and is NOT installed in this TypeScript project.** Do not attempt to `import { create_prompt_optimizer } from "langmem"` — it will not resolve.

The TypeScript equivalents are implemented in:
- `artifacts/api-server/src/services/agent/store.ts` — `PostgresStore` singleton with namespace helpers (`NS.*`). This is the shared blackboard all agents read from and write to.
- `artifacts/api-server/src/services/agent/optimizer.ts` — `optimizeAgentInstructions(agentName)` — the TypeScript equivalent of LangMem's `create_prompt_optimizer`. Reads recent `agent_runs`, scores them, and rewrites the agent's `NS.agentPriors(agentName)` block.

**Shared Store Namespaces:**
- `NS.industryPatterns(industryName)` — validated industry patterns published by the CVI Agent
- `NS.macroEvents()` — macro events discovered by the CVI Agent, read by the Disruption Agent
- `NS.disruptionRisks()` — disruption scores published by the Disruption Agent
- `NS.peerBenchmarks()` — cohort benchmarks published by the Peer Co-op Agent
- `NS.agentPriors(agentName)` — per-agent instruction blocks (replaces Letta core blocks)
- `NS.clientKnowledge(clientId)` — per-client private memory (VCE Agent only)

**Agent Architecture (Multi-Agent, No Central Supervisor):**
There is NO LangGraph supervisor routing between agents. Each agent is autonomous:
1. Agents run on their own `setInterval` schedules (see `lifecycle.ts`)
2. Agents publish discoveries to the shared `PostgresStore` via `NS.*` namespaces
3. Agents read from the shared store at the start of each run to benefit from other agents' work
4. The `optimizeAgentInstructions()` function runs weekly per agent to improve their instructions

**Do NOT add a LangGraph supervisor node.** If you need agents to coordinate, use the shared store as the communication channel.

**Letta is still running** for backward compatibility. The `NS.agentPriors` store is the forward path — new agents should use `store.ts`, not `letta.ts`. Do not remove `letta.ts` until all blocks are migrated.
```

---

## Summary: What You Actually Need to Do

| Step | Command / Action | Time |
|---|---|---|
| 1 | `pnpm --filter @workspace/api-server add @langchain/langgraph-checkpoint-postgres @langchain/anthropic` | 2 min |
| 2 | Create `store.ts` with `PostgresStore` singleton and `NS` namespace helpers | 30 min |
| 3 | Create `optimizer.ts` with `optimizeAgentInstructions()` | 30 min |
| 4 | Add `ANTHROPIC_API_KEY` to Railway env (you likely already have it as `ANTHROPIC_API_KEY` via `@workspace/integrations-anthropic-ai`) | 5 min |
| 5 | Add the CLAUDE.md section above so Claude knows not to import `langmem` | 5 min |
| 6 | Wire `optimizeAgentInstructions("cvi-agent")` into the weekly cron in `lifecycle.ts` | 20 min |
