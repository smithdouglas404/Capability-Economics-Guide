/**
 * Idempotent CREATE TABLE migration for `scheduled_exports`. Mirrors the
 * Drizzle schema in lib/db/src/schema/scheduled-exports.ts.
 *
 * Prod's deploy-migrate ran drizzle-kit push but the table didn't land
 * (drizzle-kit silently no-op'd or the run was killed mid-stream). The
 * weekly export scheduler sweeps every cron tick and spams
 * "relation scheduled_exports does not exist" errors; the sweep then
 * returns nothing and the loop continues.
 *
 * This endpoint runs CREATE TABLE IF NOT EXISTS so it's safe to call once
 * or many times. Same DDL drizzle would have emitted.
 *
 *   POST /api/admin/migrate/scheduled-exports
 *     headers: x-admin-key: $ADMIN_API_KEY
 *     response: { ok, created, alreadyExisted }
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

router.post("/admin/migrate/scheduled-exports", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const existed = await db.execute(sql`SELECT to_regclass('public.scheduled_exports') AS exists`);
    const exists = (existed.rows?.[0] ?? (existed as unknown as Array<{ exists: string | null }>)[0])?.exists != null;

    if (exists) {
      res.json({ ok: true, created: false, alreadyExisted: true });
      return;
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scheduled_exports (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        frequency TEXT NOT NULL DEFAULT 'weekly',
        format TEXT NOT NULL DEFAULT 'markdown',
        scope TEXT NOT NULL DEFAULT 'all',
        last_sent_at TIMESTAMP,
        last_error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS scheduled_exports_user_idx ON scheduled_exports (user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS scheduled_exports_active_idx ON scheduled_exports (active, last_sent_at)`);

    res.json({ ok: true, created: true, alreadyExisted: false });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
