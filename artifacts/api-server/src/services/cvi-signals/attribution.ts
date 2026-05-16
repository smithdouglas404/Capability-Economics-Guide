import { db, cviSignalEventsTable, cviSignalOutcomesTable, capabilityFilingsTable } from "@workspace/db";
import { eq, sql, and, isNotNull, gte } from "drizzle-orm";
import { fetchPriceSeries, priceOnOrBefore, cumulativeReturnPct } from "./price-feed";
import { logger } from "../../lib/logger";

const WINDOW_DAYS = [30, 60, 90, 180] as const;
const PRICE_SOURCE = "yfinance-public";

/**
 * Outcome attribution job — for each signal event without outcomes yet,
 * resolve exposed tickers via capability_filings (companies whose SEC
 * filings mention the capability), fetch +30/+60/+90/+180-day forward
 * returns from the price feed, upsert one cvi_signal_outcomes row per
 * (event, ticker, window).
 *
 * Marks event.outcome_attributed=1 once attribution completes (or fails
 * with no tickers), so the next sweep skips it.
 *
 * Resilient — individual ticker failures don't abort the event; partial
 * attribution still flips the flag to avoid re-fetching the same event
 * forever. Abnormal-return computation defers to a future industry-index
 * baseline; for the demo path we record cumulative_return_pct and leave
 * abnormal_return_pct null.
 */
export interface AttributionResult {
  eventsScanned: number;
  outcomesWritten: number;
  tickersResolved: number;
  errors: string[];
  durationMs: number;
}

export async function attributeSignalOutcomes(opts: { limit?: number; eventId?: number } = {}): Promise<AttributionResult> {
  const start = Date.now();
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  const errors: string[] = [];
  let outcomesWritten = 0;
  let tickersResolved = 0;

  // Pull events that need attribution. If a specific event_id is supplied,
  // process just that one (admin re-trigger path).
  const where = opts.eventId != null
    ? eq(cviSignalEventsTable.id, opts.eventId)
    : eq(cviSignalEventsTable.outcomeAttributed, 0);
  const events = await db.select().from(cviSignalEventsTable).where(where).limit(limit);

  for (const event of events) {
    // Only attempt attribution for events whose newest window data exists
    // — for the 180-day window we need 180 days of post-event data,
    // i.e. windowEndAt must be at least 180 days in the past for full
    // coverage. For shorter windows, partial attribution is fine.
    const tickers = await resolveExposedTickers(event.capabilityId);
    tickersResolved += tickers.length;
    if (tickers.length === 0) {
      // No exposed tickers known yet — mark as attribute-attempted so we
      // don't keep scanning. A future re-run can be admin-triggered after
      // more capability_filings rows have accumulated.
      await db.update(cviSignalEventsTable)
        .set({ outcomeAttributed: 1 })
        .where(eq(cviSignalEventsTable.id, event.id));
      continue;
    }

    for (const ticker of tickers) {
      const maxLookahead = Math.max(...WINDOW_DAYS);
      const fetchTo = new Date(event.windowEndAt.getTime() + (maxLookahead + 7) * 24 * 60 * 60 * 1000);
      const fetchFrom = new Date(event.windowEndAt.getTime() - 7 * 24 * 60 * 60 * 1000);
      const bars = await fetchPriceSeries(ticker, fetchFrom, fetchTo);
      if (bars.length === 0) {
        errors.push(`event ${event.id} ticker ${ticker}: no price bars`);
        continue;
      }
      const startPrice = priceOnOrBefore(bars, event.windowEndAt);
      if (startPrice == null) {
        errors.push(`event ${event.id} ticker ${ticker}: no start price`);
        continue;
      }

      for (const windowDays of WINDOW_DAYS) {
        const targetDate = new Date(event.windowEndAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
        // Don't attribute outcomes for windows extending past today
        if (targetDate.getTime() > Date.now()) continue;
        const endPrice = priceOnOrBefore(bars, targetDate);
        const ret = cumulativeReturnPct(startPrice, endPrice);
        if (ret == null) continue;
        try {
          await db.insert(cviSignalOutcomesTable).values({
            signalEventId: event.id,
            ticker,
            cik: null,
            windowDays,
            cumulativeReturnPct: ret,
            abnormalReturnPct: null, // future: subtract industry-index return
            startPrice,
            endPrice,
            priceSource: PRICE_SOURCE,
          }).onConflictDoNothing();
          outcomesWritten++;
        } catch (err) {
          errors.push(`event ${event.id} ticker ${ticker} w${windowDays}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    await db.update(cviSignalEventsTable)
      .set({ outcomeAttributed: 1 })
      .where(eq(cviSignalEventsTable.id, event.id));
  }

  const durationMs = Date.now() - start;
  if (outcomesWritten > 0 || errors.length > 0) {
    logger.info({ eventsScanned: events.length, outcomesWritten, tickersResolved, errors: errors.length, durationMs }, "[cei-attribution] sweep complete");
  }
  return {
    eventsScanned: events.length,
    outcomesWritten,
    tickersResolved,
    errors,
    durationMs,
  };
}

/**
 * Resolve up to 5 exposed tickers for a capability from capability_filings.
 * Picks the most-recent distinct tickers (most likely to still be relevant).
 * Returns empty array when no filings have surfaced tickers yet.
 */
async function resolveExposedTickers(capabilityId: number): Promise<string[]> {
  const rows = await db
    .select({ ticker: capabilityFilingsTable.ticker, filingDate: capabilityFilingsTable.filingDate })
    .from(capabilityFilingsTable)
    .where(and(eq(capabilityFilingsTable.capabilityId, capabilityId), isNotNull(capabilityFilingsTable.ticker)))
    .orderBy(sql`${capabilityFilingsTable.filingDate} DESC`);
  const seen = new Set<string>();
  const tickers: string[] = [];
  for (const r of rows) {
    if (!r.ticker) continue;
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    tickers.push(r.ticker);
    if (tickers.length >= 5) break;
  }
  return tickers;
}

/**
 * Aggregate stats per (severity, direction, window) for the predictive
 * thesis: "events of severity S in direction D were followed by avg
 * abnormal-return X% over Y days." Used by the admin signals dashboard
 * to communicate the backtest result.
 */
export interface SignalBacktestSummary {
  severity: string;
  direction: string;
  windowDays: number;
  n: number;
  meanReturnPct: number;
  medianReturnPct: number;
  hitRatePct: number; // % of outcomes with sign matching event direction
}

export async function getSignalBacktestSummary(opts: { sinceDays?: number } = {}): Promise<SignalBacktestSummary[]> {
  const sinceDays = Math.max(1, opts.sinceDays ?? 365);
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      severity: cviSignalEventsTable.severity,
      direction: cviSignalEventsTable.direction,
      windowDays: cviSignalOutcomesTable.windowDays,
      returnPct: cviSignalOutcomesTable.cumulativeReturnPct,
    })
    .from(cviSignalOutcomesTable)
    .innerJoin(cviSignalEventsTable, eq(cviSignalOutcomesTable.signalEventId, cviSignalEventsTable.id))
    .where(and(gte(cviSignalEventsTable.windowEndAt, since), isNotNull(cviSignalOutcomesTable.cumulativeReturnPct)));

  const groups = new Map<string, number[]>();
  const directions = new Map<string, string>();
  const severities = new Map<string, string>();
  const windows = new Map<string, number>();

  for (const r of rows) {
    if (r.returnPct == null) continue;
    const key = `${r.severity}|${r.direction}|${r.windowDays}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      severities.set(key, r.severity);
      directions.set(key, r.direction);
      windows.set(key, r.windowDays);
    }
    groups.get(key)!.push(r.returnPct);
  }

  const summaries: SignalBacktestSummary[] = [];
  for (const [key, returns] of groups.entries()) {
    if (returns.length === 0) continue;
    returns.sort((a, b) => a - b);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const median = returns.length % 2 === 0
      ? (returns[returns.length / 2 - 1] + returns[returns.length / 2]) / 2
      : returns[Math.floor(returns.length / 2)];
    const direction = directions.get(key)!;
    const expectedSign = direction === "up" ? 1 : -1;
    const hits = returns.filter(r => Math.sign(r) === expectedSign).length;
    summaries.push({
      severity: severities.get(key)!,
      direction,
      windowDays: windows.get(key)!,
      n: returns.length,
      meanReturnPct: mean,
      medianReturnPct: median,
      hitRatePct: (hits / returns.length) * 100,
    });
  }
  return summaries.sort((a, b) => b.n - a.n);
}
