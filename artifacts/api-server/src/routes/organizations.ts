import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  organizationsTable,
  organizationCapabilitiesTable,
  capabilitiesTable,
  industriesTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { CreateOrganizationBody, UpsertAssessmentsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/organizations", async (req, res) => {
  const parsed = CreateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, industryId, size } = parsed.data;

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
  if (!industry) {
    res.status(400).json({ error: "Invalid industry ID" });
    return;
  }

  const sessionToken = randomUUID();
  const [org] = await db.insert(organizationsTable).values({
    name,
    industryId,
    size: size || "mid",
    sessionToken,
  }).returning();

  res.status(201).json({
    id: org.id,
    name: org.name,
    industryId: org.industryId,
    size: org.size,
    sessionToken: org.sessionToken,
    createdAt: org.createdAt.toISOString(),
  });
});

router.get("/organizations/:sessionToken", async (req, res) => {
  const { sessionToken } = req.params;

  const [org] = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      industryId: organizationsTable.industryId,
      industryName: industriesTable.name,
      size: organizationsTable.size,
      sessionToken: organizationsTable.sessionToken,
      createdAt: organizationsTable.createdAt,
    })
    .from(organizationsTable)
    .innerJoin(industriesTable, eq(industriesTable.id, organizationsTable.industryId))
    .where(eq(organizationsTable.sessionToken, sessionToken));

  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const [countResult] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(organizationCapabilitiesTable)
    .where(eq(organizationCapabilitiesTable.organizationId, org.id));

  res.json({
    ...org,
    assessmentCount: countResult.count,
    createdAt: org.createdAt.toISOString(),
  });
});

router.get("/organizations/:sessionToken/assessments", async (req, res) => {
  const { sessionToken } = req.params;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const assessments = await db
    .select({
      id: organizationCapabilitiesTable.id,
      organizationId: organizationCapabilitiesTable.organizationId,
      capabilityId: organizationCapabilitiesTable.capabilityId,
      capabilityName: capabilitiesTable.name,
      capabilitySlug: capabilitiesTable.slug,
      maturityScore: organizationCapabilitiesTable.maturityScore,
      investmentLevel: organizationCapabilitiesTable.investmentLevel,
      strategicImportance: organizationCapabilitiesTable.strategicImportance,
      notes: organizationCapabilitiesTable.notes,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      assessedAt: organizationCapabilitiesTable.assessedAt,
    })
    .from(organizationCapabilitiesTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, organizationCapabilitiesTable.capabilityId))
    .where(eq(organizationCapabilitiesTable.organizationId, org.id));

  res.json(assessments.map(a => ({ ...a, assessedAt: a.assessedAt.toISOString() })));
});

router.put("/organizations/:sessionToken/assessments", async (req, res) => {
  const { sessionToken } = req.params;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const parsed = UpsertAssessmentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const validCaps = await db
    .select({ id: capabilitiesTable.id })
    .from(capabilitiesTable)
    .where(eq(capabilitiesTable.industryId, org.industryId));
  const validCapIds = new Set(validCaps.map(c => c.id));

  const invalidCaps = parsed.data.assessments.filter(a => !validCapIds.has(a.capabilityId));
  if (invalidCaps.length > 0) {
    res.status(400).json({ error: `Capabilities [${invalidCaps.map(a => a.capabilityId).join(", ")}] do not belong to this organization's industry` });
    return;
  }

  await db.transaction(async (tx) => {
    for (const assessment of parsed.data.assessments) {
      const existing = await tx
        .select()
        .from(organizationCapabilitiesTable)
        .where(
          and(
            eq(organizationCapabilitiesTable.organizationId, org.id),
            eq(organizationCapabilitiesTable.capabilityId, assessment.capabilityId)
          )
        );

      if (existing.length > 0) {
        await tx
          .update(organizationCapabilitiesTable)
          .set({
            maturityScore: assessment.maturityScore,
            investmentLevel: assessment.investmentLevel || "moderate",
            strategicImportance: assessment.strategicImportance || "medium",
            notes: assessment.notes || null,
            assessedAt: new Date(),
          })
          .where(eq(organizationCapabilitiesTable.id, existing[0].id));
      } else {
        await tx.insert(organizationCapabilitiesTable).values({
          organizationId: org.id,
          capabilityId: assessment.capabilityId,
          maturityScore: assessment.maturityScore,
          investmentLevel: assessment.investmentLevel || "moderate",
          strategicImportance: assessment.strategicImportance || "medium",
          notes: assessment.notes || null,
        });
      }
    }
  });

  const assessments = await db
    .select({
      id: organizationCapabilitiesTable.id,
      organizationId: organizationCapabilitiesTable.organizationId,
      capabilityId: organizationCapabilitiesTable.capabilityId,
      capabilityName: capabilitiesTable.name,
      capabilitySlug: capabilitiesTable.slug,
      maturityScore: organizationCapabilitiesTable.maturityScore,
      investmentLevel: organizationCapabilitiesTable.investmentLevel,
      strategicImportance: organizationCapabilitiesTable.strategicImportance,
      notes: organizationCapabilitiesTable.notes,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      assessedAt: organizationCapabilitiesTable.assessedAt,
    })
    .from(organizationCapabilitiesTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, organizationCapabilitiesTable.capabilityId))
    .where(eq(organizationCapabilitiesTable.organizationId, org.id));

  res.json(assessments.map(a => ({ ...a, assessedAt: a.assessedAt.toISOString() })));
});

router.post("/organizations/:sessionToken/upload-csv", async (req, res) => {
  const { sessionToken } = req.params;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const contentType = req.headers["content-type"] || "";
  let csvText = "";

  if (contentType.includes("multipart/form-data")) {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve());
      req.on("error", reject);
    });
    const body = Buffer.concat(chunks).toString("utf-8");
    const parts = body.split(/------/);
    for (const part of parts) {
      if (part.includes("filename=")) {
        const contentStart = part.indexOf("\r\n\r\n");
        if (contentStart !== -1) {
          csvText = part.substring(contentStart + 4).trim();
          if (csvText.endsWith("--")) {
            csvText = csvText.slice(0, -2).trim();
          }
        }
      }
    }
  } else {
    csvText = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }

  if (!csvText) {
    res.status(400).json({ error: "No CSV content found" });
    return;
  }

  const lines = csvText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) {
    res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    return;
  }

  const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
  const slugIdx = headers.indexOf("capability_slug");
  const scoreIdx = headers.indexOf("maturity_score");
  const investIdx = headers.indexOf("investment_level");
  const importanceIdx = headers.indexOf("strategic_importance");
  const notesIdx = headers.indexOf("notes");

  if (slugIdx === -1 || scoreIdx === -1) {
    res.status(400).json({ error: "CSV must have 'capability_slug' and 'maturity_score' columns" });
    return;
  }

  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, org.industryId));
  const capBySlug = Object.fromEntries(caps.map(c => [c.slug, c]));

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    const slug = cols[slugIdx];
    const score = parseFloat(cols[scoreIdx]);

    if (!slug || isNaN(score)) {
      errors.push(`Row ${i + 1}: Invalid data`);
      skipped++;
      continue;
    }

    const cap = capBySlug[slug];
    if (!cap) {
      errors.push(`Row ${i + 1}: Unknown capability '${slug}'`);
      skipped++;
      continue;
    }

    if (score < 0 || score > 100) {
      errors.push(`Row ${i + 1}: Score must be between 0 and 100`);
      skipped++;
      continue;
    }

    const investment = investIdx !== -1 && cols[investIdx] ? cols[investIdx] : "moderate";
    const importance = importanceIdx !== -1 && cols[importanceIdx] ? cols[importanceIdx] : "medium";
    const notes = notesIdx !== -1 && cols[notesIdx] ? cols[notesIdx] : null;

    const existing = await db
      .select()
      .from(organizationCapabilitiesTable)
      .where(
        and(
          eq(organizationCapabilitiesTable.organizationId, org.id),
          eq(organizationCapabilitiesTable.capabilityId, cap.id)
        )
      );

    if (existing.length > 0) {
      await db
        .update(organizationCapabilitiesTable)
        .set({ maturityScore: score, investmentLevel: investment, strategicImportance: importance, notes, assessedAt: new Date() })
        .where(eq(organizationCapabilitiesTable.id, existing[0].id));
    } else {
      await db.insert(organizationCapabilitiesTable).values({
        organizationId: org.id,
        capabilityId: cap.id,
        maturityScore: score,
        investmentLevel: investment,
        strategicImportance: importance,
        notes,
      });
    }

    imported++;
  }

  res.json({ imported, skipped, errors });
});

export default router;
