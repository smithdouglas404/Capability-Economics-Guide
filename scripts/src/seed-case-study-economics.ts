/**
 * Seed the `case_studies.economics_breakdown` column for six well-documented
 * public-company capability transformations. The breakdowns are sourced
 * live from Perplexity (sonar-deep-research) at seed time, parsed into the
 * structured economics_breakdown shape, and stored.
 *
 * Idempotent: a case study that already has economics_breakdown populated
 * is skipped. To force a refresh, NULL the column first.
 *
 * If the matching case_studies row doesn't exist yet (agent hasn't generated
 * one for that industry), the seed creates a minimal stub so the economics
 * breakdown has somewhere to live; the agent can later regenerate the
 * narrative fields (executive_summary, situation, recommendations) on top
 * of the same row.
 *
 * Skip with SKIP_CASE_STUDY_ECONOMICS_SEED=1.
 */
import { db } from "@workspace/db";
import {
  caseStudiesTable,
  industriesTable,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  researchEconomicsBreakdown,
  type EconomicsBreakdown,
} from "../../artifacts/api-server/src/services/case-study-economics-research";

interface SeedTarget {
  industrySlug: string;
  companyName: string;
  transformationHint: string;
}

// Six target transformations — public companies + their best-documented
// capability program. Add to this list to extend rotation. Each is a real
// transformation with publicly-disclosed financials.
const TARGETS: SeedTarget[] = [
  { industrySlug: "insurance",    companyName: "Progressive Corp",       transformationHint: "Snapshot usage-based insurance program — telematics + digital onboarding, segmented loss-ratio impact" },
  { industrySlug: "banking",      companyName: "JPMorgan Chase",         transformationHint: "annual technology budget + AI/COiN contract intelligence program" },
  { industrySlug: "technology",   companyName: "Microsoft Corporation",  transformationHint: "Azure + Microsoft 365 Copilot AI integration capital expenditure and reported revenue contribution" },
  { industrySlug: "retail",       companyName: "Walmart Inc.",           transformationHint: "supply-chain automation, omnichannel fulfillment investment vs digital sales contribution" },
  { industrySlug: "healthcare",   companyName: "UnitedHealth Group",     transformationHint: "Optum data and AI platform investments, claims-automation savings" },
  { industrySlug: "manufacturing",companyName: "Caterpillar Inc.",       transformationHint: "Cat Connect / industrial-IoT fleet telematics, Services revenue contribution" },
];

async function ensureCaseStudyForIndustry(industryId: number, industryName: string): Promise<typeof caseStudiesTable.$inferSelect | null> {
  // Prefer the featured row; otherwise the most recent. Mirror the pattern
  // in /api/featured-case-study.
  const existingRows = await db
    .select()
    .from(caseStudiesTable)
    .where(eq(caseStudiesTable.industryId, industryId));
  const featured = existingRows.find(r => r.isFeatured) ?? existingRows[0];
  if (featured) return featured;

  // Create a stub. The agent's generateCaseStudyContent flow can later
  // regenerate executive_summary / situation / recommendations on top of
  // the same row; the economics_breakdown we attach is independent of
  // those fields.
  const [created] = await db.insert(caseStudiesTable).values({
    industryId,
    title: `${industryName} capability transformation — featured analogy`,
    executiveSummary: `Reference economics for a real ${industryName.toLowerCase()} sector capability program. Pulled from public filings; see economics_breakdown.sources for citations.`,
    situation: "Auto-generated stub — regenerate with the case-study agent to populate the full narrative.",
    challenges: [],
    recommendations: [],
    fiveYearOutlook: "Pending agent regeneration.",
    kpis: [],
    sources: [],
    model: "seed:case-study-economics",
    isFeatured: false,
  }).returning();
  return created;
}

async function persistBreakdown(caseStudyId: number, breakdown: EconomicsBreakdown): Promise<void> {
  await db.update(caseStudiesTable)
    .set({ economicsBreakdown: breakdown })
    .where(eq(caseStudiesTable.id, caseStudyId));
}

async function main(): Promise<void> {
  if (process.env.SKIP_CASE_STUDY_ECONOMICS_SEED === "1") {
    console.log("[seed:case-study-economics] SKIP_CASE_STUDY_ECONOMICS_SEED=1 — skipping");
    return;
  }
  if (!process.env.PERPLEXITY_API_KEY) {
    console.log("[seed:case-study-economics] PERPLEXITY_API_KEY not set — skipping (column stays null, frontend falls back gracefully)");
    return;
  }

  const industries = await db.select().from(industriesTable);
  const indBySlug = new Map(industries.map(i => [i.slug, i]));

  let researched = 0, skipped = 0, failed = 0;
  for (const target of TARGETS) {
    const industry = indBySlug.get(target.industrySlug);
    if (!industry) {
      console.log(`[seed:case-study-economics] industry not seeded: ${target.industrySlug} — skipping ${target.companyName}`);
      skipped += 1;
      continue;
    }
    const caseStudy = await ensureCaseStudyForIndustry(industry.id, industry.name);
    if (!caseStudy) {
      console.log(`[seed:case-study-economics] could not get/create case study for ${industry.name} — skipping`);
      skipped += 1;
      continue;
    }
    if (caseStudy.economicsBreakdown) {
      console.log(`[seed:case-study-economics] ${industry.name}/${target.companyName}: already populated, skipping`);
      skipped += 1;
      continue;
    }
    console.log(`[seed:case-study-economics] researching ${target.companyName} in ${industry.name}…`);
    const breakdown = await researchEconomicsBreakdown({
      companyName: target.companyName,
      industryName: industry.name,
      transformationHint: target.transformationHint,
    });
    if (!breakdown) {
      console.log(`[seed:case-study-economics] ✗ research returned null for ${target.companyName} — leaving null`);
      failed += 1;
      continue;
    }
    await persistBreakdown(caseStudy.id, breakdown);
    console.log(`[seed:case-study-economics] ✓ ${target.companyName} → case_study #${caseStudy.id} (${breakdown.eventTitle})`);
    researched += 1;
  }
  console.log(`[seed:case-study-economics] done. researched=${researched} skipped=${skipped} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:case-study-economics] fatal:", err);
    process.exit(1);
  });
