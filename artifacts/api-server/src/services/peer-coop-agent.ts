/**
 * Peer Co-op Agent — wraps services/peer-coop.ts.
 *
 * Polls per-organization k-anonymity cohort benchmarks and publishes
 * a rollup to NS.peerBenchmarks() so the Stack Optimizer Agent can
 * use cohort context when generating recommendations.
 *
 * Per Master Action Plan Phase 1.9 Step 3 / agent #2.
 */
import { tool } from "langchain";
import { z } from "zod/v4";
import { db, organizationsTable } from "@workspace/db";
import { getContributorStatus, getPeerPercentiles } from "./peer-coop";
import { runReactAgent } from "./agent/base-agent";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";

export const PEER_COOP_AGENT_NAME = "peer-coop-agent";

const listContributingOrgsTool = tool(
  async () => {
    const orgs = await db.select().from(organizationsTable).limit(25);
    const statuses = await Promise.all(orgs.map(o => getContributorStatus(o.id).catch(() => null)));
    return JSON.stringify(orgs.map((o, i) => ({
      id: o.id,
      name: o.name,
      status: statuses[i] ?? null,
    })).filter(x => x.status));
  },
  {
    name: "list_contributing_organizations",
    description: "List organizations currently contributing to peer-coop benchmarks, with their contributor status (membership, capabilities-published, eligibility).",
    schema: z.object({}).strict(),
  },
);

const getPercentilesTool = tool(
  async ({ organizationId }) => {
    const r = await getPeerPercentiles(organizationId);
    if (!r) return JSON.stringify({ found: false });
    return JSON.stringify(r);
  },
  {
    name: "get_peer_percentiles",
    description: "Get the peer-cohort percentiles for a single organization (where they sit relative to their k-anonymity cohort on each scored capability).",
    schema: z.object({ organizationId: z.number().int().positive() }).strict(),
  },
);

const publishBenchmarkDigestTool = tool(
  async ({ summary, cohortCoverage, organizationsSampled }) => {
    await ensureSharedStoreReady();
    const key = `bench-${new Date().toISOString()}`;
    await getSharedStore().put(NS.peerBenchmarks(), key, {
      summary,
      cohortCoverage,
      organizationsSampled,
      publishedAt: new Date().toISOString(),
      publishedBy: PEER_COOP_AGENT_NAME,
    });
    return JSON.stringify({ ok: true, key });
  },
  {
    name: "publish_peer_benchmark_digest",
    description: "Publish a rollup of peer-coop benchmark coverage (which capabilities have enough cohort members to surface percentiles, which don't yet).",
    schema: z.object({
      summary: z.string(),
      cohortCoverage: z.array(z.object({
        capabilityName: z.string(),
        contributorCount: z.number().int().nonnegative(),
        median: z.number().nullable(),
      })),
      organizationsSampled: z.number().int().nonnegative(),
    }).strict(),
  },
);

const TOOLS = [listContributingOrgsTool, getPercentilesTool, publishBenchmarkDigestTool];

const SYSTEM_PROMPT = `You are the Peer Co-op Agent. Each cycle:

1. List contributing organizations (list_contributing_organizations).
2. Sample percentile data from 2-4 representative orgs (get_peer_percentiles) to spot capabilities where cohort coverage is healthy vs sparse.
3. Publish a single benchmark digest (publish_peer_benchmark_digest) with coverage stats so the Stack Optimizer Agent knows which capabilities have credible peer context vs need-more-data.

Cost discipline: Haiku. Don't sample every organization — pick representatives.`;

export async function runPeerCoopAgent(): Promise<{ output: string; toolCallCount: number; durationMs: number }> {
  const result = await runReactAgent(
    {
      agentName: PEER_COOP_AGENT_NAME,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      modelTier: "haiku",
      temperature: 0.2,
      maxTokens: 2000,
    },
    "Run your routine peer-benchmarks cycle now.",
  );
  console.log(`[peer-coop-agent] cycle complete: tools=${result.toolCallCount} duration=${result.durationMs}ms`);
  return result;
}
