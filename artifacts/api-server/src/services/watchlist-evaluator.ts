/**
 * Watchlist evaluator.
 *
 * Walks watchlist_items and checks each threshold against current values
 * pulled from cvi_components (consensusScore) and capability_alpha (EVaR
 * derivations). When a threshold is newly breached, writes:
 *   1. A watchlist_alerts row (per-item history)
 *   2. A member_notifications row (the user's inbox + bell badge)
 *
 * Idempotent on (watchlist_item, threshold state) via the `triggered`
 * column — once triggered, doesn't re-fire until value returns inside
 * the threshold and breaches again.
 *
 * Wired into the scheduler tick — same pattern as regulations-watch-notifier.
 */
import { db } from "@workspace/db";
import {
  watchlistItemsTable,
  watchlistsTable,
  watchlistAlertsTable,
  memberNotificationsTable,
  cviComponentsTable,
  capabilityAlphaTable,
  capabilitiesTable,
  organizationsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

interface EvalStats {
  walked: number;
  triggered: number;
  cleared: number;
  errors: number;
}

function evar12FromAlpha(a: {
  revenueExposureMm: number | null;
  marginStructurePct: number | null;
  halfLifeMonths: number | null;
}): number | null {
  if (a.revenueExposureMm == null || a.marginStructurePct == null || a.halfLifeMonths == null) return null;
  const halfLife = Math.max(6, a.halfLifeMonths);
  return a.revenueExposureMm * (a.marginStructurePct / 100) * (1 - Math.pow(0.5, 12 / halfLife));
}

/**
 * Compute the current value for an item's threshold type.
 * Returns null if data isn't available.
 */
function currentValueFor(
  thresholdType: string,
  comp: { consensusScore: number | null } | undefined,
  alpha: { revenueExposureMm: number | null; marginStructurePct: number | null; halfLifeMonths: number | null } | undefined,
): number | null {
  switch (thresholdType) {
    case "score_below":
    case "moat_below":
      return comp?.consensusScore ?? null;
    case "half_life_below":
      return alpha?.halfLifeMonths ?? null;
    case "evar_above":
      return alpha ? evar12FromAlpha(alpha) : null;
    case "fragility_above":
      // Fragility proxy: marginStructurePct lower = more fragile margin
      return alpha?.marginStructurePct ?? null;
    default:
      return null;
  }
}

function breached(thresholdType: string, current: number, threshold: number): boolean {
  // _above types breach when current > threshold; _below when current < threshold.
  if (thresholdType.endsWith("_above")) return current > threshold;
  if (thresholdType.endsWith("_below")) return current < threshold;
  return false;
}

export async function runWatchlistEvaluator(): Promise<EvalStats> {
  const stats: EvalStats = { walked: 0, triggered: 0, cleared: 0, errors: 0 };

  const items = await db.select().from(watchlistItemsTable);
  if (items.length === 0) return stats;

  // Bulk fetch for current values.
  const capIds = Array.from(new Set(items.map(i => i.capabilityId)));
  const [components, alphas, caps, watchlists] = await Promise.all([
    db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, capIds)),
    db.select().from(capabilityAlphaTable).where(inArray(capabilityAlphaTable.capabilityId, capIds)),
    db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds)),
    db.select().from(watchlistsTable).where(inArray(watchlistsTable.id, items.map(i => i.watchlistId))),
  ]);

  const compByCap = new Map(components.map(c => [c.capabilityId, c]));
  const alphaByCap = new Map(alphas.map(a => [a.capabilityId, a]));
  const capById = new Map(caps.map(c => [c.id, c]));
  const watchlistById = new Map(watchlists.map(w => [w.id, w]));

  // Map watchlist sessionTokens back to userIds via organizations.
  const sessionTokens = Array.from(new Set(watchlists.map(w => w.sessionToken).filter((t): t is string => !!t)));
  const orgs = sessionTokens.length > 0
    ? await db.select().from(organizationsTable).where(inArray(organizationsTable.sessionToken, sessionTokens))
    : [];
  const userIdBySessionToken = new Map(orgs.filter(o => !!o.clerkUserId).map(o => [o.sessionToken, o.clerkUserId!]));

  for (const item of items) {
    stats.walked++;
    try {
      const comp = compByCap.get(item.capabilityId);
      const alpha = alphaByCap.get(item.capabilityId);
      const cap = capById.get(item.capabilityId);
      const watchlist = watchlistById.get(item.watchlistId);
      if (!cap || !watchlist) continue;

      const current = currentValueFor(item.thresholdType, comp, alpha);
      if (current == null) continue;

      const isBreached = breached(item.thresholdType, current, item.thresholdValue);

      // State machine: triggered=true once breached, false again when current returns inside threshold.
      if (isBreached && !item.triggered) {
        // Insert alert
        const message = `${cap.name}: ${item.thresholdType.replace("_", " ")} threshold breached — current ${current.toFixed(1)} vs threshold ${item.thresholdValue.toFixed(1)}`;
        await db.insert(watchlistAlertsTable).values({
          watchlistItemId: item.id,
          message,
          previousValue: item.currentValue ?? null,
          currentValue: current,
        });

        // Bridge to inbox if we can resolve a userId
        const userId = userIdBySessionToken.get(watchlist.sessionToken);
        if (userId) {
          await db.insert(memberNotificationsTable).values({
            userId,
            type: "watchlist_alert",
            targetType: "capability",
            targetId: item.capabilityId,
            body: message,
          });
        }

        await db.update(watchlistItemsTable)
          .set({ triggered: true, triggeredAt: new Date(), currentValue: current })
          .where(eq(watchlistItemsTable.id, item.id));
        stats.triggered++;
      } else if (!isBreached && item.triggered) {
        // Cleared — reset trigger flag so a future breach fires fresh.
        await db.update(watchlistItemsTable)
          .set({ triggered: false, triggeredAt: null, currentValue: current })
          .where(eq(watchlistItemsTable.id, item.id));
        stats.cleared++;
      } else if (item.currentValue !== current) {
        // Just update cached value, no state change.
        await db.update(watchlistItemsTable)
          .set({ currentValue: current })
          .where(eq(watchlistItemsTable.id, item.id));
      }
    } catch (err) {
      stats.errors++;
      console.warn(`[watchlist-evaluator] item ${item.id} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  return stats;
}
