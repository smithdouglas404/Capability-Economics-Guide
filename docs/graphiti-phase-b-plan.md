# Graphiti Phase B Plan — Per-User Subgraphs

**Status**: planning doc; no code changes yet.
**Prereq**: Phase A landed 2026-05-25 (FalkorDB live, `USE_GRAPHITI_WORLD_MODEL=1`, disruption cascade routes through Graphiti).
**Decision needed**: scope, cost model, migration source.

## What Phase B is

Graphiti partitions its graph by `group_id`. Phase A wrote everything to `group_id="global"`. Phase B introduces a parallel namespace `group_id="user-{userId}"` so each user gets their own subgraph layered on top of the shared world model.

Why: per-user state (their assessments, their selected industry, their conversation history with agents, their custom capability annotations) currently lives in Postgres rows scattered across `organizations`, `organization_capabilities`, `session_*` tables. None of it is graph-queryable. Phase B brings it into Graphiti so:

1. Agents can search `['global', 'user-{id}']` in one call (Graphiti supports this natively — already documented in the Phase A wrapper's `search_nodes` tool).
2. Per-user world-model overlays — e.g. "this user's stack vs the industry consensus" — become single-graph traversals instead of cross-system JOINs.
3. Each user's interaction history with agents becomes a queryable knowledge graph instead of an opaque agent_memories blob.

## Scope decision

There are three flavors of Phase B. Each is incrementally more invasive:

### B1 — Per-user assessment overlay (smallest)

Mirror each user's `organization_capabilities` rows as `user-{userId}` subgraph nodes. Walk `(user-cap)-[:ASSESSES]->(:Capability)` to see what a user thinks of each cap. Used by: agents personalizing recommendations, comparison features ("what does the average user score this capability vs you").

**Cost**: low. Structural writes only (zero LLM). Per-user storage scales linearly with assessments (≤492 caps × per-user rows).
**Code touch**: `routes/assess.ts` adds a Graphiti dual-write alongside the Postgres write. New service `services/agent/userGraphSync.ts` mirroring the Phase A `capabilityGraphSync.ts` pattern.

### B2 — Per-user agent conversation episodes (medium)

Every meaningful agent interaction becomes a Graphiti episode in the user's subgraph. Currently those go to `agent_memories` + Mem0. Phase B2 adds Graphiti as the third store so the user's conversation history gains entity extraction + bitemporal queryability.

**Cost**: medium. Each interaction = 1 LLM extraction call. At ~10 interactions/active-user/day × Haiku 4.5 ≈ $0.01/user/day. Caps at active-user count.
**Code touch**: every agent's recall path gains an `addEpisode(group_id="user-{id}")` step. Tool calls in `services/agent/tools.ts` gain an optional `userId` param threading through to the wrapper.

### B3 — Per-user capability graph clones (largest)

Each user gets their own copy of the capability graph for branch-and-edit ("what if I rated `Supply Chain` differently"). Forked subgraph in `user-{id}` namespace; structural edges mirrored from `global`.

**Cost**: high. 492 nodes × 30 edges × N users. Adds substantial FalkorDB storage.
**Code touch**: bigger refactor; not recommended unless a feature explicitly needs forkable graphs.

**Recommendation**: ship B1 first as a clear-win, then evaluate B2 once we see how agents actually use the per-user overlay. Skip B3 until a feature demands it.

## Migration source

For B1, the seed data is `organization_capabilities` JOIN `organizations`. Per user:
- 1 `User` node in `user-{userId}` subgraph
- N `Assessment` nodes (one per capability the user has assessed)
- N `[:ASSESSES]` edges from each Assessment to the global `:Capability` with the same pgId

Backfill script: `scripts/src/backfill-graphiti-user-subgraphs.ts`. Reuses the MCP RPC pattern from Phase A. Same DRY_RUN flag.

For B2, no historical backfill — start writing forward only. Past agent_memories rows aren't worth the LLM cost to re-process.

## AgentKit tool surface

Today (Phase A): `query_graph({ operation: "search_world_model", ... })` defaults to `group_ids=["global"]`.

Phase B adds:
- `query_graph` gains a `userId` param. When set, group_ids becomes `["global", "user-{userId}"]`.
- New `record_user_observation` tool (writes to `user-{id}` only).
- Existing tools UNCHANGED for backward compat — adding `userId` is purely additive.

## Kill-switch

`USE_GRAPHITI_USER_SUBGRAPHS=1` env var (separate from `USE_GRAPHITI_WORLD_MODEL`). Disabled by default. Lets us scaffold + dual-write before flipping reads. Matches the Phase A safety pattern.

## Rollout sequence

1. Write `userGraphSync.ts` with `mirrorUser` + `mirrorAssessment` + `mirrorAssessmentRemoval` (mirrors the Phase A capability-graph-sync API surface).
2. Wire dual-write at `routes/assess.ts` POST/PATCH/DELETE handlers behind `USE_GRAPHITI_USER_SUBGRAPHS=1`.
3. Write `backfill-graphiti-user-subgraphs.ts`. DRY_RUN first.
4. Backfill prod (structural only, no LLM cost — zero risk).
5. Add `userId` param to `query_graph`. Existing callers unaffected.
6. Update 1–2 agent prompts to pass `userId` when handling a logged-in user's request. Observe behavior.
7. If B1 lands cleanly, plan B2 separately.

## Open questions

- **Anonymous sessions**: do they get a `session-{token}` subgraph too, or do anonymous interactions go to `global`? Current product has heavy anonymous traffic (the `session_token` flow). Suggest: no subgraph for anonymous until they convert to a real account.
- **Garbage collection**: when a user is deleted, do we drop their subgraph? Need a deletion path (`MATCH (n {group_id: "user-{id}"}) DETACH DELETE n` via query_cypher).
- **PII**: assessment data isn't sensitive but agent conversations might mention email/company. Per-user subgraphs become a GDPR surface — make sure the deletion path is wired before B2 launches.

## What this does NOT do

- No change to global capability graph. Phase A's world model stays exactly as it is.
- No change to agent scheduling / cron cadence. Same 8 AgentKit agents running on the same Inngest triggers.
- No change to Mem0 or Letta. They remain the short-term recall + episodic memory stores.
- No deletion of the half-used Neo4j path. That's a separate cleanup (call it Phase A.5) and can happen any time after the cascade regression sits stable for a few weeks.
