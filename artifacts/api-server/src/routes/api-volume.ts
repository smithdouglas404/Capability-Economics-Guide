/**
 * Admin: per-tenant API call volume in the trailing 24h.
 *
 * Reads the per-day counters written by `rateLimitMiddleware`
 * (`ce:apivol:YYYYMMDD:<kind>:<tenantId>`) and returns them sorted
 * descending. Lets ops eyeball who's hammering the API and decide whether
 * to bump a tier limit or block a runaway integration.
 *
 * Returns an empty array when Redis is unavailable rather than 5xx — the
 * panel just shows "no data" and the rest of the admin dashboard keeps
 * working.
 */
import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getRedis } from "../lib/redis";
import { VOLUME_24H_KEY_PREFIX } from "../middlewares/rateLimit";

const router: IRouter = Router();

router.get("/admin/api-volume", requireAdmin, async (_req, res) => {
  const redis = await getRedis();
  if (!redis) { res.json({ tenants: [], redis: false }); return; }

  // Today + yesterday in UTC — cover the trailing 24h window even when
  // straddling midnight.
  const days: string[] = [];
  const now = new Date();
  for (const offset of [0, 1]) {
    const d = new Date(now.getTime() - offset * 86400000);
    days.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`);
  }

  const totals = new Map<string, { kind: string; tenantId: string; count: number }>();
  for (const day of days) {
    let cursor = "0";
    do {
      const reply = await redis.scan(cursor, { MATCH: `${VOLUME_24H_KEY_PREFIX}${day}:*`, COUNT: 500 });
      cursor = String(reply.cursor);
      const keys = reply.keys;
      if (keys.length === 0) continue;
      const values = await redis.mGet(keys);
      keys.forEach((k, i) => {
        const suffix = k.slice(`${VOLUME_24H_KEY_PREFIX}${day}:`.length);
        const sep = suffix.indexOf(":");
        if (sep < 0) return;
        const kind = suffix.slice(0, sep);
        const tenantId = suffix.slice(sep + 1);
        const n = Number(values[i] ?? 0);
        const id = `${kind}:${tenantId}`;
        const cur = totals.get(id);
        if (cur) cur.count += n;
        else totals.set(id, { kind, tenantId, count: n });
      });
    } while (cursor !== "0");
  }

  const tenants = Array.from(totals.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  res.json({ tenants, redis: true, windowDays: days });
});

export default router;
