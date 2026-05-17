# The Master Action Plan: Replacing Letta with LangChain

**Repository:** `smithdouglas404/Capability-Economics-Guide`
**Date:** May 2026

This document replaces all previous guidance. It is the single, definitive, step-by-step guide to migrating your agents off Letta and onto a decentralized LangChain architecture.

---

## Phase 1: What You Do (Local Terminal)

You only need to run two commands on your local machine. You do **not** need to install anything on Railway — Railway will automatically install these when you push your code.

**Step 1.1:** Open your terminal at the root of your project.
**Step 1.2:** Run these two commands:
```bash
pnpm --filter @workspace/api-server add @langchain/langgraph-checkpoint-postgres
pnpm --filter @workspace/api-server add @langchain/anthropic
```
**Step 1.3:** Commit the changes to `package.json` and `pnpm-lock.yaml` and push to GitHub.

*(Note: Do NOT install `langmem`. It is a Python package and will break your project.)*

---

## Phase 2: What You Tell Claude (CLAUDE.md)

Copy and paste the exact text below into your `CLAUDE.md` file. This tells Claude exactly how to rewrite your codebase without breaking anything.

```markdown
### Letta to LangChain Migration Instructions

We are replacing the external Letta service with a decentralized LangChain architecture. Agents will communicate via a shared `PostgresStore` (backed by our existing database) instead of a LangGraph Supervisor.

**CRITICAL RULES:**
1. **Do NOT import `langmem`.** It is a Python package and does not exist in this TypeScript monorepo.
2. **Do NOT add a LangGraph Supervisor.** Agents must remain autonomous and communicate via the shared `PostgresStore`.
3. **Do NOT delete `letta.ts` yet.** We will migrate file by file. Keep the Letta graceful degradation intact until the final step.

**Execute these steps one at a time:**

**Step 1: Create the Shared Store**
Create `artifacts/api-server/src/services/agent/store.ts`. It must export a singleton `getSharedStore()` that initializes `PostgresStore` from `@langchain/langgraph-checkpoint-postgres` using `process.env.DATABASE_URL`. It must also export an `NS` object with namespace helpers (e.g., `NS.agentPriors(agentName)`, `NS.industryPatterns(industryName)`).

**Step 2: Migrate `reflect.ts` and `consolidator.ts`**
Replace `lettaReadBlock` and `lettaUpdateBlock` with `store.get()` and `store.put()`. 
- `industry_priors` should move to `NS.agentPriors("cvi-agent")`.
- `lettaArchivalInsert` in the consolidator should be replaced by writing structured JSON to `NS.industryPatterns(industryName)`.

**Step 3: Migrate `graph.ts` and `enrichment/graph.ts`**
Replace `lettaUpdateBlock("current_focus", ...)` with `store.put(NS.agentPriors("cvi-agent"), "current_focus", ...)`.
Replace `lettaArchivalInsert` with writes to `NS.agentRuns(agentName)`.

**Step 4: Migrate Routes and Health Probes**
Update `routes/agent.ts` to read from the store instead of Letta. Update `health/probes.ts` to ping the store instead of `lettaPing`.

**Step 5: The Optimizer (Replacing LangMem)**
Create `artifacts/api-server/src/services/agent/optimizer.ts`. Implement `optimizeAgentInstructions(agentName)` using `ChatAnthropic` to read recent runs from `agent_runs` and rewrite the agent's instructions in the store. Wire this into `lifecycle.ts` to run weekly.

**Step 6: Cleanup**
Once all imports of `letta.ts` are gone, delete `letta.ts` and remove `@letta-ai/letta-client` from `package.json`.
```

---

## Phase 3: What You Do (Railway Dashboard)

Once Claude has completed all 6 steps above and you have pushed the final code to GitHub:

**Step 3.1:** Wait for Railway to finish building and deploying the new code.
**Step 3.2:** Verify your API is running and healthy.
**Step 3.3:** Go to your Railway project dashboard.
**Step 3.4:** Find the `letta` service.
**Step 3.5:** Delete the `letta` service entirely.

You are now running a fully autonomous, decentralized multi-agent system on your existing PostgreSQL database, with zero external dependencies other than your LLM provider.
