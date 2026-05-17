/**
 * Per-capability scoring for reference orgs.
 *
 * The reference org SET (which companies are anchors) is now populated by
 * `seed-reference-orgs.ts` from a defensible criterion stored in
 * `reference_org_selection_rule`. This script no longer owns that list.
 *
 * What this script still does (unchanged): for each reference org in the DB,
 * call Perplexity to score 6-10 of that industry's capabilities for the org
 * with required URL citations. Inserts into `organization_capabilities`.
 *
 * Reference orgs are identified by `sessionToken LIKE 'seed:reference:%'`
 * (the prefix the new populator writes). Customer-added orgs (with Clerk
 * userIds or arbitrary sessionTokens) are never scored by this script.
 *
 * Idempotent: orgs that already have any capability mappings are skipped
 * unless `--force` is passed. Per-org Perplexity failures are logged but
 * never fail the deploy (matches the gdp-weights + reference-orgs pattern).
 *
 * Skip with SKIP_ORGANIZATIONS_SEED=1.
 */
import {
  db,
  industriesTable,
  capabilitiesTable,
  organizationsTable,
  organizationCapabilitiesTable,
} from "@workspace/db";
import { eq, and, like, inArray } from "drizzle-orm";
import { queryPerplexity, extractJson } from "./perplexity-client";

type ScoredCap = {
  capability_slug: string;
  maturity_score: number;
  investment_level: "high" | "moderate" | "low";
  strategic_importance: "high" | "medium" | "low";
  rationale: string;
  citations: string[];
};

type PerplexityScoring = {
  organization: string;
  scored_capabilities: ScoredCap[];
};

async function scoreOrgCapabilities(
  orgName: string,
  industryName: string,
  capabilities: Array<{ slug: string; name: string }>,
): Promise<PerplexityScoring> {
  const capList = capabilities.map((c, i) => `${i + 1}. ${c.slug} — ${c.name}`).join("\n");
  const sys = `You are a senior industry analyst. Return ONLY a single valid JSON object, no markdown, no code fences, no commentary. Schema:
{
  "organization": "<org name>",
  "scored_capabilities": [
    {
      "capability_slug": "<must be one of the slugs from the list>",
      "maturity_score": <integer 0-100>,
      "investment_level": "high"|"moderate"|"low",
      "strategic_importance": "high"|"medium"|"low",
      "rationale": "<1-2 sentences citing concrete public evidence>",
      "citations": ["<url 1>", "<url 2>"]
    }
  ]
}
Pick 6-10 capabilities where the organization has the strongest, most evidenced position (or, if relevant, a documented weakness — but score it accurately). Maturity scores must reflect real, recent (2023-2026) public evidence: annual reports, earnings calls, analyst reports, press releases, regulatory filings. Use only capability_slug values from the supplied list. Citations must be real URLs (filings, news, reports). If a slug doesn't fit, omit it — do not invent slugs.`;

  const user = `Organization: ${orgName} (${industryName} industry).

Industry: ${industryName}

Available capability slugs (use ONLY these, exactly as written):
${capList}

Score 6-10 of these capabilities for ${orgName} based on real, citable public evidence. Return ONLY the JSON.`;

  const result = await queryPerplexity([
    { role: "system", content: sys },
    { role: "user", content: user },
  ]);
  const parsed = extractJson<PerplexityScoring>(result.content);
  if (result.citations.length) {
    for (const sc of parsed.scored_capabilities) {
      if (!sc.citations || sc.citations.length === 0) sc.citations = result.citations.slice(0, 3);
    }
  }
  return parsed;
}

async function main() {
  if (process.env.SKIP_ORGANIZATIONS_SEED === "1" || process.env.SKIP_ORGANIZATIONS_SEED === "true") {
    console.log("[seed:organizations] SKIP_ORGANIZATIONS_SEED set — skipping");
    process.exit(0);
  }
  if (!process.env.PERPLEXITY_API_KEY) {
    console.warn("[seed:organizations] PERPLEXITY_API_KEY not set — skipping (orgs will have no capability scores until the key is provided and the seed re-runs).");
    process.exit(0);
  }

  const force = process.argv.includes("--force");
  const verbose = process.argv.includes("--verbose") || process.env.SEED_ORGS_VERBOSE === "1";

  // Pull all reference orgs the new populator wrote.
  const refOrgs = await db.select().from(organizationsTable).where(like(organizationsTable.sessionToken, "seed:reference:%"));

  if (refOrgs.length === 0) {
    console.log("[seed:organizations] no reference orgs in DB — run seed:reference-orgs first. Skipping.");
    process.exit(0);
  }

  // Industry lookup, keyed by id.
  const industries = await db.select().from(industriesTable);
  const indById = new Map(industries.map((i) => [i.id, i]));

  let scored = 0;
  let skipped = 0;
  let failed = 0;
  let totalMappings = 0;
  const skippedSamples: string[] = [];

  // Fast-path: if NOT forcing, batch-check existing mappings per org first so
  // we can emit a single summary line for the (very common) "everything is
  // already scored" case instead of N lines of "skipping". Saves ~60 lines
  // of log noise per deploy.
  if (!force) {
    const orgIds = refOrgs.map((o) => o.id);
    const existingByOrg = orgIds.length > 0
      ? await db.select({ orgId: organizationCapabilitiesTable.organizationId, capId: organizationCapabilitiesTable.id })
          .from(organizationCapabilitiesTable)
          .where(inArray(organizationCapabilitiesTable.organizationId, orgIds))
      : [];
    const mappingCountByOrg = new Map<number, number>();
    for (const r of existingByOrg) mappingCountByOrg.set(r.orgId, (mappingCountByOrg.get(r.orgId) ?? 0) + 1);
    const allAlreadyScored = refOrgs.every((o) => (mappingCountByOrg.get(o.id) ?? 0) > 0);
    if (allAlreadyScored) {
      const totalExistingMappings = Array.from(mappingCountByOrg.values()).reduce((a, b) => a + b, 0);
      console.log(`[seed:organizations] all ${refOrgs.length} reference orgs already scored (${totalExistingMappings} mappings total) — skipping all. Run with --force to re-score, or --verbose / SEED_ORGS_VERBOSE=1 to list each org.`);
      console.log(`[seed:organizations] done. scored=0 skipped=${refOrgs.length} failed=0 totalMappings=${totalExistingMappings}`);
      console.log(`[seed:organizations] reference orgs in DB: ${refOrgs.length}`);
      process.exit(0);
    }
  }

  // Mixed state (some orgs unscored, or --force): fall through to per-org loop
  // and only log per-org lines when we actually do work (or under --verbose).
  console.log(`[seed:organizations] found ${refOrgs.length} reference orgs to score${force ? " (force re-score)" : ""}`);

  for (const org of refOrgs) {
    const industry = indById.get(org.industryId);
    if (!industry) {
      console.warn(`  ! ${org.name}: industry id=${org.industryId} missing — skipping`);
      failed++;
      continue;
    }

    if (!force) {
      const existingMappings = await db.select({ id: organizationCapabilitiesTable.id })
        .from(organizationCapabilitiesTable)
        .where(eq(organizationCapabilitiesTable.organizationId, org.id));
      if (existingMappings.length > 0) {
        if (verbose) {
          console.log(`  · ${org.name}: already scored with ${existingMappings.length} mappings — skipping`);
        } else if (skippedSamples.length < 3) {
          skippedSamples.push(`${org.name} (${existingMappings.length})`);
        }
        skipped++;
        totalMappings += existingMappings.length;
        continue;
      }
    } else {
      await db.delete(organizationCapabilitiesTable).where(eq(organizationCapabilitiesTable.organizationId, org.id));
    }

    const caps = await db.select({ slug: capabilitiesTable.slug, name: capabilitiesTable.name, id: capabilitiesTable.id })
      .from(capabilitiesTable)
      .where(and(eq(capabilitiesTable.industryId, industry.id), eq(capabilitiesTable.isLeaf, true)));

    if (caps.length === 0) {
      console.warn(`  ! ${org.name}: no leaf capabilities for industry ${industry.name} — skipping`);
      failed++;
      continue;
    }

    const slugToId = new Map(caps.map((c) => [c.slug, c.id]));

    process.stdout.write(`  → ${org.name} (${industry.name})… `);
    let scoring: PerplexityScoring;
    try {
      scoring = await scoreOrgCapabilities(org.name, industry.name, caps);
    } catch (err) {
      console.log(`FAILED (${err instanceof Error ? err.message : String(err)})`);
      failed++;
      continue;
    }

    const droppedNoCitation: string[] = [];
    const droppedUnknownSlug: string[] = [];
    const validRows = scoring.scored_capabilities
      .filter((sc) => {
        if (!slugToId.has(sc.capability_slug)) { droppedUnknownSlug.push(sc.capability_slug); return false; }
        const cites = Array.isArray(sc.citations) ? sc.citations.filter((c) => typeof c === "string" && c.trim().length > 0) : [];
        if (cites.length === 0) { droppedNoCitation.push(sc.capability_slug); return false; }
        return true;
      })
      .map((sc) => ({
        organizationId: org.id,
        capabilityId: slugToId.get(sc.capability_slug)!,
        maturityScore: Math.max(0, Math.min(100, Number(sc.maturity_score) || 0)),
        investmentLevel: ["high", "moderate", "low"].includes(sc.investment_level) ? sc.investment_level : "moderate",
        strategicImportance: ["high", "medium", "low"].includes(sc.strategic_importance) ? sc.strategic_importance : "medium",
        notes: JSON.stringify({
          rationale: sc.rationale ?? "",
          citations: Array.isArray(sc.citations) ? sc.citations.slice(0, 5) : [],
          source: "perplexity-seed",
          scoredAt: new Date().toISOString(),
        }),
      }));

    if (validRows.length === 0) {
      console.log(`no valid mappings returned (dropped: ${droppedUnknownSlug.length} unknown slug, ${droppedNoCitation.length} no-citation)`);
      failed++;
      continue;
    }

    await db.insert(organizationCapabilitiesTable).values(validRows).onConflictDoNothing();
    scored++;
    totalMappings += validRows.length;
    const dropNote = (droppedNoCitation.length || droppedUnknownSlug.length)
      ? ` (dropped ${droppedNoCitation.length} no-citation, ${droppedUnknownSlug.length} unknown-slug)` : "";
    console.log(`${validRows.length} mappings${dropNote}`);
  }

  // If we skipped any silently in the mixed-state path, surface a brief sample
  // so the log still tells the operator what was skipped without flooding.
  if (skipped > 0 && !verbose && skippedSamples.length > 0) {
    const more = skipped > skippedSamples.length ? ` and ${skipped - skippedSamples.length} more` : "";
    console.log(`[seed:organizations] skipped ${skipped} already-scored orgs (e.g. ${skippedSamples.join(", ")}${more}) — run with --verbose / SEED_ORGS_VERBOSE=1 to list each.`);
  }
  console.log(`\n[seed:organizations] done. scored=${scored} skipped=${skipped} failed=${failed} totalMappings=${totalMappings}`);
  console.log(`[seed:organizations] reference orgs in DB: ${refOrgs.length}`);
  // Always exit 0 — per-org failures don't break the deploy.
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:organizations] catastrophic error:", err);
  process.exit(1);
});
