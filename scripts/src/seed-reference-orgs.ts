/**
 * Perplexity-driven reference org populator.
 *
 * Replaces the previous hand-curated 12-org list in `seed-organizations.ts`.
 * For each industry, reads the active criterion from
 * `reference_org_selection_rule` and asks Perplexity to return the orgs that
 * match that criterion (with required source URLs).
 *
 * The populator only INSERTS new orgs and UPDATES metadata on existing ones.
 * It never deletes — orgs that drop off the list on a refresh stay in the DB
 * (they may still be referenced by customer assessments). To do a clean
 * reset, set RESET_REFERENCE_ORGS=1 (deletes all rows with sessionToken
 * starting `seed:reference:` before populating).
 *
 * Skip flags:
 *   SKIP_REFERENCE_ORGS_SEED=1   — bypass entirely (exit 0)
 *   PERPLEXITY_API_KEY missing   — graceful degrade (exit 0, log warning)
 *   FORCE_REFERENCE_ORGS_REFRESH=1 — re-run even if within refresh window
 *
 * Exit codes:
 *   0 — success or graceful degrade. Per-industry Perplexity failures are
 *       logged but never fail the deploy.
 *   1 — catastrophic error only.
 *
 * Note: the per-capability SCORING of each org still happens in
 * `seed-organizations.ts` after this populator runs (it reads from the DB,
 * not from a hardcoded list).
 */
import { db, industriesTable, organizationsTable, referenceOrgSelectionRuleTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";

if (process.env.SKIP_REFERENCE_ORGS_SEED === "1" || process.env.SKIP_REFERENCE_ORGS_SEED === "true") {
  console.log("[seed:reference-orgs] SKIP_REFERENCE_ORGS_SEED set — skipping");
  process.exit(0);
}
if (!process.env.PERPLEXITY_API_KEY) {
  console.warn("[seed:reference-orgs] PERPLEXITY_API_KEY not set — skipping. Reference orgs will not be populated until the key is provided and the seed re-runs.");
  process.exit(0);
}

const FORCE = process.env.FORCE_REFERENCE_ORGS_REFRESH === "1";
const RESET = process.env.RESET_REFERENCE_ORGS === "1";

interface PerplexityOrg {
  name: string;
  ticker_or_private: string; // "private" | "<TICKER>"
  hq_country: string;
  revenue_usd_mm: number;
  revenue_year: number;
  source_url: string;
  one_liner?: string;
}

function extractJsonArray(s: string): unknown[] {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]! : s;
  const m = body.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("No JSON array in Perplexity response");
  const parsed = JSON.parse(m[0]);
  if (!Array.isArray(parsed)) throw new Error("Parsed Perplexity body is not an array");
  return parsed;
}

async function callPerplexity(industryName: string, ruleText: string, model: string): Promise<PerplexityOrg[]> {
  const prompt = `Apply the following selection rule to the "${industryName}" industry:

RULE:
${ruleText}

Return ONLY a single JSON array (no prose, no markdown fences) of objects with this exact shape:
[
  {
    "name": "<company legal name>",
    "ticker_or_private": "<stock ticker if public, e.g. 'JPM'; or 'private' if not publicly traded>",
    "hq_country": "<ISO country name, e.g. 'United States', 'Germany'>",
    "revenue_usd_mm": <number, most recent trailing-12-month revenue in USD millions>,
    "revenue_year": <integer YYYY, the fiscal year the revenue figure is from>,
    "source_url": "<URL of the annual report, regulatory filing, Bloomberg/Forbes/S&P page, or audited financials supporting the revenue figure — NOT a generic Wikipedia link>",
    "one_liner": "<one sentence describing what the company does and its position in the industry>"
  }
]

Requirements:
- Apply the RULE faithfully. If the rule requires "at least 2 non-US companies" and you cannot find 2 with citable data, return fewer rows rather than padding with weak entries.
- Every entry MUST have a working source_url to an authoritative source for the revenue figure. Rows without a real source URL will be dropped.
- For private companies, the source_url can be a recognized industry-revenue tracker (Forbes, Bloomberg, S&P, IDC, Gartner) or the company's own audited financials.
- Do not invent companies. Do not invent revenue figures. If the rule asks for 10 but only 6 verifiably meet it, return 6.
- Order by revenue_usd_mm descending.

Return ONLY the JSON array.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a precise industry research analyst. Output STRICT JSON only — no markdown, no prose outside the JSON array." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Perplexity ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content ?? "";
    return extractJsonArray(content) as PerplexityOrg[];
  } finally {
    clearTimeout(timeout);
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isValidOrg(o: PerplexityOrg): boolean {
  if (!o.name || typeof o.name !== "string") return false;
  if (!o.source_url || typeof o.source_url !== "string" || o.source_url.length < 10) return false;
  if (typeof o.revenue_usd_mm !== "number" || o.revenue_usd_mm <= 0) return false;
  return true;
}

function revenueBandFor(usdMm: number): string {
  if (usdMm < 10) return "lt_10m";
  if (usdMm < 100) return "10m_100m";
  if (usdMm < 1_000) return "100m_1b";
  if (usdMm < 10_000) return "1b_10b";
  return "gt_10b";
}

function sizeFor(usdMm: number): string {
  // Use revenue as a proxy for org size when employee count isn't available.
  if (usdMm < 100) return "small";
  if (usdMm < 5_000) return "mid";
  return "large";
}

async function main(): Promise<void> {
  // Optional clean-slate reset (user-triggered, never automatic).
  if (RESET) {
    const deleted = await db.delete(organizationsTable).where(like(organizationsTable.sessionToken, "seed:reference:%")).returning({ id: organizationsTable.id });
    console.log(`[seed:reference-orgs] RESET_REFERENCE_ORGS=1 — deleted ${deleted.length} rows with sessionToken LIKE 'seed:reference:%'`);
  }

  const [rule] = await db.select().from(referenceOrgSelectionRuleTable).limit(1);
  if (!rule) {
    console.warn("[seed:reference-orgs] no rule row found — run seed:reference-org-rule first. Skipping.");
    process.exit(0);
  }

  // Refresh window guard: don't re-run if we've applied recently (unless FORCE).
  if (!FORCE && !RESET && rule.lastAppliedAt) {
    const ageDays = (Date.now() - new Date(rule.lastAppliedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < rule.refreshIntervalDays) {
      console.log(`[seed:reference-orgs] rule applied ${ageDays.toFixed(1)}d ago, refresh window is ${rule.refreshIntervalDays}d — skipping. Set FORCE_REFERENCE_ORGS_REFRESH=1 to override.`);
      process.exit(0);
    }
  }

  const inds = await db.select().from(industriesTable);
  console.log(`[seed:reference-orgs] applying rule v${rule.ruleVersion} (model=${rule.perplexityModel}) to ${inds.length} industries`);

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalDropped = 0;
  const errors: string[] = [];

  for (const ind of inds) {
    try {
      const orgs = await callPerplexity(ind.name, rule.ruleText, rule.perplexityModel);
      const valid = orgs.filter(isValidOrg);
      const dropped = orgs.length - valid.length;
      totalDropped += dropped;

      let indInserted = 0;
      let indUpdated = 0;

      for (const o of valid) {
        const sessionToken = `seed:reference:${ind.slug}:${slugify(o.name)}`;
        const ticker = o.ticker_or_private && o.ticker_or_private.toLowerCase() !== "private" ? o.ticker_or_private : null;
        const oneLiner = o.one_liner ?? `${o.name} — ${o.hq_country}-headquartered, ${o.revenue_year} revenue ~$${(o.revenue_usd_mm / 1000).toFixed(1)}B${ticker ? ` (${ticker})` : " (private)"}.`;

        // Metadata blob stored in notes JSON of organization_capabilities later;
        // for the org row itself, store geography + revenue_band + size.
        const geography = (() => {
          const c = o.hq_country.toLowerCase();
          if (c.includes("united states") || c.includes("usa") || c === "us") return "na";
          if (c.includes("canada") || c.includes("mexico")) return "na";
          if (c.includes("brazil") || c.includes("argentina") || c.includes("chile")) return "latam";
          if (c.includes("china") || c.includes("japan") || c.includes("korea") || c.includes("india") || c.includes("singapore") || c.includes("australia")) return "apac";
          if (c.includes("germany") || c.includes("france") || c.includes("united kingdom") || c.includes("uk") || c.includes("netherlands") || c.includes("spain") || c.includes("italy")) return "emea";
          return "global";
        })();

        const [existing] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));

        if (existing) {
          await db.update(organizationsTable).set({
            name: o.name,
            industryId: ind.id,
            size: sizeFor(o.revenue_usd_mm),
            geography,
            revenueBand: revenueBandFor(o.revenue_usd_mm),
            updatedAt: new Date(),
          }).where(eq(organizationsTable.id, existing.id));
          indUpdated++;
          totalUpdated++;
        } else {
          await db.insert(organizationsTable).values({
            name: o.name,
            industryId: ind.id,
            size: sizeFor(o.revenue_usd_mm),
            geography,
            revenueBand: revenueBandFor(o.revenue_usd_mm),
            sessionToken,
            // peerOptIn left default false; reference orgs are read-only anchors,
            // not opt-in peer contributors.
          });
          indInserted++;
          totalInserted++;
        }

        // Per-org one-liner + source_url are needed downstream by seed-organizations.ts
        // for the Perplexity scoring prompt. We park them in a discoverable place:
        // a tiny side-table would be ideal, but to avoid another schema this round,
        // we encode it into the sessionToken's metadata via a structured JSON note
        // in the upcoming refactor (Task 6). For now, the populator's output is
        // sufficient because seed-organizations.ts re-derives the industry context.
      }

      console.log(`  ${ind.name.padEnd(40)} inserted=${indInserted} updated=${indUpdated} dropped=${dropped}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${ind.name}: ${msg.substring(0, 200)}`);
      console.log(`  ${ind.name.padEnd(40)} ERROR: ${msg.substring(0, 200)}`);
    }
  }

  // Record that we applied the rule.
  await db.update(referenceOrgSelectionRuleTable).set({
    lastAppliedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(referenceOrgSelectionRuleTable.id, rule.id));

  console.log(`[seed:reference-orgs] done. inserted=${totalInserted} updated=${totalUpdated} dropped=${totalDropped} industries-errored=${errors.length}`);
  if (errors.length > 0) {
    console.log(`[seed:reference-orgs] per-industry errors (non-fatal):`);
    for (const e of errors) console.log(`    - ${e}`);
  }

}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed:reference-orgs] catastrophic error:", err);
    process.exit(1);
  });
