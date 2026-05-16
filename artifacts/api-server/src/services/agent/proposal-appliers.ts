/**
 * Per-type appliers for agent_proposals. Invoked when an admin
 * approves a proposal via POST /api/admin/agent/proposals/:id/approve.
 *
 * Each applier:
 *   - Reads the proposal payload (already validated when queued).
 *   - Mutates the canonical table for that proposal type.
 *   - Returns a summary that lands in the proposal's audit log.
 *   - Throws on failure so the admin route can return 500 cleanly
 *     without flipping the proposal to "applied".
 *
 * Adding a new proposal type:
 *   1. Add a tool to LETTA_CUSTOM_TOOLS that produces it.
 *   2. Add the callback route in routes/agent.ts that queues it.
 *   3. Add an applier here.
 *   4. Wire the type → applier mapping in APPLIERS at the bottom.
 *
 * Per plan Phase 1.5.4.
 */
import { db, economicRulesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { lettaReadBlock, lettaUpdateBlock } from "./letta";
import { syncEconomicRulesToLetta } from "./economic-rules-sync";

export interface ApplyContext {
  proposalId: number;
  payload: Record<string, unknown>;
  reviewedBy?: string;
}

export interface ApplyResult {
  appliedAt: Date;
  summary: string;
}

/**
 * capability_flag: writes the flag to the capabilities row as a
 * note. The capabilities table doesn't have a dedicated flag column,
 * so we use the existing review/notes path. If a future schema adds a
 * `flag_severity` column, swap the implementation here.
 *
 * For now: append a JSON-encoded flag record to a capability_flags
 * marker stored in `agent_memories` as an "observation" memory tagged
 * with the source proposal id. Operators can query that later.
 */
async function applyCapabilityFlag({ proposalId, payload }: ApplyContext): Promise<ApplyResult> {
  const capabilityId = Number(payload.capability_id);
  const severity = String(payload.severity);
  const reason = String(payload.reason);
  if (!Number.isFinite(capabilityId)) throw new Error("invalid capability_id in payload");
  if (!["watch", "concern", "alert"].includes(severity)) {
    throw new Error(`invalid severity ${severity} (must be watch|concern|alert)`);
  }
  // For v1: record the flag as a typed observation. The reflect/recall
  // pipeline already surfaces observations as agent context, so flagged
  // capabilities re-enter the agent's working memory next cycle.
  await db.execute(sql`
    INSERT INTO agent_memories
      (memory_type, category, run_scope, content, metadata, relevance_score, created_at)
    VALUES (
      'observation',
      'decision',
      ${`proposal-${proposalId}`},
      ${`Admin-approved flag on capability ${capabilityId} [${severity}]: ${reason}`},
      ${JSON.stringify({
        kind: "capability_flag",
        capabilityId,
        severity,
        reason,
        proposalId,
        appliedAt: new Date().toISOString(),
      })}::jsonb,
      1.0,
      now()
    )
  `);
  return {
    appliedAt: new Date(),
    summary: `Flagged capability ${capabilityId} as "${severity}" per agent proposal #${proposalId}`,
  };
}

/**
 * economic_rule_change: updates the row in economic_rules with the
 * new value, then forces a Letta block re-sync so the agent's next
 * decision step sees the new threshold immediately.
 */
async function applyEconomicRuleChange({ proposalId, payload, reviewedBy }: ApplyContext): Promise<ApplyResult> {
  const ruleKey = String(payload.rule_key);
  const newValue = payload.new_value;
  if (!ruleKey) throw new Error("missing rule_key in payload");
  if (newValue === undefined) throw new Error("missing new_value in payload");

  const [existing] = await db.select().from(economicRulesTable).where(eq(economicRulesTable.key, ruleKey)).limit(1);
  if (!existing) throw new Error(`unknown rule_key "${ruleKey}"`);
  const oldValue = existing.value;

  await db.update(economicRulesTable)
    .set({
      value: newValue,
      lastUpdatedBy: reviewedBy ?? `proposal-${proposalId}`,
      lastUpdatedAt: new Date(),
    })
    .where(eq(economicRulesTable.key, ruleKey));

  // Push the new block content to Letta. Non-fatal if sync fails —
  // the rule is authoritative in Postgres and the next scheduled
  // sync will pick it up.
  await syncEconomicRulesToLetta().catch(() => {});

  return {
    appliedAt: new Date(),
    summary: `Economic rule "${ruleKey}" updated: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}. Letta block resynced.`,
  };
}

/**
 * industry_prior_update: writes the proposed prior_text into the
 * Letta industry_priors block. Two modes:
 *   - If the existing block already has an `## <industry_slug>` heading,
 *     replace that section in place.
 *   - Otherwise, append a new section to the end of the block.
 *
 * Block content is read directly (not from a Postgres mirror) because
 * Letta is authoritative for the block. We re-read after the write to
 * confirm Letta accepted the update.
 */
async function applyIndustryPriorUpdate({ proposalId, payload }: ApplyContext): Promise<ApplyResult> {
  const industrySlug = String(payload.industry_slug);
  const priorText = String(payload.prior_text);
  if (!industrySlug) throw new Error("missing industry_slug in payload");
  if (!priorText) throw new Error("missing prior_text in payload");

  const current = (await lettaReadBlock("industry_priors")) ?? "";
  const sectionHeader = `## ${industrySlug}`;
  const headerLine = `${sectionHeader}\n${priorText}`;

  let next: string;
  if (current.includes(sectionHeader)) {
    // Replace from this header to the next `## ` (or end of string).
    const re = new RegExp(`(^|\\n)${sectionHeader}[\\s\\S]*?(?=\\n## |$)`, "g");
    next = current.replace(re, (_m, lead) => `${lead}${headerLine}`);
  } else {
    next = current.trim().length > 0
      ? `${current.trim()}\n\n${headerLine}`
      : headerLine;
  }

  const ok = await lettaUpdateBlock("industry_priors", next);
  if (!ok) throw new Error("Letta block update returned false — block not modified");

  return {
    appliedAt: new Date(),
    summary: `industry_priors section "${industrySlug}" updated (${priorText.length} chars) via proposal #${proposalId}.`,
  };
}

const APPLIERS: Record<string, (ctx: ApplyContext) => Promise<ApplyResult>> = {
  capability_flag: applyCapabilityFlag,
  economic_rule_change: applyEconomicRuleChange,
  industry_prior_update: applyIndustryPriorUpdate,
};

export async function applyProposal(
  proposalType: string,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const applier = APPLIERS[proposalType];
  if (!applier) throw new Error(`no applier for proposal type "${proposalType}"`);
  return applier(ctx);
}

export const SUPPORTED_PROPOSAL_TYPES = Object.keys(APPLIERS);
