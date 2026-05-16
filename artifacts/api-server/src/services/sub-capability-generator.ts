import { db, capabilitiesTable, industriesTable, cviComponentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { triangulateCapability } from "./triangulation";

export interface GeneratedSubCap {
  name: string;
  description: string;
  traditionalView: string;
  economicView: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function safeJsonExtract<T>(text: string): T | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(text.slice(start, end + 1)) as T; }
  catch { return null; }
}

/**
 * Use Haiku to decompose a parent capability into 4-6 distinct, factual sub-capabilities.
 * Haiku is the right model here: structured JSON, fast, cheap (~$0.001 per call).
 */
export async function generateSubCapabilities(
  parentName: string,
  parentDescription: string,
  industryName: string,
  count = 5,
): Promise<GeneratedSubCap[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const prompt = `Decompose the capability "${parentName}" (in the ${industryName} industry) into ${count} distinct, non-overlapping sub-capabilities.

Parent description: ${parentDescription}

Each sub-capability MUST:
- Be a real, named practice or function used in the industry today (not invented)
- Be measurably distinct from siblings (so they can diverge in maturity scoring)
- Reflect at least one modern shift (AI, regulation, platform model) where applicable
- Have a "traditional view" (how legacy orgs treat it as cost/checklist) and an "economic view" (how leaders treat it as a compounding capability)

Return ONLY a JSON array of ${count} objects. No prose, no markdown. Schema:
[
  {
    "name": "string (3-60 chars, specific, no parent name repetition)",
    "description": "string (15-280 chars, factual, what it actually IS)",
    "traditionalView": "string (one sentence, how laggards approach it)",
    "economicView": "string (one sentence, how leaders treat it as economic value)"
  }
]`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://capabilityeconomics.com",
      "X-Title": "Capability Economics",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);
  const text = data.choices?.[0]?.message?.content ?? "";
  const arr = safeJsonExtract<GeneratedSubCap[]>(text);
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    throw new Error(`Haiku returned no valid sub-cap JSON for ${parentName}`);
  }
  return arr.slice(0, count).filter(c => c?.name && c?.description);
}

/**
 * Inserts generated children for a parent capability and marks the parent as is_leaf=false.
 * Children get parent's benchmark as initial seed (will diverge after first triangulation).
 * Returns the IDs of inserted children.
 */
export async function insertSubCapabilities(
  parentId: number,
  subs: GeneratedSubCap[],
): Promise<number[]> {
  const [parent] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, parentId));
  if (!parent) throw new Error(`Parent capability ${parentId} not found`);

  const insertedIds: number[] = [];
  for (const s of subs) {
    const slug = slugify(s.name) + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1000).toString(36);
    // Seed children near parent's benchmark with small random spread so the panel shows divergence immediately;
    // first scheduled triangulation will replace these with factual sonar-cited values.
    const seedSpread = (Math.random() * 12) - 6; // ±6 pts
    const seedScore = Math.max(5, Math.min(95, parent.benchmarkScore + seedSpread));
    const [row] = await db.insert(capabilitiesTable).values({
      industryId: parent.industryId,
      parentCapabilityId: parent.id,
      isLeaf: true,
      slug,
      name: s.name,
      description: s.description,
      traditionalView: s.traditionalView || "Treated as a checklist function rather than an economic capability.",
      economicView: s.economicView || "A measurable, compounding sub-capability that contributes to the parent's economic value.",
      benchmarkScore: seedScore,
      reviewStatus: "approved",
      submittedBy: "haiku-decomposition",
      revisionCount: 0,
      reviewNotes: [],
      enrichmentStatus: "pending",
      enrichmentStage: "alpha",
      enrichmentUpdatedAt: new Date(),
    }).returning({ id: capabilitiesTable.id });
    insertedIds.push(row.id);

    await db.insert(cviComponentsTable).values({
      capabilityId: row.id,
      industryId: parent.industryId,
      consensusScore: seedScore,
      confidence: 0.4,
      velocity: 0,
      economicMultiplier: 1.0,
      sourceScores: [{
        sourceLabel: "Seed (parent decomposition)",
        rawScore: seedScore,
        weight: 1.0,
        methodology: "haiku-seed-pending-triangulation",
        queriedAt: new Date().toISOString(),
      }],
    });
  }

  // Flip parent to non-leaf so the engine starts rolling up from children instead of using its own seed.
  await db.update(capabilitiesTable)
    .set({ isLeaf: false })
    .where(eq(capabilitiesTable.id, parentId));

  return insertedIds;
}

/**
 * One-shot: generate + insert + (optionally) factually triangulate each new child.
 * If `triangulateNow=true`, makes a Perplexity call per child immediately so they get real scores.
 * Otherwise the next scheduler rotation will triangulate them naturally.
 */
export async function decomposeCapability(
  parentId: number,
  opts: { count?: number; triangulateNow?: boolean } = {},
): Promise<{ parentId: number; childIds: number[]; triangulated: number; skipped?: string }> {
  const [parent] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, parentId));
  if (!parent) throw new Error(`Capability ${parentId} not found`);
  // Race guard: if this parent already has children OR is already marked as decomposing/non-leaf, skip.
  const existingChildren = await db.select({ id: capabilitiesTable.id })
    .from(capabilitiesTable)
    .where(eq(capabilitiesTable.parentCapabilityId, parentId));
  if (existingChildren.length > 0) {
    return { parentId, childIds: existingChildren.map(c => c.id), triangulated: 0, skipped: "already-decomposed" };
  }
  if (parent.enrichmentStage === "decomposing") {
    return { parentId, childIds: [], triangulated: 0, skipped: "in-flight" };
  }
  // Claim the slot before the LLM call so concurrent callers bail out cleanly.
  await db.update(capabilitiesTable)
    .set({ enrichmentStage: "decomposing", enrichmentStatus: "running", enrichmentUpdatedAt: new Date() })
    .where(eq(capabilitiesTable.id, parentId));

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, parent.industryId));
  if (!industry) throw new Error(`Industry ${parent.industryId} not found`);

  let subs: GeneratedSubCap[];
  try {
    subs = await generateSubCapabilities(parent.name, parent.description, industry.name, opts.count ?? 5);
  } catch (err) {
    // Release the slot so a retry (manual or cron) can pick it up later.
    await db.update(capabilitiesTable)
      .set({ enrichmentStage: "decompose_failed", enrichmentStatus: "error", enrichmentError: String(err instanceof Error ? err.message : err).slice(0, 500), enrichmentUpdatedAt: new Date() })
      .where(eq(capabilitiesTable.id, parentId));
    throw err;
  }
  const childIds = await insertSubCapabilities(parentId, subs);
  await db.update(capabilitiesTable)
    .set({ enrichmentStage: "decomposed", enrichmentStatus: "complete", enrichmentError: null, enrichmentUpdatedAt: new Date() })
    .where(eq(capabilitiesTable.id, parentId));

  let triangulated = 0;
  if (opts.triangulateNow) {
    for (let i = 0; i < childIds.length; i++) {
      try {
        const [child] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, childIds[i]));
        if (!child) continue;
        await triangulateCapability(industry.name, child.name, parent.industryId, child.id);
        triangulated++;
      } catch (err) {
        console.warn(`[decompose] triangulation failed for child ${childIds[i]}:`, String(err));
      }
    }
  }

  return { parentId, childIds, triangulated };
}
