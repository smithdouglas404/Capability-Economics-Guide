# How Agent Learning Feeds the CVI and Disruption Indexes

The Inflexcvi platform operates a continuous feedback loop where autonomous agents research the market, learn from the data (and from human overrides), and feed those learnings directly into the mathematical models that compute the **CVI (Capability Value Index)** and **DVX (Disruption Velocity Index)**.

This document explains exactly how the three memory layers — Mem0, PostgresStore, and the Prompt Optimizer — connect the agents to the indexes.

---

## The Three Memory Layers

### 1. Mem0 (Vector + Semantic Memory)

- **Stores**: raw observations, insights, and validated patterns from Perplexity research cycles.
- **How it works**: when the CVI Agent researches an industry, it stores findings via `storeMemory()`. Mem0 embeds these into pgvector. Future cycles use `recallMemories()` to pull relevant past findings so the agent doesn't start from scratch.
- **Code**: `artifacts/api-server/src/services/agent/memory.ts`
- **Deployment**: self-hosted Mem0 server (`MEM0_VERSION=v2.1.0`) backed by pgvector. Routes through OpenRouter for the embedding/LLM calls.

### 2. PostgresStore (Shared Blackboard Memory)

- **Stores**: per-agent standing instructions, decision priors, macro-event digests, disruption rankings, peer benchmarks, stack recommendations, ontology graph references.
- **How it works**: the replacement for Letta. Namespaced key-value store backed by the existing `DATABASE_URL` Postgres. Each agent publishes findings under `NS.<topic>(...)` for other agents to read. The Macro Event Agent publishes SEC filing digests; the Disruption Agent reads them.
- **Code**: `artifacts/api-server/src/services/agent/store.ts`
- **Backed by**: `@langchain/langgraph-checkpoint-postgres` v1.0.1 (the `/store` subpath, not the package root).

### 3. Prompt Optimizer (Procedural Memory)

- **Stores**: the actual system-prompt content for each agent — split into two distinct blocks per agent.
- **How it works**: a weekly cron job runs two independent passes per agent. Each pass rewrites a different block in `NS.agentPriors(agentName)`.
- **Code**: `artifacts/api-server/src/services/agent/optimizer.ts`

The two blocks are critical to understand correctly:

| Block key | Written by | Reads from | Purpose |
|---|---|---|---|
| `instructions` | `optimizeAgentInstructions()` | `agent_runs` (last 20) | Rewrite standing instructions based on what correlated with high-scoring runs vs errors |
| `decision_priors` | `learnFromHumanOverrides()` | `agent_proposals` (last 30 with `status="rejected"`) | Capture specific decisions humans have corrected the agent on |

**The agent's runtime system prompt should reference both blocks.** They do not clobber each other.

---

## Data Flow: From Research to Index

```
[CVI Agent run] → triangulate → source_triangulations table → [CVI Engine] → cvi_components / cvi_snapshots
                ↓                                                                   ↑
        storeMemory(Mem0)                                                  reads economic_rules
                ↓                                                          (Bayesian thresholds)
        recallMemories(Mem0) ← next cycle reads back

[Macro Event Agent] → publishes digest → NS.macroEvents() (PostgresStore)
                                                ↓
                                  [Disruption Agent reads digest]
                                                ↓
                                       runs DVX engine cycle
                                                ↓
                              dvx_components / dvx_snapshots tables
                                                ↓
                              publishes risk digest → NS.disruptionRisks()
                                                ↓
                              [Stack Optimizer Agent reads risk + peer benchmarks]
                                                ↓
                              recommends build/buy/outsource
                                                ↓
                              publishes → NS.sharedKnowledge("stack_recommendations")

[Ontology Agent] reads all of the above + extracts entities → memory_entities / memory_relations
                                                ↓
                              consumed by DVX Engine's Dependency Fragility factor
```

### 1. Feeding the CVI (Capability Value Index)

The CVI Engine (`artifacts/api-server/src/services/cvi-engine.ts`) computes a Bayesian consensus score for every capability based on four triangulation perspectives (Consulting, Market Data, Academic, Practitioner). Bayesian prior: mean=50, variance=1500.

How learning feeds it:
1. The CVI Agent runs a research cycle (`services/agent/graph.ts`).
2. `recallMemories()` pulls past `validated_pattern` memories from Mem0 to establish a baseline.
3. The `triangulateCapability` tool runs fresh Perplexity research.
4. New findings get written back to Mem0 via `storeMemory()`.
5. Mathematical scores land in the `source_triangulations` table.
6. The CVI Engine reads `source_triangulations`, applies the Bayesian update, and writes the final 0-1000 CVI score to `cvi_components`.
7. Thresholds the engine reasons against (CVI floor, posterior variance max, etc.) live in the admin-tunable `economic_rules` table and are surfaced to the agent via its `NS.agentPriors("cvi-autonomous-agent")` `economic_rules` block.

### 2. Feeding the DVX (Disruption Velocity Index)

The DVX Engine (`artifacts/api-server/src/services/dvx-engine.ts`) measures how fast a capability will be displaced. Three factors with weights stored in `economic_rules`:

- Velocity Divergence: 40%
- Dependency Fragility: 30%
- Pattern Match Confidence: 30%

How learning feeds it:
1. The Ontology Agent (`services/ontology-agent.ts`) reads all other agents' digests from PostgresStore and extracts entities + relationships into the custom graph layer (`services/agent/graphMemory.ts`).
2. Dependency edges flow into the DVX Engine's Dependency Fragility factor — if a capability's upstream dependencies are under disruption pressure, fragility rises.
3. The Disruption Agent (`services/disruption-agent.ts`) calls the DVX Engine's `computeDVX()` on its 60-minute cron.
4. Results land in `dvx_components` + `dvx_snapshots`, then get summarized into `NS.disruptionRisks()` for downstream agents.

### 3. Feeding the Disruption Risk Model

The Disruption Engine (`artifacts/api-server/src/services/disruption.ts`) computes a 0-1 probability based on lifecycle stage, velocity, macro events, and innovation pressure. Macro events get 20% weight.

How learning feeds it:
1. The Macro Event Agent (`services/macro-event-agent.ts`, 30-minute cron) monitors SEC filings and `macro_events` table entries, publishing digests to `NS.macroEvents()`.
2. The Disruption Agent reads those digests at the start of its cycle.
3. The Disruption Engine's `macroSeveritySum` factor is derived from the active macro events that the agent's digest surfaced.
4. The final probability dictates whether a capability is marked `low`, `moderate`, `high`, or `critical` risk per the thresholds in `economic_rules`.

---

## The Procedural Learning Loop

Two separate weekly cron paths, one for each block:

### Path A — Outcome-based instruction rewrites

1. Each cycle of every agent writes a row to `agent_runs` with `memoriesStored`, `perplexityCalls`, `industriesEvaluated`, `capabilitiesResearched`, `errorMessage`.
2. Weekly, `optimizeAgentInstructions(agentName)` pulls the last 20 rows for that agent.
3. Each run gets a heuristic score in `[0, 1]`: errored=0, otherwise `min(1, memoriesStored / 5)`.
4. The function asks Haiku 4.5 to rewrite the standing `instructions` block, biasing future runs toward whatever correlated with high scores.
5. New text lands in `NS.agentPriors(agentName)` key `"instructions"` with `optimizedAt`, `basedOnRuns` metadata.

### Path B — Human-override learning

1. A human admin reviews an `agent_proposals` row and clicks Reject in the admin UI (`/admin/agent/proposals`).
2. Their rationale lands in `reviewNotes`; `proposedBy` carries the agent name; `status` flips to `rejected`.
3. Weekly, `learnFromHumanOverrides(agentName)` queries rejected proposals where `proposedBy LIKE '<agentName>%'`.
4. It needs ≥3 rejections to fire (otherwise skips with a reason).
5. It feeds the rejection trajectories (agent rationale + payload + human override notes + reviewer + timestamp) to Haiku 4.5.
6. The LLM rewrites the `decision_priors` block to record principles like "When X situation arises, prefer Y over Z because [reason]" and cites the rejection IDs for traceability.
7. New text lands in `NS.agentPriors(agentName)` key `"decision_priors"` with `rewrittenAt`, `basedOnRejections`, `latestRejectionId` metadata.

### Example: Stack Optimizer Agent

1. The Stack Optimizer Agent recommends that a client "Buy" a specific capability and files a proposal via `propose_stack_change`.
2. A human consultant reviews in `/admin/agent/proposals`, disagrees, overrides to "Build", and rejects with a rationale ("vendor lock-in risk for this capability tier").
3. The proposal row flips to `status=rejected`, `reviewNotes="vendor lock-in risk..."`, `reviewedBy=<admin>`.
4. The next Sunday, `learnFromHumanOverrides("stack-optimizer-agent")` fires. It sees this rejection + any others, identifies the pattern, and rewrites the agent's `decision_priors` block to add "Avoid Buy recommendations on capabilities with elevated vendor lock-in risk; cite rejection #N".
5. On the next Stack Optimizer cycle, the agent boots with the new `decision_priors` baked into its system prompt and biases away from that mistake.

### Cost

For the full 6-agent set: ~12 Haiku calls per week (~$0.10). The optimizer is cheap by design.

---

## Summary

The agents do not just generate text — they generate **structured data** (triangulations, dependencies, macro severities) that directly parameterize the mathematical models. The three memory layers ensure that this data compounds over time:

- **Mem0** preserves the granular research evidence and lets cycles build on past findings.
- **PostgresStore** is the cross-agent blackboard plus the per-agent procedural memory (`instructions` + `decision_priors`).
- **The Optimizer's two paths** ensure the agents get smarter both from their own measurable outcomes (`agent_runs` → `instructions`) and from human corrections (`agent_proposals` rejections → `decision_priors`).

All of this runs without a LangGraph supervisor. Agents coordinate by reading/writing the shared store; their schedules are independent setIntervals in `services/agent/scheduler.ts`.
