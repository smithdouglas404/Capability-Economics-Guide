import { Router, type IRouter, type Request, type Response } from "express";
import { db, foundrySyncLogTable, systemSecretsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getFoundryAlertState, runFoundrySyncAwait } from "../services/foundry/sync";
import {
  rotateFoundryToken,
  getFoundryTokenMeta,
  invalidateFoundryTokenCache,
} from "../services/foundry/auth";
import { logger } from "../lib/logger";
import { inngest } from "../inngest/client";

const router: IRouter = Router();

router.use("/admin/foundry", requireAdmin);

/**
 * Combined health snapshot — drives the admin banner + summary card.
 * Returns: latest sync row, last successful sync time, alert state, and
 * whether the env vars are even configured (so the panel can prompt the
 * admin to set them instead of showing "no data").
 */
router.get("/admin/foundry/health", async (_req: Request, res: Response) => {
  const recent = await db
    .select()
    .from(foundrySyncLogTable)
    .orderBy(desc(foundrySyncLogTable.id))
    .limit(50);
  const latest = recent[0] ?? null;
  const lastSuccess = recent.find((r) => r.status === "ok") ?? null;

  const alert = getFoundryAlertState();
  const envConfigured = Boolean(
    process.env.FOUNDRY_BASE_URL || process.env.PALANTIR_URL || process.env.FOUNDRY_URL || process.env.PALANTIR_BASE_URL,
  );
  const tokenConfigured = Boolean(
    process.env.FOUNDRY_TOKEN || process.env.PALANTIR_TOKEN || process.env.PALANTIR_FOUNDRY_TOKEN,
  );

  const tokenMeta = await getFoundryTokenMeta();

  res.json({
    envConfigured,
    tokenConfigured: tokenConfigured || tokenMeta?.source === "db",
    tokenSource: tokenMeta?.source ?? "none",
    tokenRotatedAt: tokenMeta?.rotatedAt ?? null,
    tokenAgeMinutes: tokenMeta?.ageMinutes ?? null,
    latest,
    lastSuccessAt: lastSuccess?.completedAt ?? null,
    alert,
  });
});

/** Last 10 (or N up to 50) sync runs — drives the run-history table. */
router.get("/admin/foundry/sync-log", async (req: Request, res: Response) => {
  const raw = Number(req.query.limit ?? 10);
  const limit = !Number.isFinite(raw) || raw < 1 ? 10 : Math.min(Math.floor(raw), 50);
  const rows = await db
    .select()
    .from(foundrySyncLogTable)
    .orderBy(desc(foundrySyncLogTable.id))
    .limit(limit);
  res.json({ runs: rows });
});

/**
 * "I rotated the token — recheck now" handoff. Awaits a fresh sync so the
 * UI can show inline pass/fail without polling. A successful sync clears
 * the 401 alert (handled inside runFoundrySyncOnce).
 */
router.post("/admin/foundry/recheck", async (_req: Request, res: Response) => {
  const result = await runFoundrySyncAwait("admin recheck");
  res.json({ result, alert: getFoundryAlertState() });
});

/**
 * POST /api/admin/foundry/rotate-token
 *
 * Store a new Foundry API token in the DB so it can be rotated without a
 * Railway redeploy. Body: { token: string, reason?: string }
 */
router.post("/admin/foundry/rotate-token", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const rotatedByUserId = auth?.userId ?? "shared_key_holder";
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : null;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 240) : null;
  // Optional: operator may declare the new token's expiry, OR provide
  // expiresInSeconds (e.g. when forwarding an OAuth response). Either is
  // accepted; expiresAt wins if both present. Missing → no expiry event
  // emitted (Inngest can't schedule a sleepUntil without a target time).
  const rawExpiresAt = typeof req.body?.expiresAt === "string" ? req.body.expiresAt : null;
  const rawExpiresInSec = typeof req.body?.expiresInSeconds === "number" ? req.body.expiresInSeconds : null;

  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  let expiresAt: Date | null = null;
  if (rawExpiresAt) {
    const d = new Date(rawExpiresAt);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) expiresAt = d;
  } else if (rawExpiresInSec && rawExpiresInSec > 0) {
    expiresAt = new Date(Date.now() + rawExpiresInSec * 1000);
  }

  try {
    await rotateFoundryToken(token, rotatedByUserId, reason);
    // Emit `system.secret.expiring` so the Inngest function
    // `foundryTokenExpiryAlert` can step.sleepUntil(expiresAt - 30min) and
    // then email the operator. Fire-and-forget — never fail the rotation if
    // Inngest is unreachable.
    if (expiresAt) {
      inngest.send({
        name: "system.secret.expiring",
        data: { secretName: "foundry", expiresAt: expiresAt.toISOString() },
      }).catch(err => {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[foundry-admin] inngest.send(system.secret.expiring) failed (non-fatal)");
      });
    }
    // Immediately trigger a recheck so the UI sees the new token is valid
    const result = await runFoundrySyncAwait("post-rotation recheck");
    res.json({ ok: true, rotatedAt: new Date().toISOString(), expiresAt: expiresAt?.toISOString() ?? null, syncResult: result });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[foundry-admin] rotate-token failed");
    res.status(500).json({ error: "Token rotation failed; see server logs" });
  }
});

/**
 * GET /api/admin/foundry/token-meta
 *
 * Returns token metadata (source, age, last rotated by) without revealing
 * the token value. Used by the admin panel to show rotation status.
 */
router.get("/admin/foundry/token-meta", async (_req: Request, res: Response) => {
  const meta = await getFoundryTokenMeta();
  res.json(meta);
});

/**
 * PATCH /api/admin/foundry/notify-email
 *
 * Update the email address that receives Foundry token expiry alerts.
 * Body: { email: string | null }
 */
router.patch("/admin/foundry/notify-email", async (req: Request, res: Response) => {
  const email = req.body?.email;
  if (email !== null && (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const [existing] = await db
    .select()
    .from(systemSecretsTable)
    .where(eq(systemSecretsTable.keyName, "foundry_token"));

  if (!existing) {
    res.status(412).json({ error: "No foundry_token row in DB yet — rotate the token first" });
    return;
  }

  await db
    .update(systemSecretsTable)
    .set({ notifyEmail: email ?? null })
    .where(eq(systemSecretsTable.keyName, "foundry_token"));

  invalidateFoundryTokenCache();
  res.json({ ok: true, notifyEmail: email ?? null });
});

export default router;
