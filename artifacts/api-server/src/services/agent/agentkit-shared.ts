/**
 * Shared types for the AgentKit migration (Phase 9, 2026-05-24).
 *
 * Replaces the small surface the now-deleted `base-agent.ts` used to
 * export. The 7 agents' AgentKit implementations live in
 * `services/<agent>-agentkit.ts` (or `cvi-agent-agentkit.ts` for the
 * autonomous CVI agent).
 *
 * NOTE: `services/agent/base-agent.ts` is intentionally KEPT during the
 * Phase 9 cutover because the 8th agent — `services/disruption-vector-agent.ts`
 * (not one of the migrated 7) — still uses `runReactAgent` from it.
 * Migrating disruption-vector-agent is out of scope for the Phase 9 7-agent
 * migration. The type below is the AgentKit-side equivalent of the shape
 * that base-agent.ts also exports under the same name.
 */

export interface AgentRunResult {
  output: string;
  toolCallCount: number;
  durationMs: number;
}
