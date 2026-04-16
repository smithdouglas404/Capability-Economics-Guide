import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  cSuiteRolesTable,
  csuitePerspectivesTable,
  caseStudyContentTable,
  caseStudiesTable,
  industriesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/csuite", async (_req, res) => {
  try {
    const roles = await db.select().from(cSuiteRolesTable).orderBy(cSuiteRolesTable.id);
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch roles", details: String(err) });
  }
});

router.get("/csuite/:roleSlug", async (req, res) => {
  try {
    const { roleSlug } = req.params;
    const [role] = await db
      .select()
      .from(cSuiteRolesTable)
      .where(eq(cSuiteRolesTable.slug, roleSlug));

    if (!role) {
      res.status(404).json({ error: "Role not found" });
      return;
    }

    const [perspective] = await db
      .select()
      .from(csuitePerspectivesTable)
      .where(eq(csuitePerspectivesTable.roleId, role.id))
      .orderBy(desc(csuitePerspectivesTable.generatedAt))
      .limit(1);

    res.json({ role, perspective: perspective ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch perspective", details: String(err) });
  }
});

router.get("/case-study/:industrySlug", async (req, res) => {
  try {
    const { industrySlug } = req.params;
    const [industry] = await db
      .select()
      .from(industriesTable)
      .where(eq(industriesTable.slug, industrySlug));

    if (!industry) {
      res.status(404).json({ error: "Industry not found" });
      return;
    }

    const capabilities = await db
      .select()
      .from(caseStudyContentTable)
      .where(eq(caseStudyContentTable.industryId, industry.id))
      .orderBy(desc(caseStudyContentTable.generatedAt));

    const [study] = await db
      .select()
      .from(caseStudiesTable)
      .where(eq(caseStudiesTable.industryId, industry.id))
      .orderBy(desc(caseStudiesTable.generatedAt))
      .limit(1);

    res.json({ industry, capabilities, study: study ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch case study", details: String(err) });
  }
});

export default router;
