# The Master Action Plan: Letta Replacement & Multi-Agent Autonomy

**Repository:** `smithdouglas404/Capability-Economics-Guide`
**Date:** May 2026

This is the single, definitive guide. It covers exactly how to replace Letta with LangChain, and how to build the specialized autonomous agents that map perfectly to your platform's actual services.

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

Copy and paste the exact text below into your `CLAUDE.md` file. This tells Claude exactly how to rewrite your codebase to replace Letta and build the correct agents based on your existing services.

```markdown
### Letta Migration & Multi-Agent Architecture Instructions

We are replacing the external Letta service with a decentralized LangChain architecture. We are also expanding from two agents to a full suite of specialized autonomous agents that map directly to our core services.

**CRITICAL RULES:**
1. **Do NOT import `langmem`.** It is a Python package and does not exist in this TypeScript monorepo.
2. **Do NOT add a LangGraph Supervisor.** Agents must remain autonomous and communicate via the shared `PostgresStore`.
3. **Do NOT delete `letta.ts` yet.** We will migrate file by file. Keep the Letta graceful degradation intact until the final step.

**Execute these steps one at a time:**

**Step 1: Create the Shared Store (The Blackboard)**
Create `artifacts/api-server/src/services/agent/store.ts`. It must export a singleton `getSharedStore()` that initializes `PostgresStore` from `@langchain/langgraph-checkpoint-postgres` using `process.env.DATABASE_URL`. It must also export an `NS` object with namespace helpers (e.g., `NS.agentPriors(agentName)`, `NS.sharedKnowledge(topic)`).

**Step 2: Migrate Existing Letta Usage**
- Migrate `reflect.ts` and `consolidator.ts`: Replace `lettaReadBlock` and `lettaUpdateBlock` with `store.get()` and `store.put()`. Move `industry_priors` to `NS.agentPriors("cvi-agent")`.
- Migrate `graph.ts` and `enrichment/graph.ts`: Replace `lettaUpdateBlock("current_focus", ...)` with `store.put(NS.agentPriors("cvi-agent"), "current_focus", ...)`.
- Update `routes/agent.ts` and `health/probes.ts` to use the store instead of Letta.

**Step 3: Build the New Autonomous Agents**
Using LangChain's `AgentExecutor` (not LangGraph), build the following agents in `artifacts/api-server/src/services/`:
1. **Disruption Agent (`disruption-agent.ts`)**: Wraps the logic in `disruption.ts` and `dvx-engine.ts`. Reads `macro_events` from the shared store, calculates disruption probability and DVX scores for capabilities, and writes to `NS.sharedKnowledge("disruption_risks")`.
2. **Peer Co-op Agent (`peer-coop-agent.ts`)**: Wraps the logic in `peer-coop.ts`. Monitors `organization_capabilities`, calculates k-anonymity cohort benchmarks, and writes to `NS.sharedKnowledge("peer_benchmarks")`.
3. **Stack Optimizer Agent (`stack-optimizer-agent.ts`)**: Wraps the logic in `stack-optimizer.ts`. Reads marketplace listings and maturity scores to generate Build/Buy/Outsource recommendations.
4. **Macro Event Agent (`macro-event-agent.ts`)**: Wraps the logic in `macro-events.ts` and `edgar/rss-watcher.ts`. Monitors SEC filings and news feeds, detects macro events, and writes to `NS.sharedKnowledge("macro_events")`.
5. **Ontology Agent (`ontology-agent.ts`)**: Wraps the logic in `graphMemory.ts` and `foundry/sync.ts`. Reads all agent outputs and extracts semantic relationships into the knowledge graph.

**Step 4: The Optimizer (Replacing LangMem)**
Create `artifacts/api-server/src/services/agent/optimizer.ts`. Implement `optimizeAgentInstructions(agentName)` using `ChatAnthropic` to read recent runs from `agent_runs` and rewrite the agent's instructions in the store. Wire this into `scheduler.ts` to run weekly for all agents.

**Step 5: Human-in-the-Loop Learning**
Add a function `learnFromHumanOverrides()` to the optimizer. When a human consultant overrides a Stack Optimizer Agent recommendation, this function must read the trajectory, score it low, and rewrite the agent's `decision_priors` to incorporate the human's rationale.

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
