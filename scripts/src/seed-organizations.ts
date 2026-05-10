import {
  db,
  industriesTable,
  capabilitiesTable,
  organizationsTable,
  organizationCapabilitiesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { queryPerplexity, extractJson } from "./perplexity-client";

type RefOrg = {
  name: string;
  industrySlug: string;
  size: "large" | "mid" | "small";
  publicTicker?: string;
  oneLiner: string;
};

const REFERENCE_ORGS: RefOrg[] = [
  { name: "Allstate", industrySlug: "insurance", size: "large", publicTicker: "ALL", oneLiner: "Top-5 US P&C insurer with national agent network and growing telematics-driven auto book." },
  { name: "Progressive", industrySlug: "insurance", size: "large", publicTicker: "PGR", oneLiner: "Auto-insurance leader known for usage-based pricing (Snapshot) and direct-channel scale." },

  { name: "UnitedHealth Group", industrySlug: "healthcare", size: "large", publicTicker: "UNH", oneLiner: "Largest US health insurer + Optum services arm spanning pharmacy, data, and care delivery." },
  { name: "HCA Healthcare", industrySlug: "healthcare", size: "large", publicTicker: "HCA", oneLiner: "One of the largest US for-profit hospital operators with 180+ hospitals and 2,300+ care sites." },

  { name: "JPMorgan Chase", industrySlug: "banking", size: "large", publicTicker: "JPM", oneLiner: "Largest US bank by assets; leader in payments, wholesale banking and consumer fintech investment." },
  { name: "Bank of America", industrySlug: "banking", size: "large", publicTicker: "BAC", oneLiner: "Top-3 US universal bank with industry-leading mobile banking adoption and Erica AI assistant." },

  { name: "Tesla", industrySlug: "manufacturing", size: "large", publicTicker: "TSLA", oneLiner: "Vertically-integrated EV and energy manufacturer with industry-leading software-defined factories." },
  { name: "Caterpillar", industrySlug: "manufacturing", size: "large", publicTicker: "CAT", oneLiner: "Global heavy-equipment manufacturer with mature dealer network and connected-asset telematics." },

  { name: "Microsoft", industrySlug: "technology", size: "large", publicTicker: "MSFT", oneLiner: "Hyperscaler with leading enterprise cloud (Azure), productivity (M365) and AI platform (Copilot)." },
  { name: "Anthropic", industrySlug: "technology", size: "mid", oneLiner: "Frontier AI lab building the Claude family of models with a research-first safety posture." },

  { name: "Walmart", industrySlug: "retail", size: "large", publicTicker: "WMT", oneLiner: "Largest global retailer; massive omnichannel operation, fast-growing marketplace and ad business." },

  { name: "Sunrun", industrySlug: "residential-solar", size: "large", publicTicker: "RUN", oneLiner: "Largest US residential solar installer with subscription/PPA financing model and growing storage attach." },
];

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
  org: RefOrg,
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

  const user = `Organization: ${org.name} (${org.industrySlug} industry${org.publicTicker ? `, ticker ${org.publicTicker}` : ""}).
Context: ${org.oneLiner}

Industry: ${industryName}

Available capability slugs (use ONLY these, exactly as written):
${capList}

Score 6-10 of these capabilities for ${org.name} based on real, citable public evidence. Return ONLY the JSON.`;

  const result = await queryPerplexity([
    { role: "system", content: sys },
    { role: "user", content: user },
  ]);
  const parsed = extractJson<PerplexityScoring>(result.content);
  // Merge any top-level Perplexity citations into per-cap citations as fallback evidence.
  if (result.citations.length) {
    for (const sc of parsed.scored_capabilities) {
      if (!sc.citations || sc.citations.length === 0) sc.citations = result.citations.slice(0, 3);
    }
  }
  return parsed;
}

async function main() {
  const force = process.argv.includes("--force");
  console.log(`Seeding ${REFERENCE_ORGS.length} reference organizations${force ? " (force re-score)" : ""}...`);

  const industries = await db.select().from(industriesTable);
  const indByslug = new Map(industries.map((i) => [i.slug, i]));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let totalMappings = 0;

  for (const org of REFERENCE_ORGS) {
    const industry = indByslug.get(org.industrySlug);
    if (!industry) {
      console.warn(`  ! Industry "${org.industrySlug}" not found — skipping ${org.name}`);
      continue;
    }

    const sessionToken = `seed:${org.industrySlug}:${org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    const [existing] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.sessionToken, sessionToken));

    let orgId: number;
    if (existing) {
      orgId = existing.id;
      if (!force) {
        const existingMappings = await db.select({ id: organizationCapabilitiesTable.id })
          .from(organizationCapabilitiesTable)
          .where(eq(organizationCapabilitiesTable.organizationId, orgId));
        if (existingMappings.length > 0) {
          console.log(`  · ${org.name}: already seeded with ${existingMappings.length} mappings — skipping (use --force to re-score)`);
          skipped++;
          totalMappings += existingMappings.length;
          continue;
        }
      } else {
        await db.delete(organizationCapabilitiesTable).where(eq(organizationCapabilitiesTable.organizationId, orgId));
      }
    } else {
      const [created] = await db.insert(organizationsTable).values({
        name: org.name,
        industryId: industry.id,
        size: org.size,
        sessionToken,
      }).returning();
      orgId = created.id;
    }

    const caps = await db.select({ slug: capabilitiesTable.slug, name: capabilitiesTable.name, id: capabilitiesTable.id })
      .from(capabilitiesTable)
      .where(and(eq(capabilitiesTable.industryId, industry.id), eq(capabilitiesTable.isLeaf, true)));

    if (caps.length === 0) {
      console.warn(`  ! No leaf capabilities for ${industry.name} — skipping ${org.name}`);
      continue;
    }

    const slugToId = new Map(caps.map((c) => [c.slug, c.id]));

    process.stdout.write(`  → ${org.name} (${industry.name})… `);
    let scoring: PerplexityScoring;
    try {
      scoring = await scoreOrgCapabilities(org, industry.name, caps);
    } catch (err) {
      console.log(`FAILED (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }

    const droppedNoCitation: string[] = [];
    const droppedUnknownSlug: string[] = [];
    const validRows = scoring.scored_capabilities
      .filter((sc) => {
        if (!slugToId.has(sc.capability_slug)) { droppedUnknownSlug.push(sc.capability_slug); return false; }
        // Hard requirement (per project rules): every seeded score must have at least one citation.
        const cites = Array.isArray(sc.citations) ? sc.citations.filter((c) => typeof c === "string" && c.trim().length > 0) : [];
        if (cites.length === 0) { droppedNoCitation.push(sc.capability_slug); return false; }
        return true;
      })
      .map((sc) => ({
        organizationId: orgId,
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
      continue;
    }

    await db.insert(organizationCapabilitiesTable).values(validRows).onConflictDoNothing();

    if (existing) updated++;
    else inserted++;
    totalMappings += validRows.length;
    const dropNote = (droppedNoCitation.length || droppedUnknownSlug.length)
      ? ` (dropped ${droppedNoCitation.length} no-citation, ${droppedUnknownSlug.length} unknown-slug)` : "";
    console.log(`${validRows.length} mappings${dropNote}`);
  }

  console.log(`\nDone. inserted=${inserted} updated=${updated} skipped=${skipped} totalMappings=${totalMappings}`);
  console.log(`Total reference orgs in DB: ${(await db.select().from(organizationsTable)).length}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
