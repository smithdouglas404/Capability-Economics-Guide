/**
 * Background-fire shim for invoking the enrichment LangGraph from non-blocking
 * callers (cron tick, admin UI button). Returns immediately; the graph runs
 * in the background and emits SSE events the admin UI subscribes to.
 *
 * Concurrency-safe: a module-level promise flags an in-flight run so two
 * triggers can't double-invoke. New triggers while the graph is running are
 * silently dropped — the next scheduled tick will pick up any remaining work.
 */

import { logger } from "../../lib/logger";

let inFlight: Promise<void> | null = null;

export async function runEnrichmentGraph(targetIndustryIds: number[]): Promise<void> {
  if (inFlight) {
    logger.info("[graph-trigger] graph already running — drop trigger");
    return;
  }
  // Lazy import keeps the graph + its agent-memory deps out of the auto-enrich
  // module's import graph until actually invoked.
  const { runEnrichmentGraph: invokeGraph } = await import("../enrichment/graph");

  inFlight = (async () => {
    try {
      await invokeGraph({
        trigger: "scheduled",
        targetIndustryIds: targetIndustryIds.length > 0 ? targetIndustryIds : undefined,
      });
    } catch (err) {
      logger.error({ err }, "[graph-trigger] background graph run failed");
    } finally {
      inFlight = null;
    }
  })();
}
