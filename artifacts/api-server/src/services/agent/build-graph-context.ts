/**
 * Build a "graph context" block prepended to every specialized agent's
 * system prompt. Surfaces the FalkorDB world-model signals the agent
 * couldn't otherwise see — PageRank top hubs, CDLP community sizes, and
 * (when enabled) a sample of recent :DEPENDS_ON edges. Lets every agent
 * reason about the structural shape of the capability graph instead of
 * treating Postgres rows as the only source of truth.
 *
 * Cached via the underlying capability-graph-algorithms calls (1h TTL),
 * so calling this on every agent run is one cached lookup per hour
 * across all agents combined.
 *
 * Graceful degrade: returns an empty string when Graphiti is off or
 * the graph is empty. Agents prepend the result to their system prompt
 * — appending "" is a no-op so they don't need to branch.
 */

import { isGraphitiEnabled } from "../../lib/graphiti-client";
import { getPageRankScores, getCommunityAssignments } from "../capability-graph-algorithms";

interface BuildOptions {
  topHubsLimit?: number;
  topCommunitiesLimit?: number;
}

export async function buildGraphContext(opts: BuildOptions = {}): Promise<string> {
  if (!isGraphitiEnabled()) return "";
  const topHubsLimit = opts.topHubsLimit ?? 10;
  const topCommunitiesLimit = opts.topCommunitiesLimit ?? 5;

  try {
    const [pageRank, communities] = await Promise.all([
      getPageRankScores(),
      getCommunityAssignments(),
    ]);

    if (pageRank.size === 0 && communities.size === 0) return "";

    const lines: string[] = [];

    if (pageRank.size > 0) {
      const top = Array.from(pageRank.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topHubsLimit)
        .map(([pgId, score]) => `cap#${pgId} (PR ${score.toFixed(4)})`);
      lines.push(`SYSTEMIC HUBS (top ${top.length} by FalkorDB PageRank on :Capability/:DEPENDS_ON):\n  ${top.join(", ")}`);
    }

    if (communities.size > 0) {
      const sizeMap = new Map<number, number>();
      for (const cid of communities.values()) sizeMap.set(cid, (sizeMap.get(cid) ?? 0) + 1);
      const topClusters = Array.from(sizeMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topCommunitiesLimit)
        .map(([communityId, size]) => `${size} caps`);
      const totalCommunities = sizeMap.size;
      lines.push(
        `STRATEGIC CLUSTERS (CDLP detected ${totalCommunities} communities; largest ${topClusters.length}: ${topClusters.join(", ")})`,
      );
    }

    if (lines.length === 0) return "";
    return `\n\n--- WORLD-MODEL GRAPH SIGNALS (FalkorDB) ---\n${lines.join("\n")}\n--- END GRAPH SIGNALS ---`;
  } catch {
    // Cached lookup failed — non-fatal, just skip the graph context.
    return "";
  }
}
