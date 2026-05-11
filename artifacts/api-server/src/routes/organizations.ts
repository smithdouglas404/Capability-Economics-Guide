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
import {
  CreateOrganizationBody,
  UpsertAssessmentsBody,
  UpdateOrganizationBody,
  GetOrganizationParams,
  UpdateOrganizationParams,
  DeleteOrganizationParams,
  ListAssessmentsParams,
  UpsertAssessmentsParams,
  DeleteAssessmentParams,
  UploadCsvParams,
} from "@workspace/api-zod";

const validInvestmentLevels = new Set(["minimal", "low", "moderate", "high", "strategic"]);
const validImportanceLevels = new Set(["low", "medium", "high", "critical"]);

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
  const paramsParsed = GetOrganizationParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }

  const { sessionToken } = paramsParsed.data;

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
  const paramsParsed = ListAssessmentsParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }

  const { sessionToken } = paramsParsed.data;

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
  const paramsParsed = UpsertAssessmentsParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }

  const { sessionToken } = paramsParsed.data;

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
  const paramsParsed = UploadCsvParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }

  const { sessionToken } = paramsParsed.data;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const csvText = typeof req.body === "string" ? req.body.trim() : "";

  if (!csvText) {
    res.status(400).json({ error: "No CSV content found. Send CSV text in the request body with Content-Type: text/csv" });
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

    const rawInvestment = investIdx !== -1 && cols[investIdx] ? cols[investIdx].toLowerCase() : "moderate";
    const rawImportance = importanceIdx !== -1 && cols[importanceIdx] ? cols[importanceIdx].toLowerCase() : "medium";

    if (!validInvestmentLevels.has(rawInvestment)) {
      errors.push(`Row ${i + 1}: Invalid investment_level '${rawInvestment}'. Must be one of: minimal, low, moderate, high, strategic`);
      skipped++;
      continue;
    }
    if (!validImportanceLevels.has(rawImportance)) {
      errors.push(`Row ${i + 1}: Invalid strategic_importance '${rawImportance}'. Must be one of: low, medium, high, critical`);
      skipped++;
      continue;
    }

    const investment = rawInvestment;
    const importance = rawImportance;
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

router.put("/organizations/:sessionToken", async (req, res) => {
  const paramsParsed = UpdateOrganizationParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }

  const bodyParsed = UpdateOrganizationBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const { sessionToken } = paramsParsed.data;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const { name, size } = bodyParsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name) updates.name = name;
  if (size) updates.size = size;

  await db.update(organizationsTable).set(updates).where(eq(organizationsTable.id, org.id));

  const [updated] = await db
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
    .where(eq(organizationsTable.id, org.id));

  const [countResult] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(organizationCapabilitiesTable)
    .where(eq(organizationCapabilitiesTable.organizationId, org.id));

  res.json({
    ...updated,
    assessmentCount: countResult.count,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.delete("/organizations/:sessionToken", async (req, res) => {
  const paramsParsed = DeleteOrganizationParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }

  const { sessionToken } = paramsParsed.data;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  await db.delete(organizationsTable).where(eq(organizationsTable.id, org.id));
  res.status(204).send();
});

router.delete("/organizations/:sessionToken/assessments/:capabilityId", async (req, res) => {
  const paramsParsed = DeleteAssessmentParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  const { sessionToken, capabilityId } = paramsParsed.data;

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  await db
    .delete(organizationCapabilitiesTable)
    .where(
      and(
        eq(organizationCapabilitiesTable.organizationId, org.id),
        eq(organizationCapabilitiesTable.capabilityId, capabilityId)
      )
    );

  res.status(204).send();
});

// ───────────────────── Clerk linkage: claim + share + list-mine ─────────────────────

/**
 * Claim an existing session-token-only organization for the current Clerk
 * user. After claim, the org is readable via /me/organizations and the
 * (clerkUserId = me) gate. The session token continues to work for the
 * legacy assess flow.
 */
router.post("/organizations/:sessionToken/claim", async (req, res) => {
  const { getAuth } = await import("@clerk/express");
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionToken = req.params.sessionToken;
  if (typeof sessionToken !== "string" || sessionToken.length < 8) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
  if (org.clerkUserId && org.clerkUserId !== auth.userId) {
    res.status(409).json({ error: "Organization already claimed by another user" });
    return;
  }
  const [updated] = await db.update(organizationsTable).set({
    clerkUserId: auth.userId,
    updatedAt: new Date(),
  }).where(eq(organizationsTable.id, org.id)).returning();
  res.json({ organization: updated });
});

/**
 * Promote a personal org to team-shared by attaching a Clerk org id. Only
 * the current owner (clerkUserId = me) may share. To unshare, call with
 * clerkOrgId = null.
 */
router.post("/organizations/:sessionToken/share", async (req, res) => {
  const { getAuth, clerkClient } = await import("@clerk/express");
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionToken = req.params.sessionToken;
  if (typeof sessionToken !== "string" || sessionToken.length < 8) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }
  const body = req.body as { clerkOrgId?: string | null };
  if (body.clerkOrgId !== null && (typeof body.clerkOrgId !== "string" || !body.clerkOrgId.startsWith("org_"))) {
    res.status(400).json({ error: "Provide a Clerk org id (org_…) or null to unshare" });
    return;
  }
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }
  if (org.clerkUserId !== auth.userId) {
    res.status(403).json({ error: "Only the owner can share or unshare this organization" });
    return;
  }
  // Verify caller is a member of the target Clerk org.
  if (body.clerkOrgId) {
    try {
      const memberships = await clerkClient.users.getOrganizationMembershipList({ userId: auth.userId });
      const data = (memberships as unknown as { data?: Array<{ organization?: { id?: string } }> }).data
        ?? (memberships as unknown as Array<{ organization?: { id?: string } }>);
      const isMember = (data ?? []).some(m => m?.organization?.id === body.clerkOrgId);
      if (!isMember) {
        res.status(403).json({ error: "You are not a member of that Clerk organization" });
        return;
      }
    } catch (err) {
      res.status(500).json({ error: "Failed to verify Clerk org membership", message: (err as Error).message });
      return;
    }
  }
  const [updated] = await db.update(organizationsTable).set({
    clerkOrgId: body.clerkOrgId ?? null,
    updatedAt: new Date(),
  }).where(eq(organizationsTable.id, org.id)).returning();
  res.json({ organization: updated });
});

/** List orgs accessible to the current Clerk user (owned + team-shared). */
router.get("/me/organizations", async (req, res) => {
  const { listAccessibleOrgIds } = await import("../services/org-access");
  const ids = await listAccessibleOrgIds(req);
  if (ids.length === 0) { res.json({ organizations: [] }); return; }
  const rows = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      industryId: organizationsTable.industryId,
      industryName: industriesTable.name,
      size: organizationsTable.size,
      clerkUserId: organizationsTable.clerkUserId,
      clerkOrgId: organizationsTable.clerkOrgId,
      sessionToken: organizationsTable.sessionToken,
      createdAt: organizationsTable.createdAt,
    })
    .from(organizationsTable)
    .innerJoin(industriesTable, eq(industriesTable.id, organizationsTable.industryId))
    .where(sql`${organizationsTable.id} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);
  res.json({
    organizations: rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      mode: r.clerkOrgId ? "team" as const : r.clerkUserId ? "personal" as const : "legacy" as const,
    })),
  });
});

export default router;
