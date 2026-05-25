/**
 * Shared types for the AgentKit-resident agents (Phase 9 + Phase 10).
 *
 * Phase 9 (2026-05-24) migrated 7 agents to AgentKit; Phase 10 (2026-05-25)
 * migrated the 8th — `disruption-vector-agent` — and deleted the legacy
 * `base-agent.ts` (its sole consumer). The 8 agents' AgentKit
 * implementations live in `services/<agent>-agentkit.ts` (or
 * `cvi-agent-agentkit.ts` for the autonomous CVI agent).
 */

export interface AgentRunResult {
  output: string;
  toolCallCount: number;
  durationMs: number;
}
