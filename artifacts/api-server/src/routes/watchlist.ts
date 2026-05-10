import { Router } from "express";
import { db } from "@workspace/db";
import {
  watchlistsTable,
  watchlistItemsTable,
  watchlistAlertsTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  ceiComponentsTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { forSession, forSessionRow, resolveSessionToken } from "../lib/tenant-scope";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// Get watchlist with items and alerts
router.get("/watchlist", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.json({ watchlist: null, items: [], alerts: [] }); return; }

    let [watchlist] = await db.select().from(watchlistsTable).where(forSession("watchlists", token));
    if (!watchlist) {
      [watchlist] = await db.insert(watchlistsTable).values({ sessionToken: token, name: "My Watchlist" }).returning();
    }

    const items = await db.select({
      item: watchlistItemsTable,
      capabilityName: capabilitiesTable.name,
    })
      .from(watchlistItemsTable)
      .leftJoin(capabilitiesTable, eq(watchlistItemsTable.capabilityId, capabilitiesTable.id))
      .where(eq(watchlistItemsTable.watchlistId, watchlist.id));

    const itemIds = items.map((i) => i.item.id);
    const alerts = itemIds.length
      ? await db.select().from(watchlistAlertsTable)
          .where(inArray(watchlistAlertsTable.watchlistItemId, itemIds))
          .orderBy(desc(watchlistAlertsTable.createdAt))
          .limit(50)
      : [];

    res.json({
      watchlist,
      items: items.map((i) => ({ ...i.item, capabilityName: i.capabilityName })),
      alerts,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Add item to watchlist
router.post("/watchlist/items", async (req, res) => {
  try {
    const { sessionToken, capabilityId, industryId, thresholdType, thresholdValue, notificationChannel } = req.body;

    let [watchlist] = await db.select().from(watchlistsTable).where(forSession("watchlists", sessionToken));
    if (!watchlist) {
      [watchlist] = await db.insert(watchlistsTable).values({ sessionToken, name: "My Watchlist" }).returning();
    }

    const [item] = await db.insert(watchlistItemsTable).values({
      watchlistId: watchlist.id,
      capabilityId,
      industryId,
      thresholdType,
      thresholdValue,
      notificationChannel: notificationChannel ?? "in_app",
    }).returning();

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Remove item — must belong to the caller's watchlist (which is session-scoped).
// Pre-fix this accepted any item id and would happily delete another tenant's row.
router.delete("/watchlist/items/:id", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const itemId = Number(req.params.id);
    const [item] = await db.select({ watchlistId: watchlistItemsTable.watchlistId })
      .from(watchlistItemsTable)
      .where(eq(watchlistItemsTable.id, itemId));
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    const [wl] = await db.select({ id: watchlistsTable.id })
      .from(watchlistsTable)
      .where(forSessionRow("watchlists", token, item.watchlistId));
    if (!wl) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(watchlistItemsTable).where(eq(watchlistItemsTable.id, itemId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Check watchlist thresholds and generate alerts.
// Admin-only: this is a global batch sweep across every tenant's items.
// Should normally run from a scheduled worker; the route stays available
// for manual ops triggers but must not be reachable by tenants.
router.post("/watchlist/check", requireAdmin, async (req, res) => {
  try {
    const allItems = await db.select().from(watchlistItemsTable);
    if (!allItems.length) { res.json({ checked: 0, triggered: 0 }); return; }

    const capIds = [...new Set(allItems.map((i) => i.capabilityId))];
    const economics = await db.select().from(capabilityEconomicsTable).where(inArray(capabilityEconomicsTable.capabilityId, capIds));
    const components = await db.select().from(ceiComponentsTable).where(inArray(ceiComponentsTable.capabilityId, capIds));

    const econMap = new Map(economics.map((e) => [e.capabilityId, e]));
    const compMap = new Map(components.map((c) => [c.capabilityId, c]));

    let triggered = 0;

    for (const item of allItems) {
      const econ = econMap.get(item.capabilityId);
      const comp = compMap.get(item.capabilityId);

      let currentValue: number | null = null;
      switch (item.thresholdType) {
        case "half_life_below": currentValue = econ?.halfLifeMonths ?? null; break;
        case "fragility_above": {
          if (econ?.halfLifeMonths != null && comp?.consensusScore != null) {
            const moat = Math.min(100, (econ.halfLifeMonths / 60) * 30 + comp.consensusScore * 0.25 + 20);
            currentValue = 100 - moat;
          }
          break;
        }
        case "moat_below": {
          if (econ?.halfLifeMonths != null && comp?.consensusScore != null) {
            currentValue = Math.min(100, (econ.halfLifeMonths / 60) * 30 + comp.consensusScore * 0.25 + 20);
          }
          break;
        }
        case "score_below": currentValue = comp?.consensusScore ?? null; break;
        case "evar_above": {
          if (econ?.revenueExposureMm != null && econ?.halfLifeMonths != null && econ?.marginStructurePct != null) {
            currentValue = econ.revenueExposureMm * (econ.marginStructurePct / 100) * (1 - Math.pow(0.5, 12 / econ.halfLifeMonths));
          }
          break;
        }
      }

      if (currentValue === null) continue;

      await db.update(watchlistItemsTable).set({ currentValue }).where(eq(watchlistItemsTable.id, item.id));

      const isTriggered = item.thresholdType.includes("below")
        ? currentValue < item.thresholdValue
        : currentValue > item.thresholdValue;

      if (isTriggered && !item.triggered) {
        triggered++;
        await db.update(watchlistItemsTable).set({ triggered: true, triggeredAt: new Date() }).where(eq(watchlistItemsTable.id, item.id));
        await db.insert(watchlistAlertsTable).values({
          watchlistItemId: item.id,
          message: `${item.thresholdType.replace(/_/g, " ")}: current ${currentValue.toFixed(1)} crossed threshold ${item.thresholdValue}`,
          previousValue: item.currentValue,
          currentValue,
        });
      } else if (!isTriggered && item.triggered) {
        await db.update(watchlistItemsTable).set({ triggered: false }).where(eq(watchlistItemsTable.id, item.id));
      }
    }

    res.json({ checked: allItems.length, triggered });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Acknowledge alert — must belong to the caller's watchlist.
// Pre-fix any tenant could ack any other tenant's alert by id.
router.post("/watchlist/alerts/:id/ack", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const alertId = Number(req.params.id);
    // Walk alert -> item -> watchlist and require the watchlist's session
    // token to match the caller's. 404 on mismatch (don't leak existence).
    const [row] = await db.select({ watchlistId: watchlistItemsTable.watchlistId })
      .from(watchlistAlertsTable)
      .innerJoin(watchlistItemsTable, eq(watchlistAlertsTable.watchlistItemId, watchlistItemsTable.id))
      .where(eq(watchlistAlertsTable.id, alertId));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const [wl] = await db.select({ id: watchlistsTable.id })
      .from(watchlistsTable)
      .where(forSessionRow("watchlists", token, row.watchlistId));
    if (!wl) { res.status(404).json({ error: "Not found" }); return; }
    await db.update(watchlistAlertsTable).set({ acknowledged: true }).where(eq(watchlistAlertsTable.id, alertId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
