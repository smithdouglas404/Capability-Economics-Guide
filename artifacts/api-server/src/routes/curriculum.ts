import { Router, type IRouter } from "express";
import { db, curriculumPacksTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/curriculum", async (_req, res) => {
  const rows = await db
    .select({
      id: curriculumPacksTable.id,
      slug: curriculumPacksTable.slug,
      title: curriculumPacksTable.title,
      subtitle: curriculumPacksTable.subtitle,
      industrySlug: curriculumPacksTable.industrySlug,
      level: curriculumPacksTable.level,
      durationWeeks: curriculumPacksTable.durationWeeks,
      publishedAt: curriculumPacksTable.publishedAt,
    })
    .from(curriculumPacksTable)
    .orderBy(asc(curriculumPacksTable.id));
  res.json({ packs: rows });
});

router.get("/curriculum/:slug", async (req, res) => {
  const [pack] = await db
    .select()
    .from(curriculumPacksTable)
    .where(eq(curriculumPacksTable.slug, req.params.slug))
    .limit(1);
  if (!pack) {
    res.status(404).json({ error: "Curriculum pack not found" });
    return;
  }
  res.json({ pack });
});

export default router;
