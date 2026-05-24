/**
 * EMERGENCY recovery endpoint for the messages → marketplace_reviews rename
 * that drizzle-kit push --force applied during a recent deploy. Drizzle's
 * heuristic mis-detected the new marketplace_reviews table as a rename of
 * the existing messages table (similar shape: id + fk + body + created_at).
 *
 *   GET  /api/admin/recover-messages/status   — diagnose current state
 *   POST /api/admin/recover-messages/repair   — execute recovery
 *
 * Repair plan (atomic in one transaction):
 *   1. Read information_schema.columns for marketplace_reviews
 *   2. If columns match the MESSAGES shape (conversation_id, role, content)
 *      AND `messages` table does NOT exist → it's the renamed table:
 *        a. ALTER TABLE marketplace_reviews RENAME TO messages
 *        b. CREATE TABLE marketplace_reviews (proper schema)
 *   3. If columns ALREADY match marketplace_reviews shape (listing_id,
 *      buyer_user_id, rating) → no recovery needed (no-op)
 *   4. If neither: bail with diagnostic — manual intervention required
 *
 * After this lands, follow-up commit adds a pre-migration SQL to
 * scripts/src/deploy-migrate.ts that does CREATE TABLE marketplace_reviews
 * IF NOT EXISTS BEFORE drizzle-kit runs, so this rename heuristic can
 * never fire again.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

interface TableShape {
  exists: boolean;
  columns: string[];
}

async function inspectTable(name: string): Promise<TableShape> {
  const exists = await db.execute(sql`SELECT to_regclass(${`public.${name}`}) AS exists`);
  const existsRow = (exists.rows ?? exists)[0] as { exists: string | null };
  if (!existsRow?.exists) return { exists: false, columns: [] };
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${name}
    ORDER BY ordinal_position
  `);
  const colsRows = (cols.rows ?? cols) as Array<{ column_name: string }>;
  return { exists: true, columns: colsRows.map((r) => r.column_name) };
}

const MESSAGES_SHAPE = new Set(["id", "conversation_id", "role", "content", "created_at"]);
const REVIEWS_SHAPE = new Set(["id", "listing_id", "buyer_user_id", "buyer_display_name", "rating", "body", "created_at", "updated_at"]);

function matchesShape(actual: string[], expected: Set<string>): boolean {
  // Every expected column must be present (extra columns OK — drizzle may have added or there may be legacy).
  return Array.from(expected).every((c) => actual.includes(c));
}

router.get("/admin/recover-messages/status", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const messages = await inspectTable("messages");
    const marketplace = await inspectTable("marketplace_reviews");

    const diagnosis = (() => {
      if (messages.exists && marketplace.exists && matchesShape(messages.columns, MESSAGES_SHAPE) && matchesShape(marketplace.columns, REVIEWS_SHAPE)) {
        return { state: "healthy", action: "none" };
      }
      if (!messages.exists && marketplace.exists && matchesShape(marketplace.columns, MESSAGES_SHAPE)) {
        return { state: "renamed", action: "repair" };
      }
      if (!messages.exists && !marketplace.exists) {
        return { state: "both-missing", action: "manual-create" };
      }
      if (messages.exists && !marketplace.exists) {
        return { state: "messages-ok-reviews-missing", action: "create-reviews" };
      }
      return { state: "unexpected", action: "manual-investigate" };
    })();

    res.json({
      diagnosis,
      messages,
      marketplaceReviews: marketplace,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/admin/recover-messages/repair", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const messages = await inspectTable("messages");
    const marketplace = await inspectTable("marketplace_reviews");

    // Case A: marketplace_reviews IS the renamed messages table.
    // Action: rename it back + create a fresh marketplace_reviews.
    if (!messages.exists && marketplace.exists && matchesShape(marketplace.columns, MESSAGES_SHAPE)) {
      await db.execute(sql`ALTER TABLE marketplace_reviews RENAME TO messages`);
      await db.execute(sql`
        CREATE TABLE marketplace_reviews (
          id SERIAL PRIMARY KEY,
          listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
          buyer_user_id TEXT NOT NULL,
          buyer_display_name TEXT,
          rating INTEGER NOT NULL,
          body TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS marketplace_reviews_listing_idx ON marketplace_reviews (listing_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS marketplace_reviews_buyer_idx ON marketplace_reviews (buyer_user_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS marketplace_reviews_listing_buyer_unique ON marketplace_reviews (listing_id, buyer_user_id)`);
      res.json({ ok: true, action: "renamed-back-and-recreated", recoveredMessagesRows: "preserved" });
      return;
    }

    // Case B: messages exists with messages shape, marketplace_reviews missing.
    // Action: just create marketplace_reviews.
    if (messages.exists && matchesShape(messages.columns, MESSAGES_SHAPE) && !marketplace.exists) {
      await db.execute(sql`
        CREATE TABLE marketplace_reviews (
          id SERIAL PRIMARY KEY,
          listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
          buyer_user_id TEXT NOT NULL,
          buyer_display_name TEXT,
          rating INTEGER NOT NULL,
          body TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS marketplace_reviews_listing_idx ON marketplace_reviews (listing_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS marketplace_reviews_buyer_idx ON marketplace_reviews (buyer_user_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS marketplace_reviews_listing_buyer_unique ON marketplace_reviews (listing_id, buyer_user_id)`);
      res.json({ ok: true, action: "created-marketplace-reviews-only" });
      return;
    }

    // Case C: already healthy.
    if (messages.exists && marketplace.exists && matchesShape(messages.columns, MESSAGES_SHAPE) && matchesShape(marketplace.columns, REVIEWS_SHAPE)) {
      res.json({ ok: true, action: "no-op-already-healthy" });
      return;
    }

    // Other states: bail with diagnostic.
    res.status(409).json({
      ok: false,
      error: "Unexpected state — manual intervention required",
      messages,
      marketplaceReviews: marketplace,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
