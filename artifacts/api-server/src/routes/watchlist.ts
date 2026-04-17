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

const router = Router();

// Get watchlist with items and alerts
router.get("/watchlist", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.json({ watchlist: null, items: [], alerts: [] }); return; }

    let [watchlist] = await db.select().from(watchlistsTable).where(eq(watchlistsTable.sessionToken, token));
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

    let [watchlist] = await db.select().from(watchlistsTable).where(eq(watchlistsTable.sessionToken, sessionToken));
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

// Remove item
router.delete("/watchlist/items/:id", async (req, res) => {
  try {
    await db.delete(watchlistItemsTable).where(eq(watchlistItemsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Check watchlist thresholds and generate alerts
router.post("/watchlist/check", async (req, res) => {
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
          const moat = econ ? Math.min(100, ((econ.halfLifeMonths ?? 36) / 60) * 30 + (comp?.consensusScore ?? 50) * 0.25 + 20) : null;
          currentValue = moat !== null ? 100 - moat : null;
          break;
        }
        case "moat_below": {
          currentValue = econ ? Math.min(100, ((econ.halfLifeMonths ?? 36) / 60) * 30 + (comp?.consensusScore ?? 50) * 0.25 + 20) : null;
          break;
        }
        case "score_below": currentValue = comp?.consensusScore ?? null; break;
        case "evar_above": {
          if (econ && econ.revenueExposureMm && econ.halfLifeMonths) {
            currentValue = econ.revenueExposureMm * ((econ.marginStructurePct ?? 30) / 100) * (1 - Math.pow(0.5, 12 / econ.halfLifeMonths));
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

// Acknowledge alert
router.post("/watchlist/alerts/:id/ack", async (req, res) => {
  try {
    await db.update(watchlistAlertsTable).set({ acknowledged: true }).where(eq(watchlistAlertsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
