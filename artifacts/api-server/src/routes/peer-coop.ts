/**
 * Peer co-op routes — opt-in, contributor status, percentile retrieval.
 *
 * Two endpoints take a session token (anchored to the organizations row) so the
 * caller's cohort is unambiguous. Mutations require a Clerk session.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getContributorStatus, getPeerPercentiles } from "../services/peer-coop";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function resolveOrgFromQueryOrHeader(req: { query: Record<string, unknown>; headers: Record<string, unknown> }) {
  const tokenRaw = (req.query.sessionToken as string | undefined) ?? (req.headers["x-session-token"] as string | undefined);
  if (!tokenRaw) return null;
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, tokenRaw));
  return org ?? null;
}

router.get("/peer-coop/status", async (req, res) => {
  const org = await resolveOrgFromQueryOrHeader({
    query: req.query as Record<string, unknown>,
    headers: req.headers as Record<string, unknown>,
  });
  if (!org) {
    res.status(400).json({ error: "Provide ?sessionToken= or X-Session-Token header" });
    return;
  }
  const status = await getContributorStatus(org.id);
  if (!status) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }
  res.json(status);
});

router.get("/peer-coop/percentiles", async (req, res) => {
  const org = await resolveOrgFromQueryOrHeader({
    query: req.query as Record<string, unknown>,
    headers: req.headers as Record<string, unknown>,
  });
  if (!org) {
    res.status(400).json({ error: "Provide ?sessionToken= or X-Session-Token header" });
    return;
  }
  try {
    const result = await getPeerPercentiles(org.id);
    if (!result) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (err) {
    logger.error({ err, orgId: org.id }, "peer percentiles failed");
    res.status(500).json({ error: "Failed to compute percentiles" });
  }
});

const OptInBody = z.object({
  peerOptIn: z.boolean(),
  geography: z.enum(["na", "emea", "apac", "latam", "global", "other"]).nullable().optional(),
  revenueBand: z.enum(["lt_10m", "10m_100m", "100m_1b", "1b_10b", "gt_10b"]).nullable().optional(),
});

router.post("/peer-coop/opt-in", async (req, res) => {
  const org = await resolveOrgFromQueryOrHeader({
    query: req.query as Record<string, unknown>,
    headers: req.headers as Record<string, unknown>,
  });
  if (!org) {
    res.status(400).json({ error: "Provide ?sessionToken= or X-Session-Token header" });
    return;
  }
  const parsed = OptInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const [updated] = await db.update(organizationsTable).set({
    peerOptIn: parsed.data.peerOptIn,
    geography: parsed.data.geography === undefined ? org.geography : parsed.data.geography,
    revenueBand: parsed.data.revenueBand === undefined ? org.revenueBand : parsed.data.revenueBand,
    updatedAt: new Date(),
  }).where(eq(organizationsTable.id, org.id)).returning();
  res.json({ organization: updated });
});

export default router;
