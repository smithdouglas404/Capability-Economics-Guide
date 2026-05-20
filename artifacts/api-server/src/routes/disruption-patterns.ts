/**
 * Disruption pattern stories — public read, admin write.
 *
 * Includes a one-shot seeding endpoint (POST /admin/disruption-patterns/seed)
 * that bootstraps the three flagship exemplars (Uber, Stripe, OpenAI) so the
 * /patterns page has content on first deploy. Idempotent — uses ON CONFLICT
 * on slug to avoid duplicates.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, disruptionPatternsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAdminAction } from "../services/audit-log";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/patterns", async (_req, res) => {
  const rows = await db
    .select()
    .from(disruptionPatternsTable)
    .orderBy(desc(disruptionPatternsTable.featured), desc(disruptionPatternsTable.publishedAt));
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    patterns: rows.map(r => ({
      ...r,
      publishedAt: r.publishedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

router.get("/patterns/:slug", async (req, res) => {
  const slugRaw = req.params.slug;
  const slug = Array.isArray(slugRaw) ? slugRaw[0] : slugRaw;
  if (typeof slug !== "string" || slug.length === 0) { res.status(400).json({ error: "bad slug" }); return; }
  const [row] = await db.select().from(disruptionPatternsTable).where(eq(disruptionPatternsTable.slug, slug));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    pattern: {
      ...row,
      publishedAt: row.publishedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  });
});

const PatternBody = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  title: z.string().min(2).max(200),
  headline: z.string().min(2).max(280),
  disruptorCompany: z.string().min(1).max(120),
  incumbentsDisplaced: z.array(z.string().max(120)).default([]),
  industriesAffected: z.array(z.string().max(120)).default([]),
  existingCapabilitiesUsed: z.array(z.string().max(200)).default([]),
  newCapabilityCreated: z.string().min(1).max(280),
  crossIndustryAnalogues: z.array(z.string().max(280)).default([]),
  narrative: z.string().min(20).max(20000),
  whatToLookFor: z.array(z.string().max(280)).default([]),
  sources: z.array(z.object({ url: z.string().url(), title: z.string().min(1).max(280) })).default([]),
  coverImageUrl: z.string().url().nullable().optional(),
  featured: z.boolean().optional(),
});

router.post("/admin/patterns", requireAdmin, async (req, res) => {
  const parsed = PatternBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const [existing] = await db.select({ id: disruptionPatternsTable.id }).from(disruptionPatternsTable).where(eq(disruptionPatternsTable.slug, parsed.data.slug));
  if (existing) {
    const [updated] = await db.update(disruptionPatternsTable).set({
      ...parsed.data,
      featured: parsed.data.featured ?? false,
      updatedAt: new Date(),
    }).where(eq(disruptionPatternsTable.id, existing.id)).returning();
    await logAdminAction(req, { action: "tier.update", targetType: "disruption_pattern", targetId: existing.id, details: { slug: parsed.data.slug, op: "update" } });
    res.json({ pattern: { ...updated, publishedAt: updated.publishedAt.toISOString(), updatedAt: updated.updatedAt.toISOString() } });
    return;
  }
  const [created] = await db.insert(disruptionPatternsTable).values({
    ...parsed.data,
    featured: parsed.data.featured ?? false,
  }).returning();
  await logAdminAction(req, { action: "tier.update", targetType: "disruption_pattern", targetId: created.id, details: { slug: parsed.data.slug, op: "create" } });
  res.status(201).json({ pattern: { ...created, publishedAt: created.publishedAt.toISOString(), updatedAt: created.updatedAt.toISOString() } });
});

router.delete("/admin/patterns/:slug", requireAdmin, async (req, res) => {
  const slugRaw = req.params.slug;
  const slug = Array.isArray(slugRaw) ? slugRaw[0] : slugRaw;
  if (typeof slug !== "string" || slug.length === 0) { res.status(400).json({ error: "bad slug" }); return; }
  await db.delete(disruptionPatternsTable).where(eq(disruptionPatternsTable.slug, slug));
  await logAdminAction(req, { action: "tier.update", targetType: "disruption_pattern", targetId: slug, details: { slug, op: "delete" } });
  res.status(204).send();
});

router.post("/admin/patterns/seed", requireAdmin, async (req, res) => {
  try {
    const { seedDisruptionPatterns } = await import("../services/disruption-patterns-seed");
    const { inserted, updated } = await seedDisruptionPatterns();
    await logAdminAction(req, { action: "tier.update", targetType: "disruption_pattern", targetId: "seed", details: { inserted, updated } });
    res.json({ ok: true, inserted, updated });
  } catch (err) {
    logger.error({ err }, "[patterns] seed failed");
    res.status(500).json({ error: "Seed failed", message: (err as Error).message });
  }
});



export default router;
