import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { industriesTable, capabilitiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/industries", async (_req, res) => {
  const industries = await db
    .select({
      id: industriesTable.id,
      slug: industriesTable.slug,
      name: industriesTable.name,
      description: industriesTable.description,
      icon: industriesTable.icon,
      capabilityCount: sql<number>`cast(count(${capabilitiesTable.id}) as int)`,
    })
    .from(industriesTable)
    .leftJoin(capabilitiesTable, eq(capabilitiesTable.industryId, industriesTable.id))
    .groupBy(industriesTable.id)
    .orderBy(industriesTable.name);

  res.json(industries);
});

router.get("/industries/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid industry ID" });
    return;
  }

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, id));
  if (!industry) {
    res.status(404).json({ error: "Industry not found" });
    return;
  }

  const capabilities = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, id));

  res.json({ ...industry, capabilities });
});

export default router;
