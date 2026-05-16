/**
 * One-shot cascade dependency-edge enrichment burst.
 *
 * Goal: lift the count of scored dependency edges from ~30 → 100+ so the
 * cascade graph in the Alpha tab renders meaningfully across more
 * capabilities.
 *
 * Strategy:
 *   1. Pick up to 80 ENRICHED capabilities (have a row in
 *      capability_economics) that don't yet have ANY outgoing scored edge —
 *      i.e., no row in capability_dependencies (where they sit on the
 *      depends_on side) that has a corresponding dependency_edge_scores row.
 *   2. For each, call Perplexity ONCE (sonar) to ask: "what 3-5
 *      capabilities depend on {cap.name} in {industry}?" with strict JSON.
 *   3. For each suggested downstream cap, fuzzy-match by token-Jaccard ≥ 0.5
 *      against existing capabilities IN THE SAME INDUSTRY. Skip if no
 *      match — never invent new capabilities.
 *   4. Insert capability_dependencies (if not already present) and
 *      dependency_edge_scores with the Perplexity-derived numbers + the
 *      Perplexity citations array (appended to rationale, since the
 *      score table has no dedicated citations column).
 *
 * Hard cap: 80 Perplexity calls. Progress every 10.
 *
 * Run:  tsx artifacts/api-server/scripts-edge-enrichment-burst.mts
 * Env:  DATABASE_URL, PERPLEXITY_API_KEY
 */
import {
  db,
  capabilitiesTable,
  capabilityDependenciesTable,
  capabilityEconomicsTable,
  dependencyEdgeScoresTable,
  industriesTable,
} from "@workspace/db";

const MAX_CALLS = parseInt(process.env.MAX_CALLS || "25", 10);
const totalStart = Date.now();
const log = (...args: unknown[]) =>
  console.error(
    `[${new Date().toISOString().slice(11, 19)}] ` +
      args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
  );

// ── Perplexity call ────────────────────────────────────────────────────────
interface PerplexityResult { content: string; citations: string[]; }
async function perplexity(query: string): Promise<PerplexityResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a capability strategy analyst. Reply ONLY with strict JSON (no prose, no markdown fences). " +
              "All numeric fields must be plain numbers. Cite real companies, regulators, or 10-K disclosures from 2023-2026.",
          },
          { role: "user", content: query },
        ],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Perplexity ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    }
    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    };
    return {
      content: data.choices[0]?.message?.content ?? "",
      citations: data.citations ?? [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── JSON extraction (Perplexity sometimes wraps in fences) ─────────────────
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  throw new Error("No JSON in Perplexity response");
}

// ── Token Jaccard fuzzy match ──────────────────────────────────────────────
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOPWORDS.has(t)),
  );
}
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto",
  "of", "in", "on", "at", "to", "by", "an", "a",
]);
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
function bestMatch(
  candidate: string,
  pool: Array<{ id: number; name: string; tokens: Set<string> }>,
  selfId: number,
  threshold = 0.5,
): { id: number; name: string; score: number } | null {
  const candTokens = tokenize(candidate);
  let best: { id: number; name: string; score: number } | null = null;
  for (const p of pool) {
    if (p.id === selfId) continue;
    const s = jaccard(candTokens, p.tokens);
    if (s >= threshold && (!best || s > best.score)) {
      best = { id: p.id, name: p.name, score: s };
    }
  }
  return best;
}

// ── Bucket → number ($M) — heuristic anchored to industry size ────────────
// Returns null when Perplexity gave no usable bucket. We never fabricate a
// dollar value — caller MUST drop edges where this returns null instead of
// inserting a synthetic dollar_impact_mm into the DB.
function bucketToDollarMm(bucket: string | undefined | null): number | null {
  const b = (bucket ?? "").toLowerCase();
  if (b.includes("large")) return 500;
  if (b.includes("medium") || b.includes("mid")) return 100;
  if (b.includes("small")) return 25;
  return null;
}

// ── Discover candidates ────────────────────────────────────────────────────
log(`STARTING edge-enrichment burst (cap=${MAX_CALLS} Perplexity calls)`);

const industries = await db.select().from(industriesTable);
const industryById = new Map(industries.map(i => [i.id, i.name]));

const allCaps = await db.select().from(capabilitiesTable);
const capsByIndustry = new Map<number, Array<{ id: number; name: string; tokens: Set<string> }>>();
for (const c of allCaps) {
  const arr = capsByIndustry.get(c.industryId) ?? [];
  arr.push({ id: c.id, name: c.name, tokens: tokenize(c.name) });
  capsByIndustry.set(c.industryId, arr);
}

const enrichedRows = await db
  .select({ capabilityId: capabilityEconomicsTable.capabilityId })
  .from(capabilityEconomicsTable);
const enrichedIds = Array.from(new Set(enrichedRows.map(r => r.capabilityId)));

const allDeps = await db.select().from(capabilityDependenciesTable);
const allScores = await db
  .select({ dependencyId: dependencyEdgeScoresTable.dependencyId })
  .from(dependencyEdgeScoresTable);
const scoredDepIds = new Set(allScores.map(s => s.dependencyId));

const capsWithScoredOutgoing = new Set<number>();
for (const d of allDeps) {
  if (scoredDepIds.has(d.id)) capsWithScoredOutgoing.add(d.dependsOnId);
}

const candidates = enrichedIds
  .filter(id => !capsWithScoredOutgoing.has(id))
  .map(id => allCaps.find(c => c.id === id)!)
  .filter(Boolean)
  .slice(0, MAX_CALLS);

log(
  `Pool: enrichedCaps=${enrichedIds.length} ` +
    `capsWithScoredOutgoing=${capsWithScoredOutgoing.size} ` +
    `candidates=${candidates.length} (taking up to ${MAX_CALLS})`,
);

if (candidates.length === 0) {
  log(`Nothing to do.`);
  process.exit(0);
}

// ── Existing dep lookup so we don't double-insert ─────────────────────────
const depKey = (capId: number, depOnId: number) => `${capId}:${depOnId}`;
const existingDepByKey = new Map<string, number>();
for (const d of allDeps) existingDepByKey.set(depKey(d.capabilityId, d.dependsOnId), d.id);

// ── Main loop ─────────────────────────────────────────────────────────────
let calls = 0;
let edgesInserted = 0;
let depsInserted = 0;
let capsCovered = 0;
const errors: string[] = [];

for (let i = 0; i < candidates.length; i++) {
  if (calls >= MAX_CALLS) break;
  const cap = candidates[i]!;
  const indName = industryById.get(cap.industryId) ?? `industry ${cap.industryId}`;
  const pool = capsByIndustry.get(cap.industryId) ?? [];
  const t = Date.now();

  let prog = 0;
  try {
    calls++;
    const research = await perplexity(
      `For the enterprise capability "${cap.name}" in the ${indName} industry (2024-2026), ` +
        `name 3-5 OTHER enterprise capabilities that DEPEND on "${cap.name}" — i.e., capabilities ` +
        `that would be materially impaired if "${cap.name}" were disrupted, commoditized, or replaced. ` +
        `For each downstream capability, provide:\n` +
        `  - "name" (string, short noun phrase, capability-style; not a company)\n` +
        `  - "dependency_strength" (number 0-1)\n` +
        `  - "disruption_probability" (number 0-1, probability disruption of "${cap.name}" propagates downstream within 36 months)\n` +
        `  - "dollar_impact_mm" (string: "small" | "medium" | "large", scaled to ${indName} industry revenue)\n` +
        `  - "time_to_impact_months" (number 3-24)\n` +
        `  - "rationale" (1 sentence citing a real vendor, regulator, or 10-K)\n\n` +
        `Output ONLY a JSON object: {"downstream":[{"name":"...","dependency_strength":0.x,` +
        `"disruption_probability":0.x,"dollar_impact_mm":"medium","time_to_impact_months":12,` +
        `"rationale":"..."}, ...]}. No prose.`,
    );
    if (!research.content) {
      errors.push(`[cap${cap.id}] empty research`);
    } else {
      const parsed = extractJson(research.content) as {
        downstream?: Array<{
          name?: string;
          dependency_strength?: number;
          disruption_probability?: number;
          dollar_impact_mm?: string | number;
          time_to_impact_months?: number;
          rationale?: string;
        }>;
      };
      const items = Array.isArray(parsed?.downstream) ? parsed.downstream : [];
      const citations = research.citations ?? [];
      let coveredHere = 0;

      for (const item of items) {
        if (!item?.name) continue;
        const match = bestMatch(item.name, pool, cap.id, 0.5);
        if (!match) continue;

        // 1. Ensure capability_dependencies row (downstream cap depends on cap)
        const k = depKey(match.id, cap.id);
        let depId = existingDepByKey.get(k);
        if (depId == null) {
          const strengthNum = typeof item.dependency_strength === "number" ? item.dependency_strength : 0.6;
          const strengthLabel =
            strengthNum >= 0.75 ? "strong" : strengthNum <= 0.4 ? "weak" : "moderate";
          const inserted = await db
            .insert(capabilityDependenciesTable)
            .values({
              capabilityId: match.id,
              dependsOnId: cap.id,
              strength: strengthLabel,
            })
            .returning({ id: capabilityDependenciesTable.id });
          depId = inserted[0]?.id;
          if (depId != null) {
            existingDepByKey.set(k, depId);
            depsInserted++;
          }
        }
        if (depId == null) continue;

        // 2. Skip if a score row already exists for this dependency
        if (scoredDepIds.has(depId)) continue;

        const dollarMm =
          typeof item.dollar_impact_mm === "number"
            ? item.dollar_impact_mm
            : bucketToDollarMm(item.dollar_impact_mm);
        // No fabricated dollar values: skip the edge if Perplexity gave us
        // neither a number nor a recognizable bucket label.
        if (dollarMm == null) {
          errors.push(`[cap${cap.id}->${match.id}] no usable dollar_impact_mm`);
          continue;
        }
        const ttm = typeof item.time_to_impact_months === "number"
          ? Math.min(60, Math.max(1, item.time_to_impact_months))
          : 12;
        const dp = typeof item.disruption_probability === "number"
          ? Math.min(1, Math.max(0, item.disruption_probability))
          : 0.5;
        const rationaleBase = item.rationale ?? `Downstream impact of disrupting ${cap.name}.`;
        const rationale = citations.length > 0
          ? `${rationaleBase}\n\nSources: ${citations.join(" | ")}`
          : rationaleBase;

        await db.insert(dependencyEdgeScoresTable).values({
          dependencyId: depId,
          disruptionProbability: dp,
          timeToImpactMonths: ttm,
          dollarImpactMm: dollarMm,
          rationale,
        });
        scoredDepIds.add(depId);
        edgesInserted++;
        coveredHere++;
      }
      if (coveredHere > 0) capsCovered++;
      prog = coveredHere;
    }
  } catch (e) {
    errors.push(`[cap${cap.id}] ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }

  if ((i + 1) % 5 === 0 || i === candidates.length - 1) {
    log(
      `  [${i + 1}/${candidates.length}] cap "${cap.name}" (${indName}) ` +
        `+${prog} edges in ${Math.round((Date.now() - t) / 1000)}s — ` +
        `total: calls=${calls} deps+=${depsInserted} edges+=${edgesInserted} ` +
        `capsCovered=${capsCovered} errors=${errors.length}`,
    );
  }
}

// ── Final ──────────────────────────────────────────────────────────────────
const finalScored = await db
  .select({ id: dependencyEdgeScoresTable.id })
  .from(dependencyEdgeScoresTable);

log(`\n=== DONE in ${Math.round((Date.now() - totalStart) / 1000)}s ===`);
log(
  JSON.stringify({
    perplexityCalls: calls,
    capabilitiesProcessed: candidates.length,
    capabilitiesCovered: capsCovered,
    capabilityDependenciesInserted: depsInserted,
    dependencyEdgeScoresInserted: edgesInserted,
    totalScoredEdgesNow: finalScored.length,
    errorCount: errors.length,
  }),
);
if (errors.length > 0) {
  log(`First 5 errors:`);
  for (const e of errors.slice(0, 5)) log(`  - ${e}`);
}
process.exit(0);
