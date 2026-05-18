/**
 * Bulk-generate real case studies for every industry that doesn't already
 * have a non-stub one. Calls the existing admin endpoint
 * POST /api/case-studies/generate (admin-key gated) so the codepath is
 * identical to clicking "Generate" in the admin console.
 *
 * Sequential, not concurrent — each generation does a Perplexity call
 * plus a Sonnet synthesis (~60-180s); concurrent runs would hammer the
 * upstream rate limits.
 *
 * Idempotent: industries that already have a generated case study (model
 * starts with "anthropic/" or similar — i.e. NOT "seed:case-study-economics")
 * are skipped. Pass FORCE=1 to regenerate anyway.
 *
 * Usage:
 *   INFLEXCVI_API_BASE=https://capabilityeconomics-staging.up.railway.app \
 *   ADMIN_API_KEY=... \
 *   pnpm --filter @workspace/scripts run generate:case-studies
 *
 *   # Local dev:
 *   pnpm --filter @workspace/scripts run generate:case-studies
 *   # (defaults INFLEXCVI_API_BASE=http://localhost:8080, reads ADMIN_API_KEY from env)
 *
 *   # Single industry only:
 *   ONLY=technology pnpm --filter @workspace/scripts run generate:case-studies
 */
import { db, industriesTable, caseStudiesTable } from "@workspace/db";
import { eq, ne, and, or, isNull } from "drizzle-orm";

const API_BASE = (process.env.INFLEXCVI_API_BASE ?? "http://localhost:8080").replace(/\/$/, "");
const ADMIN_KEY = process.env.ADMIN_API_KEY;
const FORCE = process.env.FORCE === "1" || process.env.FORCE === "true";
const ONLY = process.env.ONLY?.trim() || null;

interface GenerateResponse {
  caseStudy?: { id: number; title: string };
  sourcesCount?: number;
  content?: { generated: number; error?: string };
  error?: string;
  details?: string;
}

async function generateForIndustry(slug: string): Promise<{ ok: boolean; detail: string }> {
  const url = `${API_BASE}/api/case-studies/generate`;
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY ?? "",
      },
      body: JSON.stringify({ industrySlug: slug }),
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const text = await resp.text();
    let parsed: GenerateResponse = {};
    try { parsed = JSON.parse(text); } catch { /* keep text fallback */ }
    if (!resp.ok) {
      return { ok: false, detail: `HTTP ${resp.status} in ${elapsed}s — ${parsed.error ?? text.slice(0, 200)}` };
    }
    const id = parsed.caseStudy?.id;
    const title = parsed.caseStudy?.title?.slice(0, 80) ?? "(no title)";
    const sources = parsed.sourcesCount ?? 0;
    const contentGen = parsed.content?.generated ?? 0;
    return { ok: true, detail: `id=${id} in ${elapsed}s — "${title}" · ${sources} sources · ${contentGen} cap cards` };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    return { ok: false, detail: `network error in ${elapsed}s — ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main(): Promise<void> {
  if (!ADMIN_KEY) {
    console.error("[generate:case-studies] ADMIN_API_KEY not set");
    process.exit(1);
  }

  const industries = await db.select().from(industriesTable);
  const targets = ONLY ? industries.filter(i => i.slug === ONLY) : industries;
  if (targets.length === 0) {
    console.error(`[generate:case-studies] no industries matched ${ONLY ? `ONLY=${ONLY}` : "(empty industries table)"}`);
    process.exit(1);
  }

  console.log(`[generate:case-studies] target=${API_BASE} industries=${targets.length} force=${FORCE}`);

  let generated = 0, skipped = 0, failed = 0;
  for (const ind of targets) {
    // Skip if a non-stub case study already exists (unless FORCE).
    if (!FORCE) {
      const existing = await db
        .select({ id: caseStudiesTable.id, model: caseStudiesTable.model })
        .from(caseStudiesTable)
        .where(and(
          eq(caseStudiesTable.industryId, ind.id),
          or(isNull(caseStudiesTable.model), ne(caseStudiesTable.model, "seed:case-study-economics")),
        ))
        .limit(1);
      if (existing.length > 0) {
        console.log(`[generate:case-studies] ✓ ${ind.name} (${ind.slug}) — already has real case study (#${existing[0].id}), skipping`);
        skipped += 1;
        continue;
      }
    }

    console.log(`[generate:case-studies] → ${ind.name} (${ind.slug}) generating…`);
    const result = await generateForIndustry(ind.slug);
    if (result.ok) {
      console.log(`[generate:case-studies] ✓ ${ind.name} (${ind.slug}) — ${result.detail}`);
      generated += 1;
    } else {
      console.warn(`[generate:case-studies] ✗ ${ind.name} (${ind.slug}) — ${result.detail}`);
      failed += 1;
    }
  }

  console.log(`[generate:case-studies] done. generated=${generated} skipped=${skipped} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[generate:case-studies] fatal:", err);
    process.exit(1);
  });
