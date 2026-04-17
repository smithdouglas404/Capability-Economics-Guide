import { Router } from "express";
import { db } from "@workspace/db";
import {
  regulationsTable,
  regulationCapabilityRequirementsTable,
  capabilitiesTable,
  organizationsTable,
  organizationCapabilitiesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router = Router();

// List all regulations
router.get("/regulations", async (req, res) => {
  try {
    const rows = await db.select().from(regulationsTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get regulation with requirements
router.get("/regulations/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [reg] = await db.select().from(regulationsTable).where(eq(regulationsTable.id, id));
    if (!reg) { res.status(404).json({ error: "Not found" }); return; }

    const reqs = await db.select({
      req: regulationCapabilityRequirementsTable,
      capabilityName: capabilitiesTable.name,
      benchmarkScore: capabilitiesTable.benchmarkScore,
    })
      .from(regulationCapabilityRequirementsTable)
      .leftJoin(capabilitiesTable, eq(regulationCapabilityRequirementsTable.capabilityId, capabilitiesTable.id))
      .where(eq(regulationCapabilityRequirementsTable.regulationId, id));

    res.json({ ...reg, requirements: reqs.map((r) => ({ ...r.req, capabilityName: r.capabilityName, benchmarkScore: r.benchmarkScore })) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Create regulation
router.post("/regulations", async (req, res) => {
  try {
    const { name, shortCode, description, jurisdiction, effectiveDate, industries } = req.body;
    const [reg] = await db.insert(regulationsTable).values({
      name, shortCode, description,
      jurisdiction: jurisdiction ?? "global",
      effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
      industries: industries ?? [],
    }).returning();
    res.json(reg);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Add capability requirement
router.post("/regulations/:id/requirements", async (req, res) => {
  try {
    const regulationId = Number(req.params.id);
    const { capabilityId, requiredMaturity, priority, evidenceNotes, article } = req.body;
    const [row] = await db.insert(regulationCapabilityRequirementsTable).values({
      regulationId,
      capabilityId,
      requiredMaturity: requiredMaturity ?? 70,
      priority: priority ?? "required",
      evidenceNotes,
      article,
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Check compliance for an organization
router.get("/regulations/:id/compliance", async (req, res) => {
  try {
    const regId = Number(req.params.id);
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";

    const [reg] = await db.select().from(regulationsTable).where(eq(regulationsTable.id, regId));
    if (!reg) { res.status(404).json({ error: "Regulation not found" }); return; }

    const reqs = await db.select({
      req: regulationCapabilityRequirementsTable,
      capabilityName: capabilitiesTable.name,
    })
      .from(regulationCapabilityRequirementsTable)
      .leftJoin(capabilitiesTable, eq(regulationCapabilityRequirementsTable.capabilityId, capabilitiesTable.id))
      .where(eq(regulationCapabilityRequirementsTable.regulationId, regId));

    let orgScores = new Map<number, number>();
    if (token) {
      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, token));
      if (org) {
        const caps = await db.select().from(organizationCapabilitiesTable)
          .where(eq(organizationCapabilitiesTable.organizationId, org.id));
        orgScores = new Map(caps.map((c) => [c.capabilityId, c.maturityScore]));
      }
    }

    const results = reqs.map((r) => {
      const myScore = orgScores.get(r.req.capabilityId) ?? null;
      const required = r.req.requiredMaturity;
      const compliant = myScore !== null ? myScore >= required : null;
      const gap = myScore !== null ? myScore - required : null;

      return {
        capabilityId: r.req.capabilityId,
        capabilityName: r.capabilityName,
        requiredMaturity: required,
        priority: r.req.priority,
        article: r.req.article,
        myScore,
        compliant,
        gap,
      };
    });

    const total = results.length;
    const assessed = results.filter((r) => r.myScore !== null).length;
    const compliantCount = results.filter((r) => r.compliant === true).length;
    const nonCompliant = results.filter((r) => r.compliant === false);

    res.json({
      regulation: reg,
      overallCompliance: assessed > 0 ? Math.round(compliantCount / assessed * 100) : null,
      total,
      assessed,
      compliant: compliantCount,
      nonCompliant: nonCompliant.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete regulation
router.delete("/regulations/:id", async (req, res) => {
  try {
    await db.delete(regulationsTable).where(eq(regulationsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
