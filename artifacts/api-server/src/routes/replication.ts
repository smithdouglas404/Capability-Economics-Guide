import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  ceiComponentsTable,
  capabilitiesTable,
  industriesTable,
  sourceTriangulationsTable,
  dataSourcesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { CEI_METHODOLOGY } from "../services/cei-engine";
import { logFeatureUsed } from "../services/persona-events";

const router: IRouter = Router();

const CODE_STUB = `# Capability Economics — replication stub
# Generated from /api/replication/bundle. Drop the JSON next to this file.
import json, pandas as pd
from pathlib import Path

bundle = json.loads(Path("replication-bundle.json").read_text())
components = pd.DataFrame(bundle["dataset"]["ceiComponents"])
triangulations = pd.DataFrame(bundle["dataset"]["sourceTriangulations"])

# Posterior consensus (Bayesian) is already pre-computed per row.
print(components.groupby("capability")["consensusScore"].agg(["mean", "std", "count"]))

# Reproduce velocity EMA from raw queriedAt-ordered triangulations:
ALPHA = 0.7
def ema_velocity(group):
    g = group.sort_values("queriedAt")
    deltas = g["rawScore"].diff().fillna(0) / 100.0
    velocity = 0.0
    out = []
    for d in deltas:
        velocity = ALPHA * velocity + (1 - ALPHA) * d
        out.append(velocity)
    return out
`;

router.post("/replication/bundle", async (req, res) => {
  void logFeatureUsed({ userId: getAuth(req)?.userId, feature: "/replication/bundle" });
  try {
    const industryId = req.body?.industryId !== undefined ? Number(req.body.industryId) : undefined;
    if (industryId === undefined || Number.isNaN(industryId)) {
      res.status(400).json({ error: "industryId required" });
      return;
    }
    const capabilityIds: number[] | undefined = Array.isArray(req.body?.capabilityIds)
      ? req.body.capabilityIds.map(Number).filter((n: number) => Number.isFinite(n))
      : undefined;

    const industry = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId)).limit(1);
    if (!industry.length) { res.status(404).json({ error: `Unknown industry ${industryId}` }); return; }

    const caps = capabilityIds && capabilityIds.length
      ? await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capabilityIds))
      : await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));

    const capIds = caps.map((c) => c.id);
    const components = capIds.length
      ? await db.select().from(ceiComponentsTable).where(inArray(ceiComponentsTable.capabilityId, capIds))
      : [];
    const triangulations = capIds.length
      ? await db.select().from(sourceTriangulationsTable).where(inArray(sourceTriangulationsTable.capabilityId, capIds))
      : [];
    const sourceIdSet = new Set<number>();
    for (const c of caps) for (const id of c.sourceIds ?? []) sourceIdSet.add(id);
    const sources = sourceIdSet.size
      ? await db.select().from(dataSourcesTable).where(inArray(dataSourcesTable.id, Array.from(sourceIdSet)))
      : [];

    const capMap = new Map(caps.map((c) => [c.id, c.name]));

    const bundle = {
      generatedAt: new Date().toISOString(),
      industry: industry[0],
      methodology: { version: "1.0", text: CEI_METHODOLOGY },
      dataset: {
        capabilities: caps.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          isLeaf: c.isLeaf,
          parentId: c.parentCapabilityId,
          benchmarkScore: c.benchmarkScore,
        })),
        ceiComponents: components.map((c) => ({
          capabilityId: c.capabilityId,
          capability: capMap.get(c.capabilityId) ?? null,
          consensusScore: c.consensusScore,
          confidence: c.confidence,
          velocity: c.velocity,
          economicMultiplier: c.economicMultiplier,
          updatedAt: c.updatedAt,
        })),
        sourceTriangulations: triangulations.map((t) => ({
          capabilityId: t.capabilityId,
          capability: capMap.get(t.capabilityId) ?? null,
          sourceLabel: t.sourceLabel,
          rawScore: t.rawScore,
          weight: t.weight,
          methodology: t.methodology,
          rationale: t.rationale,
          queriedAt: t.queriedAt,
        })),
        sources,
      },
      counts: {
        capabilities: caps.length,
        components: components.length,
        triangulations: triangulations.length,
        sources: sources.length,
      },
      codeStub: CODE_STUB,
      readme: [
        "Capability Economics replication bundle.",
        "Schema: dataset.capabilities, dataset.ceiComponents, dataset.sourceTriangulations, dataset.sources.",
        "Methodology text describes the Bayesian posterior + velocity EMA used to derive consensusScore and velocity.",
        "codeStub is a starter pandas script — drop this JSON next to it as replication-bundle.json.",
      ].join("\n"),
    };

    const filename = `replication-bundle-${industry[0].slug ?? industry[0].id}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    res.status(500).json({ error: "Replication bundle failed", message: (err as Error).message });
  }
});

export default router;
