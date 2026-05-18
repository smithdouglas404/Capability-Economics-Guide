/**
 * Featured case study scheduling + auto-rotation.
 *
 * Two responsibilities, both invoked by `featuredCaseStudyTick()` (called
 * from services/agent/scheduler.ts every 10 minutes):
 *
 *   1. applyDueSchedules() — pending one-off schedule rows whose
 *      scheduled_for has passed. Each row either promotes an existing
 *      case study OR generates a fresh one via Anthropic for a given
 *      industry, then features it.
 *
 *   2. runRotationIfDue() — if policy.mode='rotation' and we're past
 *      next_rotation_at, rotate. `rotationSource = "existing_rotate"`
 *      picks the next industry's most-recent case study; `"anthropic_new"`
 *      asks Anthropic to generate a fresh one before featuring.
 *
 * Industry rotation is LRU by current featured state — whichever industry
 * has gone longest without being featured is up next. This naturally
 * cycles all 6 industries evenly over time.
 */

import {
  db,
  caseStudiesTable,
  industriesTable,
  organizationsTable,
  featuredCaseStudyPolicyTable,
  featuredCaseStudyScheduleTable,
} from "@workspace/db";
import { and, eq, lte, desc, asc } from "drizzle-orm";
import { z } from "zod";
import { sonnet, generateObject, NoObjectGeneratedError } from "./workflows/models";
import { logger as log } from "../lib/logger";

const TICK_NAME = "[featured-case-study-rotation]";

const CaseStudySchema = z.object({
  title: z.string().max(80),
  executiveSummary: z.string(),
  situation: z.string(),
  challenges: z.array(z.string()).min(3).max(5),
  recommendations: z.array(z.object({
    title: z.string(),
    rationale: z.string(),
    impact: z.string(),
  })).min(3).max(5),
  fiveYearOutlook: z.string(),
  kpis: z.array(z.object({
    name: z.string(),
    baseline: z.string(),
    target: z.string(),
  })).min(3).max(5),
  sources: z.array(z.object({ url: z.string(), title: z.string() })),
});

/**
 * Ask Anthropic for a complete case study JSON for the given industry +
 * optional company hint. Inserts a row into case_studies and returns its
 * id. Returns null on any failure so the caller can keep the previous
 * featured study in place rather than blanking the homepage.
 */
async function generateAndInsertCaseStudy(industryId: number, companyName?: string | null): Promise<number | null> {
  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
  if (!industry) return null;

  // If no company hint, pick the highest-ranked reference org in this industry.
  let chosenCompany = companyName ?? null;
  if (!chosenCompany) {
    const [topOrg] = await db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.industryId, industryId))
      .orderBy(asc(organizationsTable.id))
      .limit(1);
    chosenCompany = topOrg?.name ?? industry.name;
  }

  const system = `You are an inflexcvi consultant. Produce a single executive case study about ${chosenCompany} in the ${industry.name} industry. Title format: "Acme Co — Industry capability transformation" (<= 80 chars). Ground in publicly knowable facts; no fabricated revenue figures. Be specific to ${industry.name}.`;

  try {
    const { object: parsed } = await generateObject({
      model: sonnet,
      schema: CaseStudySchema,
      system,
      prompt: `Generate the case study for ${chosenCompany} (${industry.name}).`,
      temperature: 0.3,
      maxTokens: 5000,
    });

    const [row] = await db.insert(caseStudiesTable).values({
      industryId,
      title: parsed.title,
      executiveSummary: parsed.executiveSummary,
      situation: parsed.situation,
      challenges: parsed.challenges,
      recommendations: parsed.recommendations,
      fiveYearOutlook: parsed.fiveYearOutlook,
      kpis: parsed.kpis,
      sources: parsed.sources,
      model: "anthropic/claude-sonnet-4.6",
      isFeatured: false, // featured flag is flipped separately by the caller
    }).returning({ id: caseStudiesTable.id });
    return row?.id ?? null;
  } catch (err) {
    if (err instanceof NoObjectGeneratedError) {
      log.warn({ err: err.message, text: err.text?.slice(0, 400), industryId, companyName }, `${TICK_NAME} schema mismatch after retry`);
    } else {
      log.warn({ err: err instanceof Error ? err.message : String(err), industryId, companyName }, `${TICK_NAME} generate failed`);
    }
    return null;
  }
}

/**
 * Atomically: clear all isFeatured flags, then set isFeatured=true on the
 * given case study id. Safe to call repeatedly.
 */
async function flipFeatured(caseStudyId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(caseStudiesTable).set({ isFeatured: false });
    await tx.update(caseStudiesTable).set({ isFeatured: true }).where(eq(caseStudiesTable.id, caseStudyId));
  });
}

/**
 * LRU industry: among all 6 (or industry_filter), pick the one whose
 * most-recently-featured case study was longest ago — falls back to
 * industry with no featured history at all.
 */
async function pickLruIndustry(filterSlug: string | null): Promise<number | null> {
  const all = await db.select({ id: industriesTable.id, slug: industriesTable.slug }).from(industriesTable);
  const eligible = filterSlug ? all.filter(i => i.slug === filterSlug) : all;
  if (eligible.length === 0) return null;
  // Score: most-recently featured case study generatedAt per industry; nulls = oldest.
  const scored: Array<{ industryId: number; lastFeaturedAt: Date | null }> = [];
  for (const ind of eligible) {
    const [latest] = await db
      .select({ at: caseStudiesTable.generatedAt })
      .from(caseStudiesTable)
      .where(and(eq(caseStudiesTable.industryId, ind.id), eq(caseStudiesTable.isFeatured, true)))
      .orderBy(desc(caseStudiesTable.generatedAt))
      .limit(1);
    scored.push({ industryId: ind.id, lastFeaturedAt: latest?.at ?? null });
  }
  scored.sort((a, b) => {
    if (a.lastFeaturedAt === null) return -1;
    if (b.lastFeaturedAt === null) return 1;
    return a.lastFeaturedAt.getTime() - b.lastFeaturedAt.getTime();
  });
  return scored[0]?.industryId ?? null;
}

async function applyDueSchedules(): Promise<{ executed: number; failed: number }> {
  const due = await db
    .select()
    .from(featuredCaseStudyScheduleTable)
    .where(and(
      eq(featuredCaseStudyScheduleTable.status, "pending"),
      lte(featuredCaseStudyScheduleTable.scheduledFor, new Date()),
    ))
    .orderBy(asc(featuredCaseStudyScheduleTable.scheduledFor));

  let executed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      let targetId: number | null = null;
      if (row.caseStudyId) {
        targetId = row.caseStudyId;
      } else if (row.generateForIndustryId) {
        targetId = await generateAndInsertCaseStudy(row.generateForIndustryId, row.generateCompanyName);
      }
      if (!targetId) {
        await db.update(featuredCaseStudyScheduleTable)
          .set({ status: "failed", errorMessage: "no target", executedAt: new Date() })
          .where(eq(featuredCaseStudyScheduleTable.id, row.id));
        failed++;
        continue;
      }
      await flipFeatured(targetId);
      await db.update(featuredCaseStudyScheduleTable)
        .set({ status: "executed", executedAt: new Date(), resultCaseStudyId: targetId })
        .where(eq(featuredCaseStudyScheduleTable.id, row.id));
      executed++;
      log.info({ scheduleId: row.id, featuredId: targetId }, `${TICK_NAME} schedule executed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(featuredCaseStudyScheduleTable)
        .set({ status: "failed", errorMessage: msg.slice(0, 400), executedAt: new Date() })
        .where(eq(featuredCaseStudyScheduleTable.id, row.id));
      failed++;
      log.warn({ scheduleId: row.id, err: msg }, `${TICK_NAME} schedule failed`);
    }
  }
  return { executed, failed };
}

async function runRotationIfDue(): Promise<{ rotated: boolean; reason?: string }> {
  const [policy] = await db.select().from(featuredCaseStudyPolicyTable).orderBy(asc(featuredCaseStudyPolicyTable.id)).limit(1);
  if (!policy) return { rotated: false, reason: "no policy row" };
  if (policy.mode !== "rotation") return { rotated: false, reason: "mode=manual" };
  if (policy.nextRotationAt && policy.nextRotationAt > new Date()) return { rotated: false, reason: "not yet due" };
  if (!policy.rotationDays || policy.rotationDays <= 0) return { rotated: false, reason: "no rotation_days configured" };

  const targetIndustryId = await pickLruIndustry(policy.industryFilter);
  if (!targetIndustryId) return { rotated: false, reason: "no eligible industry" };

  let targetId: number | null = null;
  if (policy.rotationSource === "anthropic_new") {
    targetId = await generateAndInsertCaseStudy(targetIndustryId, null);
  } else {
    // existing_rotate: pick the most recently generated case study in this
    // industry that ISN'T currently featured.
    const [pick] = await db
      .select({ id: caseStudiesTable.id })
      .from(caseStudiesTable)
      .where(and(eq(caseStudiesTable.industryId, targetIndustryId), eq(caseStudiesTable.isFeatured, false)))
      .orderBy(desc(caseStudiesTable.generatedAt))
      .limit(1);
    targetId = pick?.id ?? null;
  }
  if (!targetId) return { rotated: false, reason: "no target case study" };

  await flipFeatured(targetId);
  const now = new Date();
  const next = new Date(now.getTime() + policy.rotationDays * 24 * 60 * 60 * 1000);
  await db.update(featuredCaseStudyPolicyTable)
    .set({ lastRotatedAt: now, nextRotationAt: next })
    .where(eq(featuredCaseStudyPolicyTable.id, policy.id));
  log.info({ industryId: targetIndustryId, featuredId: targetId, nextAt: next.toISOString() }, `${TICK_NAME} rotated`);
  return { rotated: true };
}

/** Single entry point called by services/agent/scheduler.ts. */
export async function featuredCaseStudyTick(): Promise<{
  schedulesExecuted: number;
  schedulesFailed: number;
  rotated: boolean;
  rotationReason?: string;
}> {
  const schedules = await applyDueSchedules();
  const rotation = await runRotationIfDue();
  return {
    schedulesExecuted: schedules.executed,
    schedulesFailed: schedules.failed,
    rotated: rotation.rotated,
    rotationReason: rotation.reason,
  };
}
