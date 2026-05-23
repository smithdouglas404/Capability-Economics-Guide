/**
 * Consensus view — model vs sources.
 *
 * For each capability we have an `our` score (the platform's synthesized
 * consensus from cvi_components) AND the underlying per-source scores
 * (Gartner, McKinsey, Forrester, EDGAR, Perplexity research, etc.)
 * captured in source_triangulations. This endpoint returns them
 * side-by-side so any UI can render the "model vs consensus" comparison.
 *
 * Highest-magnitude disagreement = the most interesting signal. The UI
 * surfaces this as the differentiator vs PitchBook / CBI.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sourceTriangulationsTable, cviComponentsTable, capabilitiesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

interface SourceScore {
  sourceLabel: string;
  rawScore: number;
  weight: number;
  methodology: string;
  citations: string[];
  queriedAt: string;
}

router.get("/consensus/capability/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid capability id" });
      return;
    }

    const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, id)).limit(1);
    if (!cap) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }

    const [comp] = await db
      .select()
      .from(cviComponentsTable)
      .where(eq(cviComponentsTable.capabilityId, id))
      .orderBy(desc(cviComponentsTable.updatedAt))
      .limit(1);

    const triRows = await db
      .select()
      .from(sourceTriangulationsTable)
      .where(eq(sourceTriangulationsTable.capabilityId, id))
      .orderBy(desc(sourceTriangulationsTable.queriedAt));

    // Dedup by sourceLabel — most recent wins.
    const seen = new Set<string>();
    const sources: SourceScore[] = [];
    for (const t of triRows) {
      if (seen.has(t.sourceLabel)) continue;
      seen.add(t.sourceLabel);
      sources.push({
        sourceLabel: t.sourceLabel,
        rawScore: t.rawScore,
        weight: t.weight,
        methodology: t.methodology,
        citations: t.citations ?? [],
        queriedAt: t.queriedAt.toISOString(),
      });
    }

    const ourScore = comp?.consensusScore ?? cap.benchmarkScore ?? null;

    // Disagreement = max abs(source - ours). Sources without a number contribute 0.
    let maxDisagreement = 0;
    let mostDisagreeingSource: string | null = null;
    if (ourScore !== null) {
      for (const s of sources) {
        const d = Math.abs(s.rawScore - ourScore);
        if (d > maxDisagreement) {
          maxDisagreement = d;
          mostDisagreeingSource = s.sourceLabel;
        }
      }
    }

    res.json({
      capabilityId: id,
      capabilityName: cap.name,
      ourScore,
      ourConfidence: comp?.confidence ?? null,
      ourCiLow: comp?.ciLow ?? null,
      ourCiHigh: comp?.ciHigh ?? null,
      sources,
      maxDisagreement: Math.round(maxDisagreement * 10) / 10,
      mostDisagreeingSource,
      lastUpdatedAt: comp?.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
