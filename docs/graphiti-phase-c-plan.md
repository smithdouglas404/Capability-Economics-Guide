# Graphiti Phase C Plan — Per-User Mem0 + Per-User Agents

**Status**: planning doc; no code changes yet.
**Prereq**: Phase B (per-user Graphiti subgraphs) shipped. Specifically B1 — assessment overlay — landed cleanly. B2 (agent conversation episodes) optional.
**Decision needed**: do we want this at all, given Graphiti subgraphs may subsume what Mem0 currently provides?

## What Phase C is

Today: one global Mem0 instance (self-hosted at `mem0-server-production-8f56.up.railway.app`) holds short-term memory for the 8 AgentKit agents. Every agent reads/writes to the same namespace. Memories are tagged with `metadata.industry`, `metadata.category`, etc., but the partitioning is convention, not enforcement — and there's no per-user partition at all.

Phase C either:

1. **C1 — Per-user namespaces in the existing Mem0**: keep self-hosted Mem0, give each user a `user_id="user-{id}"` prefix on every memory. Mem0 natively supports `user_id` partitioning in its API.
2. **C2 — Per-user agent personas**: each user gets a custom agent prompt that pulls from THEIR memory partition + the global world model. Implemented as a thin wrapper around the 8 existing agents, not a new agent.
3. **C3 — Replace Mem0 entirely with Graphiti per-user subgraphs**: drop Mem0; everything Mem0 stored becomes Episodic nodes in the user's `group_id="user-{id}"` Graphiti subgraph. Big migration, big consolidation.

## Should we even do this?

Honest answer: **C3 might make C1 and C2 unnecessary.** If Phase B2 (per-user agent conversation episodes in Graphiti) ships, the case for keeping Mem0 narrows considerably — Graphiti gives us per-user bitemporal episodic memory, semantic search, and entity extraction in one system. Mem0's value-add today is mostly speed (faster retrieval than running Cypher across episodes) and the local-DB mirror fallback.

Recommendation order:
1. **Ship Phase B2 first** (per-user agent conversation episodes in Graphiti).
2. Measure overlap between what Mem0 stores and what B2 Graphiti episodes capture.
3. Decide: C1 (keep Mem0 + add user_id partition) vs C3 (drop Mem0 entirely). Don't do C1 if C3 is the eventual destination.
4. C2 is separable and lightweight — can land any time after C1 OR C3.

## C1 — Per-user Mem0 namespaces (if we keep Mem0)

Mem0's API already supports `user_id`. Today the api-server passes `user_id="default"` (or no user_id) on every `add` / `search`. C1 changes every call site to pass `user_id="user-{realUserId}"`.

**Code touch:**
- `services/agent/memory.ts` — `addMemory` + `searchMemories` gain a required `userId` param.
- Every caller in `services/agent/*.ts` and `services/<agent>-agentkit.ts` — currently ~30 call sites — passes the user/org/session id through.
- Global system-level memories (industry patterns, recommendation outcomes) become `user_id="system"`.

**Migration**: existing memories don't have a user_id. Options:
- Re-tag them all as `system` (safe but loses any signal that was per-user).
- Leave them un-tagged + let Mem0's search return them as a fallback (Mem0 supports cross-user search).

**Cost**: zero — Mem0 hosting is unchanged, just more granular partitioning.

## C2 — Per-user agent personas

Today: agent prompts are static, hard-coded in the agent file. Every user gets the same `runCviAgent()` prompt.

C2: lift the prompt to a per-user override stored in Letta core blocks (we already have Letta for exactly this — see `services/agent/store.ts`'s `getAgentPriorBlock`/`putAgentPriorBlock`). Each user's override merges with the global agent prompt at runtime.

**Use case**: a power user wants the agent to always focus on cost considerations; another wants it to always check regulatory implications first. C2 lets them tune the agent's bias.

**Code touch**:
- New `getUserAgentOverride(userId, agentName)` reading from Letta block `user-{id}-agent-{name}-override`.
- Each agent's prompt-build step merges `[global prompt] + [user override if present]`.
- New UI: `/account/agent-preferences` page lets users edit their overrides.

**Cost**: zero. Letta blocks are already provisioned.

## C3 — Drop Mem0, use Graphiti per-user subgraphs (the radical version)

Replace every Mem0 call with a Graphiti `add_episode(group_id="user-{id}")` (write) or `search_nodes(group_ids=["global", "user-{id}"])` (read).

**Wins**:
- One graph substrate, not two.
- Memories are bitemporal — "what did this user think 3 months ago vs now" becomes a single query.
- Memories interlinked with the global world model — "this user has mentioned `Supply Chain` 14 times in the last 30 days" is a graph traversal, not a Mem0 grep.

**Costs**:
- Every recall path needs rewriting. ~30 call sites.
- Graphiti's LLM-extraction-per-write is slower than Mem0's vector-embedding-per-write (~3-10× per write call). Acceptable for batched/async writes, painful for synchronous "remember this fact NOW" calls.
- Mem0's local-DB mirror fallback (graceful degrade when Mem0 is unreachable) needs a parallel mechanism in Graphiti.

**Migration**: Mem0 has ~thousands of memories today. Re-extracting them all via Graphiti's LLM pipeline would cost real money. Option: leave Mem0 in place as a read-fallback, only NEW memories go to Graphiti. Existing Mem0 memories age out naturally.

## Recommendation

- **C2** is a clear win if users actually want to tune agents — ship as a separable mini-project; cheap to build, no migration risk.
- **C1 vs C3**: defer the choice until after Phase B2. The case for keeping Mem0 will be clearer once we see what Graphiti episodes already capture.
- **C3 is the long-term destination** if we want a single graph substrate. But it's not urgent — Mem0 works fine. Worth doing only when we have a feature that explicitly needs the consolidation.

## What this does NOT do

- No change to Letta. Stays the system-of-record for agent persona core blocks.
- No change to FalkorDB schema beyond what Phase B already added.
- No effect on Inngest scheduling, AgentKit framework, or any of the 8 existing agents' own logic.
- Doesn't replace the global agent prompts — even C2 layers per-user overrides ON TOP of the global prompts; the base behavior is unchanged for users who don't customize.

## Open questions

- **Cost gate**: what's the user-count threshold above which C3's LLM-extraction cost becomes prohibitive? Need to model: per-user writes/day × Haiku cost × users.
- **PII**: if Phase B2 already moved conversation history into Graphiti, do we even need Mem0? Or is Mem0's value the FAST retrieval + the local-DB mirror, separable from "where the data lives"?
- **Operator cognitive load**: running Mem0 + Letta + Graphiti is three graph-ish stores. C3 consolidates to two. Worth doing for ops simplicity alone? Maybe — but not on its own merits.
