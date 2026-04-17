import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { educationalContentTable, EDUCATIONAL_CATEGORIES } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(3).max(200),
});

const ContentBodySchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  title: z.string().min(5).max(200),
  summary: z.string().min(20).max(400),
  bodyMarkdown: z.string().min(50),
  keyTakeaways: z.array(z.string().min(5).max(300)).min(3).max(7),
  sources: z.array(SourceSchema).min(1).max(10),
  category: z.enum(EDUCATIONAL_CATEGORIES),
  estimatedReadMinutes: z.number().int().min(1).max(60),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  published: z.boolean().optional(),
});

const ContentPatchSchema = ContentBodySchema.partial();

router.get("/educational-content", async (_req, res) => {
  const rows = await db
    .select()
    .from(educationalContentTable)
    .where(eq(educationalContentTable.published, true))
    .orderBy(asc(educationalContentTable.displayOrder), asc(educationalContentTable.id));
  res.json(rows);
});

router.get("/educational-content/:slug", async (req, res) => {
  const [row] = await db
    .select()
    .from(educationalContentTable)
    .where(eq(educationalContentTable.slug, req.params.slug));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.get("/admin/educational-content", requireAdmin, async (req, res) => {
  const rows = await db
    .select()
    .from(educationalContentTable)
    .orderBy(asc(educationalContentTable.displayOrder), asc(educationalContentTable.id));
  res.json(rows);
});

router.post("/admin/educational-content", requireAdmin, async (req, res) => {
  const parsed = ContentBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  try {
    const [row] = await db
      .insert(educationalContentTable)
      .values({
        ...parsed.data,
        displayOrder: parsed.data.displayOrder ?? 0,
        published: parsed.data.published ?? true,
      })
      .returning();
    res.status(201).json(row);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Insert failed";
    res.status(400).json({ error: message });
  }
});

router.patch("/admin/educational-content/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = ContentPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  try {
    const [row] = await db
      .update(educationalContentTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(educationalContentTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Update failed";
    res.status(400).json({ error: message });
  }
});

router.delete("/admin/educational-content/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(educationalContentTable).where(eq(educationalContentTable.id, id));
  res.status(204).end();
});

export default router;
