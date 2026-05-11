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
  // Additional rotation pool members — same industries as above (Insurance,
  // Technology) but different companies/programs. case_studies has no
  // unique constraint on industryId so multiple rows per industry coexist.
  { industrySlug: "insurance",    companyName: "Allstate Corporation",   transformationHint: "Drivewise telematics program — loss-ratio impact, app-based onboarding" },
  { industrySlug: "technology",   companyName: "Sunrun Inc.",            transformationHint: "Residential solar operations platform — fleet management, customer acquisition cost reduction" },
];

/**
 * Find an existing case_studies row in the given industry whose
 * economics_breakdown is for the named company. Returns null if no match.
 * Used to make the seed idempotent across multiple companies per industry.
 */
async function findCaseStudyForCompany(industryId: number, companyName: string): Promise<typeof caseStudiesTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(caseStudiesTable)
    .where(eq(caseStudiesTable.industryId, industryId));
  const match = rows.find(r => r.economicsBreakdown?.companyName === companyName);
  return match ?? null;
}

/**
 * Create a stub case_studies row for a target. The agent's
 * generateCaseStudyContent flow can later regenerate the narrative fields
 * (executive_summary, situation, recommendations) on top of the same row.
 */
async function createStubCaseStudy(industryId: number, industryName: string, companyName: string): Promise<typeof caseStudiesTable.$inferSelect> {
  const [created] = await db.insert(caseStudiesTable).values({
    industryId,
    title: `${companyName} — ${industryName} capability transformation`,
    executiveSummary: `Reference economics for ${companyName}'s capability program in the ${industryName.toLowerCase()} sector. Pulled from public filings; see economics_breakdown.sources for citations.`,
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
    // Idempotency: look for an existing row with this company's breakdown.
    let caseStudy = await findCaseStudyForCompany(industry.id, target.companyName);
    if (caseStudy?.economicsBreakdown) {
      console.log(`[seed:case-study-economics] ${industry.name}/${target.companyName}: already populated, skipping`);
      skipped += 1;
      continue;
    }
    if (!caseStudy) {
      caseStudy = await createStubCaseStudy(industry.id, industry.name, target.companyName);
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
