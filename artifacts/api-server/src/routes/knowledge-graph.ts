import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityAlphaTable,
  industriesTable,
  regulationsTable,
  macroEventsTable,
} from "@workspace/db";
import { gte, sql } from "drizzle-orm";

const router: IRouter = Router();

export interface KGHeadline {
  title: string;
  detail: string;
  tone: "neutral" | "positive" | "negative";
}

/**
 * GET /api/knowledge-graph/headlines
 *
 * Compute 3–5 cross-industry insights from existing tables:
 *  1. capability_alpha quadrant clustering — capabilities whose Street consensus
 *     quadrant lands "Hot" or "Emerging" in many industries at once
 *  2. regulations table — industries with elevated regulatory exposure
 *  3. macro_events filtered to the last 30 days — industries with active events
 *
 * Returns up to 5 headlines, oldest-to-newest signal density ordered by
 * "interestingness" (anomaly count first, then magnitude).
 */
router.get("/knowledge-graph/headlines", async (_req, res) => {
  try {
    const headlines: KGHeadline[] = [];

    // ── 1. Quadrant clustering across industries ───────────────────────────
    // Group by capability NAME (same capability shows up under different ids
    // per-industry) and consensus_quadrant; count how many distinct industries
    // hold that name in a Hot / Emerging position.
    const alphaRows = await db
      .select({
        capabilityName: capabilitiesTable.name,
        industryId: capabilitiesTable.industryId,
        quadrant: capabilityAlphaTable.consensusQuadrant,
      })
      .from(capabilityAlphaTable)
      .innerJoin(capabilitiesTable, sql`${capabilityAlphaTable.capabilityId} = ${capabilitiesTable.id}`);

    const totalIndustries = await db.select({ id: industriesTable.id }).from(industriesTable);
    const totalIndustryCount = totalIndustries.length || 1;

    const hotByCapName = new Map<string, Set<number>>();
    for (const r of alphaRows) {
      if (!r.capabilityName || !r.quadrant) continue;
      const q = r.quadrant.toLowerCase();
      if (q !== "hot" && q !== "emerging") continue;
      const set = hotByCapName.get(r.capabilityName) ?? new Set<number>();
      set.add(r.industryId);
      hotByCapName.set(r.capabilityName, set);
    }
    const hotRanked = Array.from(hotByCapName.entries())
      .map(([name, inds]) => ({ name, count: inds.size }))
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count);

    if (hotRanked.length > 0) {
      const top = hotRanked[0];
      headlines.push({
        title: `${top.name} sits Hot or Emerging in ${top.count} of ${totalIndustryCount} industries`,
        detail:
          top.count >= Math.ceil(totalIndustryCount * 0.66)
            ? `Cross-sector pattern — Street consensus places ${top.name} in a Hot or Emerging quadrant across the majority of industries we track. Capabilities clustering this widely tend to be platform-level rather than vertical.`
            : `${top.name} is showing up in elevated quadrants in multiple industries — early signal of cross-cutting demand.`,
        tone: "positive",
      });
    }
    if (hotRanked.length > 1) {
      const second = hotRanked[1];
      headlines.push({
        title: `${second.name} also clusters Hot/Emerging in ${second.count} industries`,
        detail: `Secondary cross-industry pattern. When two capabilities co-cluster this way, they often share an underlying enabling technology — worth checking dependencies between them.`,
        tone: "neutral",
      });
    }

    // ── 2. Regulatory exposure per industry ────────────────────────────────
    const regs = await db.select().from(regulationsTable);
    const regCountByInd: Record<number, number> = {};
    for (const reg of regs) {
      for (const id of (reg.industries as number[] | null) ?? []) {
        regCountByInd[id] = (regCountByInd[id] ?? 0) + 1;
      }
    }
    const indNames = await db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable);
    const indNameById = new Map(indNames.map((i) => [i.id, i.name]));
    const regRanked = Object.entries(regCountByInd)
      .map(([id, count]) => ({ id: Number(id), count, name: indNameById.get(Number(id)) ?? `Industry ${id}` }))
      .sort((a, b) => b.count - a.count);

    if (regRanked.length > 0 && regRanked[0].count >= 2) {
      const top = regRanked[0];
      headlines.push({
        title: `${top.name} carries the heaviest regulatory exposure — ${top.count} active regulations`,
        detail:
          regRanked.length > 1
            ? `Followed by ${regRanked[1].name} (${regRanked[1].count}). High regulatory density correlates with longer enrichment half-lives and higher compliance-driven capability spend.`
            : `Regulatory density is a leading indicator of compliance-driven capability spend.`,
        tone: "negative",
      });
    }

    // ── 3. Active macro events (last 30d) ──────────────────────────────────
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recentEvents = await db
      .select()
      .from(macroEventsTable)
      .where(gte(macroEventsTable.startedAt, cutoff));

    const eventCountByInd: Record<number, number> = {};
    let totalNegative = 0;
    let totalPositive = 0;
    for (const ev of recentEvents) {
      const ids = (ev.affectedIndustryIds as number[]) ?? [];
      for (const id of ids) {
        eventCountByInd[id] = (eventCountByInd[id] ?? 0) + 1;
      }
      if (ev.sentimentDirection === "negative") totalNegative++;
      else if (ev.sentimentDirection === "positive") totalPositive++;
    }
    const eventRanked = Object.entries(eventCountByInd)
      .map(([id, count]) => ({ id: Number(id), count, name: indNameById.get(Number(id)) ?? `Industry ${id}` }))
      .sort((a, b) => b.count - a.count);

    if (recentEvents.length > 0) {
      const netTone: KGHeadline["tone"] =
        totalNegative > totalPositive * 1.5 ? "negative" : totalPositive > totalNegative * 1.5 ? "positive" : "neutral";
      const where = eventRanked[0]
        ? `${eventRanked[0].name} leads with ${eventRanked[0].count} event${eventRanked[0].count === 1 ? "" : "s"}`
        : "spread across the catalog";
      headlines.push({
        title: `${recentEvents.length} macro event${recentEvents.length === 1 ? "" : "s"} tracked in the last 30 days`,
        detail: `${where}. Sentiment mix: ${totalNegative} negative vs ${totalPositive} positive — net pressure ${netTone === "negative" ? "downward" : netTone === "positive" ? "upward" : "balanced"} across the industries we cover.`,
        tone: netTone,
      });
    }
    if (eventRanked.length >= 2 && eventRanked[0].count >= 2) {
      const top = eventRanked[0];
      const second = eventRanked[1];
      headlines.push({
        title: `${top.name} drew ${top.count} active events vs ${second.name}'s ${second.count}`,
        detail: `Event concentration is the cleanest near-term volatility signal — sectors with 2x peer event flow tend to see CVI move first.`,
        tone: "neutral",
      });
    }

    // Cap at 5
    res.json({ headlines: headlines.slice(0, 5) });
  } catch (err) {
    console.error("[knowledge-graph/headlines] failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), headlines: [] });
  }
});

export default router;
