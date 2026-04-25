import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, organizationsTable, industriesTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logFeatureUsed } from "../services/persona-events";

const router: IRouter = Router();

router.post("/sandbox/clone", async (req, res) => {
  void logFeatureUsed({ userId: getAuth(req)?.userId, feature: "/sandbox/clone" });
  const [industry] = await db
    .select()
    .from(industriesTable)
    .orderBy(asc(industriesTable.id))
    .limit(1);

  if (!industry) {
    res.status(500).json({ error: "No industries available to seed sandbox" });
    return;
  }

  const sessionToken = randomUUID();
  const [org] = await db.insert(organizationsTable).values({
    name: "TeachCorp (sandbox)",
    industryId: industry.id,
    size: "mid",
    sessionToken,
  }).returning();

  res.status(201).json({
    sessionToken: org.sessionToken,
    organization: {
      id: org.id,
      name: org.name,
      industryId: org.industryId,
      industryName: industry.name,
      size: org.size,
      createdAt: org.createdAt.toISOString(),
    },
  });
});

export default router;
