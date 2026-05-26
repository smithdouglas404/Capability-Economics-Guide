import { db, capabilitiesTable, industriesTable, cviComponentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { haiku, generateObject } from "./workflows/models";
import { triangulateCapability } from "./triangulation";

const SubCapSchema = z.object({
  name: z.string().min(3).max(60),
  description: z.string().min(15).max(280),
  traditionalView: z.string(),
  economicView: z.string(),
});

export type GeneratedSubCap = z.infer<typeof SubCapSchema>;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * Use Haiku to decompose a parent capability into N distinct, factual sub-capabilities.
 * Haiku is the right model here: structured JSON, fast, cheap (~$0.001 per call).
 * Vercel AI SDK's generateObject auto-validates against the Zod schema and
 * retries once with a corrective re-prompt on schema mismatch.
 */
export async function generateSubCapabilities(
  parentName: string,
  parentDescription: string,
  industryName: string,
  count = 5,
): Promise<GeneratedSubCap[]> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const system = `You decompose enterprise capabilities into distinct sub-capabilities for the inflexcvi CVI engine. Each sub-capability MUST:
- Be a real, named practice or function used in the industry today (not invented)
- Be measurably distinct from siblings (so they can diverge in maturity scoring)
- Reflect at least one modern shift (AI, regulation, platform model) where applicable
- Have a "traditional view" (how legacy orgs treat it as cost/checklist) and an "economic view" (how leaders treat it as a compounding capability)
- Use a 3-60 char name with no parent name repetition; 15-280 char description.`;

  const prompt = `Decompose "${parentName}" (in the ${industryName} industry) into exactly ${count} sub-capabilities.\n\nParent description: ${parentDescription}`;

  const { object } = await generateObject({
    model: haiku,
    schema: z.object({ subCapabilities: z.array(SubCapSchema).min(1).max(count) }),
    system,
    prompt,
    temperature: 0.2,
    maxTokens: 2048,
  });

  return object.subCapabilities.slice(0, count);
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

    // Mirror into the world-model capability graph (Graphiti, fire-and-forget).
    import("./agent/capabilityGraphSync").then((m) => {
      m.mirrorCapability({
        pgId: row.id,
        slug,
        name: s.name,
        industryId: parent.industryId,
        parentCapabilityId: parent.id,
        isLeaf: true,
        reviewStatus: "approved",
        benchmarkScore: seedScore,
      });
      // Lifecycle :Episodic for the decomposition event itself — captures
      // the parent → child ontology relationship in the bi-temporal graph.
      m.recordCapabilityEpisode({
        capabilityPgId: row.id,
        capabilityName: s.name,
        eventName: "decomposed",
        narrative: `Decomposed from parent capability "${parent.name}" (pgId=${parent.id}) via Haiku auto-decomposition. Seed score ${seedScore}/100, pending triangulation.`,
      });
    }).catch(() => {});

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

  // Fire-and-forget bot event for each newly created sub-capability. Bots
  // covering the parent's industry get a chance to evaluate. Single industry
  // lookup outside the loop to keep cost flat.
  if (insertedIds.length > 0) {
    try {
      const [ind] = await db.select({ slug: industriesTable.slug })
        .from(industriesTable)
        .where(eq(industriesTable.id, parent.industryId));
      if (ind) {
        const slug = ind.slug;
        import("./bots/workflows/triggers").then((m) => {
          for (const id of insertedIds) {
            m.dispatchBotEvent("capability.added", { capabilityId: id, industrySlug: slug }).catch(() => {});
          }
        }).catch(() => {});
      }
    } catch { /* bots are not critical path */ }
  }

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
