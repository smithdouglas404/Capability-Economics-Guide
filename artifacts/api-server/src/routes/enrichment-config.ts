import { Router, type IRouter, type Request, type Response } from "express";
import { db, enrichmentConfigTable } from "@workspace/db";
import { z } from "zod/v4";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

async function getOrCreateConfig() {
  const rows = await db.select().from(enrichmentConfigTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db
    .insert(enrichmentConfigTable)
    .values({ enabled: false, refreshDays: 30 })
    .returning();
  return created;
}

/**
 * Read the current auto-enrichment cadence config. Publicly-readable so the
 * admin UI can render state without extra auth plumbing — no secrets.
 */
router.get("/admin/enrichment/config", async (_req: Request, res: Response) => {
  const cfg = await getOrCreateConfig();
  res.json({ config: cfg });
});

const UpdateBody = z.object({
  enabled: z.boolean().optional(),
  refreshDays: z.number().int().min(1).max(365).optional(),
});

router.put("/admin/enrichment/config", requireAdmin, async (req: Request, res: Response) => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const current = await getOrCreateConfig();
  const [updated] = await db
    .update(enrichmentConfigTable)
    .set({
      enabled: parsed.data.enabled ?? current.enabled,
      refreshDays: parsed.data.refreshDays ?? current.refreshDays,
      updatedAt: new Date(),
    })
    .returning();
  res.json({ config: updated });
});

export default router;
