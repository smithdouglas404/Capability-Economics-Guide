/**
 * Public-facing "proof" surface for the marketing/demo `/proof` page.
 *
 * Wraps the existing admin backtest harness (services/backtest.ts) with a
 * cache so unauthenticated visitors can see the results without each visit
 * triggering an expensive re-run of computeCVI() twice per event.
 *
 * Cache: in-memory, 1h TTL. First visitor after expiry pays the compute cost
 * (~2-10s); subsequent visitors get instant reads. A manual admin trigger
 * (`runBacktest()` on /backtest) refreshes the same cache.
 */
import { runBacktest, type BacktestSummary } from "./backtest";

const CACHE_TTL_MS = 60 * 60 * 1000;
let cached: { at: number; value: BacktestSummary } | null = null;
let inFlight: Promise<BacktestSummary> | null = null;

export async function getProofBacktest(force = false): Promise<BacktestSummary> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (inFlight) return inFlight;
  inFlight = runBacktest()
    .then(value => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function _resetProofCacheForTest(): void {
  cached = null;
  inFlight = null;
}
