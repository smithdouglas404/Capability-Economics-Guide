# Replacing Letta with LangGraph PostgresStore

**Repository:** `smithdouglas404/Capability-Economics-Guide`
**Date:** May 2026

This guide explains exactly how to remove Letta from your codebase, what needs to be installed (and where), and the precise instructions to give Claude to execute the migration safely.

---

## 1. Environment Clarification: Local vs. Railway

You asked: *"Do I need to also install langgraph, langchain and langmem on my railway environment?"*

**The short answer is NO.** You do not need to install anything directly on Railway.

Here is how your deployment works based on your `Dockerfile` and `railway.json`:
1. Railway pulls your code from GitHub.
2. Railway runs `pnpm install --frozen-lockfile` inside the Docker container.
3. This command reads your `package.json` and `pnpm-workspace.yaml` and installs all dependencies automatically.

**What you must do:** You only need to add the packages to your `package.json` locally and push to GitHub. Railway will handle the rest during the next build.

**What about LangMem?** As established, LangMem is Python-only. You will **not** install it anywhere. You will use `@langchain/langgraph-checkpoint-postgres` instead.

### The Only Commands You Need to Run Locally

Run these in your terminal at the root of your project:

```bash
pnpm --filter @workspace/api-server add @langchain/langgraph-checkpoint-postgres
pnpm --filter @workspace/api-server add @langchain/anthropic
```

Then commit and push to GitHub. Railway will install them automatically.

---

## 2. The Letta Replacement Surface

Based on a full scan of your codebase, Letta is currently imported in **6 files**. To replace Letta, Claude must update these files to use the new `PostgresStore` instead.

| File | Current Letta Usage | New PostgresStore Usage |
|---|---|---|
| `routes/agent.ts` | `lettaReadBlock`, `getLettaStatus` | `store.get(NS.agentPriors("cvi-agent"), label)` |
| `routes/assess.ts` | `lettaSendMessage` | Remove (use direct LLM call or AgentExecutor) |
| `consolidator.ts` | `lettaArchivalInsert`, `lettaUpdateBlock`, `lettaReadBlock` | `store.put(NS.industryPatterns(...))` |
| `agent/graph.ts` | `lettaUpdateBlock`, `lettaArchivalInsert` | `store.put(NS.agentPriors("cvi-agent"), "current_focus", ...)` |
| `agent/reflect.ts` | `lettaReadBlock`, `lettaUpdateBlock` | `store.put(NS.agentPriors("cvi-agent"), "industry_priors", ...)` |
| `enrichment/graph.ts` | `lettaUpdateBlock`, `lettaArchivalInsert` | `store.put(NS.agentPriors("enrichment-agent"), ...)` |
| `health/probes.ts` | `lettaPing` | `store.search(["shared"])` (simple DB ping) |

---

## 3. What to Tell Claude (CLAUDE.md Instructions)

To ensure Claude executes this migration perfectly without breaking your production environment, add the following text to your `CLAUDE.md` file under a new section titled **"Letta to PostgresStore Migration"**:

```markdown
### Letta to PostgresStore Migration

We are replacing the external Letta service with LangGraph's `PostgresStore` backed by our existing database. 

**CRITICAL RULES FOR THIS MIGRATION:**
1. **Do NOT import `langmem`.** It is a Python package and does not exist in this TypeScript monorepo.
2. **Do NOT add a LangGraph Supervisor.** Agents must remain autonomous and communicate via the shared `PostgresStore`.
3. **Do NOT delete `letta.ts` yet.** We will migrate file by file. Keep the Letta graceful degradation intact until the final step.

**The Migration Steps (Execute one at a time):**

**Step 1: Create the Store**
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

**Step 5: The Optimizer**
Create `artifacts/api-server/src/services/agent/optimizer.ts`. Implement `optimizeAgentInstructions(agentName)` using `ChatAnthropic` to read recent runs from `agent_runs` and rewrite the agent's instructions in the store. Wire this into `lifecycle.ts` to run weekly.

**Step 6: Cleanup**
Once all imports of `letta.ts` are gone, delete `letta.ts` and remove `@letta-ai/letta-client` from `package.json`.
```

---

## 4. What Happens to Your Railway Letta Service?

Once Claude completes Step 6 and you deploy the changes to Railway:
1. Your API server will no longer attempt to connect to Letta.
2. It will read and write agent memory directly to your existing PostgreSQL database using `PostgresStore`.
3. You can safely go into your Railway dashboard, find the `letta` service, and **delete it**. This will save you RAM and compute costs.
