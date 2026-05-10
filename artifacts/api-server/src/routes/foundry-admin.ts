import { Router, type IRouter } from "express";
import { db, foundrySyncLogTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getFoundryAlertState, runFoundrySyncAwait } from "../services/foundry/sync";

const router: IRouter = Router();

router.use("/admin/foundry", requireAdmin);

/**
 * Combined health snapshot — drives the admin banner + summary card.
 * Returns: latest sync row, last successful sync time, alert state, and
 * whether the env vars are even configured (so the panel can prompt the
 * admin to set them instead of showing "no data").
 */
router.get("/admin/foundry/health", async (_req, res) => {
  // One query, derive both "latest" and "last success" from the tail.
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

  res.json({
    envConfigured,
    tokenConfigured,
    latest,
    lastSuccessAt: lastSuccess?.completedAt ?? null,
    alert,
  });
});

/** Last 10 (or N up to 50) sync runs — drives the run-history table. */
router.get("/admin/foundry/sync-log", async (req, res) => {
  const raw = Number(req.query.limit ?? 10);
  // Guard NaN / negative / zero / fractional — fall back to default 10, cap at 50.
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
router.post("/admin/foundry/recheck", async (_req, res) => {
  const result = await runFoundrySyncAwait("admin recheck");
  res.json({ result, alert: getFoundryAlertState() });
});

export default router;
