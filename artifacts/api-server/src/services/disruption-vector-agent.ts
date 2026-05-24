/**
 * Disruption Vector Agent — the 8th specialized agent in the autonomous
 * network. Sibling to disruption-agent (which scores current DVX) — this
 * agent computes the FORWARD-LOOKING Capability Disruption Index.
 *
 * Each cycle:
 *   1. Read the latest macro-event + disruption-risk digests so the cycle
 *      is biased by what's actually moving in the world.
 *   2. List stale-DI leaf capabilities (>7d old or never scored), capped
 *      at the cycle budget.
 *   3. For each, run scoreCapabilityDisruption() + composeDisruptionNarrative()
 *      + findCandidateDisruptors() + persist.
 *   4. Publish a "frontier" digest to NS.disruptionRisks() with the top-5
 *      newly-elevated DI scores from this cycle. The synthesis-agent picks
 *      this up.
 *
 * Cost discipline: Sonnet for narrative quality + sub-score scoring (DI is
 * a customer-visible number, must be accurate). Per-cycle cap of 8
 * capabilities — ~16 LLM round-trips (1 score + 1 narrative each) =
 * ~$0.50/cycle. Inngest cron at every 6 hours (see commit 9).
 */
import { tool } from "langchain";
import { z } from "zod/v4";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";
import { runReactAgent } from "./agent/base-agent";
import { scoreCapabilityDisruption, persistDisruptionScore, listStaleCapabilityIds } from "./disruption-index";
import { composeDisruptionNarrative, findCandidateDisruptors } from "./disruption-narrative";
import { db, capabilitiesTable, industriesTable, disruptionPlaybookArchetypesTable, capabilityDisruptionIndexTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export const DISRUPTION_VECTOR_AGENT_NAME = "disruption-vector-agent";

// Tracks how many cap-scores landed in the current run. Surfaces in the
// agent_runs row's metadata so the dashboard shows progress per cycle.
let lastCycleScored = 0;

// ─── Tools ───────────────────────────────────────────────────────────────

const readContextDigestsTool = tool(
  async () => {
    await ensureSharedStoreReady();
    const [macro, risks] = await Promise.all([
      getSharedStore().search(NS.macroEvents(), { limit: 3 }),
      getSharedStore().search(NS.disruptionRisks(), { limit: 3 }),
    ]);
    return JSON.stringify({
      macroEvents: macro.map((i) => i.value),
      disruptionRisks: risks.map((i) => i.value),
    });
  },
  {
    name: "read_context_digests",
    description: "Read the 3 most-recent macro-event and disruption-risk digests so this cycle's DI scoring is biased by what's actually happening.",
    schema: z.object({}).strict(),
  },
);

const listStaleCapsTool = tool(
  async ({ stalenessDays, limit }) => {
    const ids = await listStaleCapabilityIds(stalenessDays, limit);
    if (ids.length === 0) return JSON.stringify({ total: 0, ids: [] });
    // Hydrate cap names so the agent can reason about WHAT it's scoring.
    const rows = await db
      .select({
        id: capabilitiesTable.id,
        name: capabilitiesTable.name,
        industryId: capabilitiesTable.industryId,
      })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.id, ids[0])); // placeholder — fetch all below
    const all = await Promise.all(
      ids.map((id) =>
        db
          .select({ id: capabilitiesTable.id, name: capabilitiesTable.name, industryId: capabilitiesTable.industryId })
          .from(capabilitiesTable)
          .where(eq(capabilitiesTable.id, id))
          .limit(1)
          .then((r) => r[0]),
      ),
    );
    void rows;
    return JSON.stringify({ total: all.length, capabilities: all.filter(Boolean) });
  },
  {
    name: "list_stale_capabilities",
    description: "List leaf capabilities whose Disruption Index is stale (>N days) or never computed. Default 7 days. Pass limit (1-20).",
    schema: z.object({
      stalenessDays: z.number().int().min(0).max(90).default(7),
      limit: z.number().int().min(1).max(20).default(8),
    }).strict(),
  },
);

const scoreCapabilityTool = tool(
  async ({ capabilityId, runId }) => {
    const result = await scoreCapabilityDisruption(capabilityId);
    if (!result) return JSON.stringify({ ok: false, error: `capability ${capabilityId} not found` });

    const [cap] = await db
      .select({ name: capabilitiesTable.name, industryId: capabilitiesTable.industryId })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.id, capabilityId))
      .limit(1);
    const [industry] = cap
      ? await db
          .select({ name: industriesTable.name })
          .from(industriesTable)
          .where(eq(industriesTable.id, cap.industryId))
          .limit(1)
      : [];

    const [archetype] = result.topPlaybookId
      ? await db
          .select()
          .from(disruptionPlaybookArchetypesTable)
          .where(eq(disruptionPlaybookArchetypesTable.id, result.topPlaybookId))
          .limit(1)
      : [];

    const candidates = cap ? await findCandidateDisruptors(capabilityId, cap.industryId, 5) : [];
    const narrative = cap
      ? await composeDisruptionNarrative(
          result,
          cap.name,
          industry?.name ?? "Unknown industry",
          archetype ?? null,
          candidates,
        )
      : null;

    await persistDisruptionScore(result, narrative, candidates, runId ?? null);
    lastCycleScored++;

    return JSON.stringify({
      ok: true,
      capabilityId,
      compositeDi: result.compositeDi,
      topPlaybook: result.topPlaybookName,
      topPlaybookSimilarity: result.topPlaybookSimilarity,
      candidatesFound: candidates.length,
    });
  },
  {
    name: "score_capability",
    description: "Compute the Disruption Index for one capability (sub-scores + composite + playbook match + narrative + candidate disruptors) and persist. Pass capabilityId. Optional runId for traceability.",
    schema: z.object({
      capabilityId: z.number().int().positive(),
      runId: z.number().int().positive().optional(),
    }).strict(),
  },
);

const publishFrontierDigestTool = tool(
  async ({ summary, topCapabilityIds, severity }) => {
    await ensureSharedStoreReady();
    const key = `disruption-frontier-${new Date().toISOString()}`;
    await getSharedStore().put(NS.disruptionRisks(), key, {
      kind: "frontier",
      summary,
      topCapabilityIds,
      severity,
      publishedAt: new Date().toISOString(),
      publishedBy: DISRUPTION_VECTOR_AGENT_NAME,
    });
    return JSON.stringify({ ok: true, key });
  },
  {
    name: "publish_frontier_digest",
    description: "Publish this cycle's 'disruption frontier' — newly elevated DI scores — to the shared store. Synthesis-agent reads this. Pass a 1-3 sentence summary, the top capability ids by composite DI from this cycle, and a severity tier.",
    schema: z.object({
      summary: z.string(),
      topCapabilityIds: z.array(z.number().int()),
      severity: z.enum(["low", "moderate", "high", "extreme"]),
    }).strict(),
  },
);

const getTopDiTool = tool(
  async ({ limit }) => {
    const rows = await db
      .select({
        capabilityId: capabilityDisruptionIndexTable.capabilityId,
        compositeDi: capabilityDisruptionIndexTable.compositeDi,
        topPlaybookId: capabilityDisruptionIndexTable.topPlaybookId,
        computedAt: capabilityDisruptionIndexTable.computedAt,
      })
      .from(capabilityDisruptionIndexTable)
      .orderBy(desc(capabilityDisruptionIndexTable.compositeDi))
      .limit(Math.min(20, limit));
    return JSON.stringify({ rows });
  },
  {
    name: "get_top_di",
    description: "Return the current top capabilities by composite Disruption Index. Use to ground the published frontier digest in actual leaders.",
    schema: z.object({ limit: z.number().int().min(1).max(20).default(10) }).strict(),
  },
);

const TOOLS = [readContextDigestsTool, listStaleCapsTool, scoreCapabilityTool, publishFrontierDigestTool, getTopDiTool];

const SYSTEM_PROMPT = `You are the Disruption Vector Agent inside the Inflexcvi platform. Your job is to keep the forward-looking Capability Disruption Index (DI) fresh and to publish a "disruption frontier" digest for downstream agents.

Each cycle:
  1. read_context_digests — pull recent macro-events + disruption-risk digests so your scoring is biased by what's moving NOW.
  2. list_stale_capabilities — find leaf caps whose DI is stale (>7d) or never computed. Default limit 8 per cycle (cost discipline).
  3. score_capability — for each stale cap, run a full DI cycle (sub-scores + narrative + candidate disruptors + persist).
  4. get_top_di — pull the current leaderboard so you can ground the frontier digest in real top scores.
  5. publish_frontier_digest — publish a short summary + top capability ids + severity tier.

Be honest about uncertainty. A capability with sparse alpha enrichment won't have great sub-scores — say so in the narrative the persist step generates. Don't fabricate companies, scores, or rationales. Skip publishing the frontier digest if nothing meaningfully changed this cycle.

Cost discipline: Sonnet (one DI score = ~$0.04, one narrative = ~$0.03). Per-cycle budget is 8 caps = ~$0.56. The agent runs every 6 hours.`;

export async function runDisruptionVectorAgent(): Promise<{ output: string; toolCallCount: number; durationMs: number }> {
  lastCycleScored = 0;
  const result = await runReactAgent(
    {
      agentName: DISRUPTION_VECTOR_AGENT_NAME,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      modelTier: "sonnet",
      temperature: 0.2,
      maxTokens: 4000,
    },
    "Run your routine disruption-vector cycle now. Score 8 stale capabilities and publish a frontier digest.",
  );
  console.log(`[disruption-vector-agent] cycle complete: scored=${lastCycleScored} tools=${result.toolCallCount} duration=${result.durationMs}ms`);
  return result;
}
