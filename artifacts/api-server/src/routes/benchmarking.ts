import { Router } from "express";
import { db } from "@workspace/db";
import {
  benchmarkNetworkTable,
  organizationsTable,
  organizationCapabilitiesTable,
  capabilitiesTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

// Opt-in: submit org data to anonymous benchmark pool
router.post("/benchmarking/opt-in", async (req, res) => {
  try {
    const { sessionToken } = req.body;
    if (!sessionToken) { res.status(400).json({ error: "sessionToken required" }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
    if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

    const assessments = await db.select().from(organizationCapabilitiesTable)
      .where(eq(organizationCapabilitiesTable.organizationId, org.id));

    if (!assessments.length) { res.status(400).json({ error: "No assessments to contribute" }); return; }

    // Upsert into benchmark pool
    for (const a of assessments) {
      const cap = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, a.capabilityId));
      if (!cap.length) continue;

      await db.insert(benchmarkNetworkTable).values({
        organizationId: org.id,
        capabilityId: a.capabilityId,
        industryId: org.industryId,
        maturityScore: a.maturityScore,
        orgSize: org.size,
      }).onConflictDoUpdate({
        target: [benchmarkNetworkTable.organizationId, benchmarkNetworkTable.capabilityId],
        set: { maturityScore: a.maturityScore, submittedAt: new Date() },
      });
    }

    res.json({ contributed: assessments.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get anonymized peer benchmarks
router.get("/benchmarking/peers", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    const industryId = Number(req.query.industryId) || undefined;
    const orgSize = typeof req.query.orgSize === "string" ? req.query.orgSize : undefined;

    // Get org's own scores
    let myScores: Map<number, number> = new Map();
    if (token) {
      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, token));
      if (org) {
        const caps = await db.select().from(organizationCapabilitiesTable)
          .where(eq(organizationCapabilitiesTable.organizationId, org.id));
        myScores = new Map(caps.map((c) => [c.capabilityId, c.maturityScore]));
      }
    }

    // Aggregate peer data anonymously
    const conditions = [];
    if (industryId) conditions.push(eq(benchmarkNetworkTable.industryId, industryId));
    if (orgSize) conditions.push(eq(benchmarkNetworkTable.orgSize, orgSize));

    const peerData = await db.select({
      capabilityId: benchmarkNetworkTable.capabilityId,
      avgScore: sql<number>`avg(${benchmarkNetworkTable.maturityScore})`,
      medianScore: sql<number>`percentile_cont(0.5) within group (order by ${benchmarkNetworkTable.maturityScore})`,
      p25: sql<number>`percentile_cont(0.25) within group (order by ${benchmarkNetworkTable.maturityScore})`,
      p75: sql<number>`percentile_cont(0.75) within group (order by ${benchmarkNetworkTable.maturityScore})`,
      peerCount: sql<number>`count(distinct ${benchmarkNetworkTable.organizationId})`,
    })
      .from(benchmarkNetworkTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(benchmarkNetworkTable.capabilityId);

    // Get capability names
    const capIds = peerData.map((p) => p.capabilityId);
    const caps = capIds.length
      ? await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name }).from(capabilitiesTable)
      : [];
    const capNames = new Map(caps.map((c) => [c.id, c.name]));

    const results = peerData.map((p) => ({
      capabilityId: p.capabilityId,
      capabilityName: capNames.get(p.capabilityId) ?? `Capability ${p.capabilityId}`,
      myScore: myScores.get(p.capabilityId) ?? null,
      peerAvg: Math.round(Number(p.avgScore) * 10) / 10,
      peerMedian: Math.round(Number(p.medianScore) * 10) / 10,
      peerP25: Math.round(Number(p.p25) * 10) / 10,
      peerP75: Math.round(Number(p.p75) * 10) / 10,
      peerCount: Number(p.peerCount),
      gap: myScores.has(p.capabilityId) ? Math.round((myScores.get(p.capabilityId)! - Number(p.medianScore)) * 10) / 10 : null,
    }));

    res.json({ peerCount: Math.max(...results.map((r) => r.peerCount), 0), results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
