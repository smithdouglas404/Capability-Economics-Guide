import { logger } from "../../lib/logger";

/**
 * Public stock-price fetcher backed by Yahoo Finance's free v8 chart API.
 * No API key required. Used by the outcome-attribution job to measure
 * forward returns post-CVI-signal-event.
 *
 * Trade-offs for the demo path:
 *   - Yahoo's endpoint is undocumented but stable (it's what their own
 *     finance.yahoo.com pages use). Rate limits are unpublished;
 *     anecdotally ~1000 req/hour per IP is fine.
 *   - For a production switch, swap this module for Polygon ($29/mo
 *     Starter) or Alpha Vantage (free 25/day, paid ~$50/mo). The
 *     fetchPriceSeries signature is the abstraction boundary —
 *     callers don't care which feed backs it.
 */

export interface PriceBar {
  date: Date;
  close: number;
}

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * Daily close prices for a ticker over a date range. Returns empty array
 * (not throws) on any fetch / parse failure — outcome attribution should
 * be resilient to individual tickers being missing.
 */
export async function fetchPriceSeries(ticker: string, from: Date, to: Date): Promise<PriceBar[]> {
  const period1 = Math.floor(from.getTime() / 1000);
  const period2 = Math.floor(to.getTime() / 1000);
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;

  try {
    const resp = await fetch(url, {
      headers: {
        // Yahoo blocks the default node fetch UA; mimic a browser
        "User-Agent": "Mozilla/5.0 (compatible; CapabilityEconomics/1.0; +https://inflexcvi.ai)",
        "Accept": "application/json",
      },
    });
    if (!resp.ok) {
      logger.debug({ ticker, status: resp.status }, "[price-feed] non-200 response");
      return [];
    }
    const data = await resp.json() as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
        error?: unknown;
      };
    };
    const result = data.chart?.result?.[0];
    if (!result?.timestamp || !result.indicators?.quote?.[0]?.close) return [];

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const bars: PriceBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || !Number.isFinite(close)) continue;
      bars.push({ date: new Date(timestamps[i] * 1000), close });
    }
    return bars;
  } catch (err) {
    logger.debug({ ticker, err: err instanceof Error ? err.message : String(err) }, "[price-feed] fetch failed");
    return [];
  }
}

/**
 * Closing price closest to (but not after) the target date. Returns null
 * when no bars exist before the target. Used for "start" and "end" prices
 * in return computation.
 */
export function priceOnOrBefore(bars: PriceBar[], target: Date): number | null {
  let chosen: number | null = null;
  for (const bar of bars) {
    if (bar.date.getTime() <= target.getTime()) chosen = bar.close;
    else break;
  }
  return chosen;
}

/**
 * Cumulative return between two prices, expressed as percent
 * (positive = up). Returns null when either price is missing.
 */
export function cumulativeReturnPct(startPrice: number | null, endPrice: number | null): number | null {
  if (startPrice == null || endPrice == null || startPrice === 0) return null;
  return ((endPrice - startPrice) / startPrice) * 100;
}
