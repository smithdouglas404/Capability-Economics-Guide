import { Router } from "express";
import { getUsageSummary, getRecentCalls, getCsuitePerspectiveStats } from "../services/llm-usage";
import { listKillSwitches, setKillSwitch, KNOWN_SCHEDULER_NAMES } from "../services/scheduler-kill-switch";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

router.use("/usage", requireAdmin);
router.use("/admin/schedulers", requireAdmin);

router.get("/usage/summary", async (req, res) => {
  try {
    const windowHours = Math.max(1, Math.min(720, Number(req.query.windowHours) || 24));
    const summary = await getUsageSummary(windowHours);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/usage/recent", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const endpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const rows = await getRecentCalls(limit, { endpoint, status });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Per-CXO success/failure rates — lets the admin dashboard show which
// perspective roles are silently failing instead of letting console.error
// be the only signal. Reads llm_usage rows tagged "csuite_perspective:*".
router.get("/usage/csuite", async (req, res) => {
  try {
    const windowHours = Math.max(1, Math.min(720, Number(req.query.windowHours) || 24));
    const stats = await getCsuitePerspectiveStats(windowHours);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Scheduler kill switches ───────────────────────────────────────────────
//
// GET /api/admin/schedulers
//   Returns: { envHammer: string|null, schedulers: Array<{name, disabled, reason, updatedAt, updatedBy}> }
//   - envHammer is the literal value of SCHEDULERS_DISABLED (boot-time gate)
//   - schedulers covers all known crons; rows missing from the DB are
//     synthesized with disabled:false so the UI always shows the full list.
//
// POST /api/admin/schedulers
//   Body: { name: string, disabled: boolean, reason?: string }
//   Upserts the row. Cache invalidates within 30s (or sooner if anyone
//   reads). Cron's next tick respects the new state.

router.get("/admin/schedulers", async (_req, res) => {
  try {
    const rows = await listKillSwitches();
    const byName = new Map(rows.map(r => [r.name, r]));
    const schedulers = KNOWN_SCHEDULER_NAMES.map(name => {
      const r = byName.get(name);
      return {
        name,
        disabled: r?.disabled ?? false,
        reason: r?.reason ?? null,
        updatedAt: r?.updatedAt ?? null,
        updatedBy: r?.updatedBy ?? null,
      };
    });
    res.json({ envHammer: process.env.SCHEDULERS_DISABLED ?? null, schedulers });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/admin/schedulers", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; disabled?: unknown; reason?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    const disabled = body.disabled === true;
    const reason = typeof body.reason === "string" ? body.reason : null;
    if (!name || !KNOWN_SCHEDULER_NAMES.includes(name as typeof KNOWN_SCHEDULER_NAMES[number])) {
      res.status(400).json({ error: `Unknown scheduler name. Known: ${KNOWN_SCHEDULER_NAMES.join(", ")}` });
      return;
    }
    await setKillSwitch(name, disabled, reason, "admin-ui");
    res.json({ ok: true, name, disabled, reason });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
