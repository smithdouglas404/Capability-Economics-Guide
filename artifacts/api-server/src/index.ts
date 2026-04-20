import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./services/agent";
import { db, capabilitiesTable, capabilityEconomicsTable, dependencyEdgeScoresTable, capabilityDependenciesTable, enrichmentRunsTable } from "@workspace/db";
import { eq, inArray, isNull, and } from "drizzle-orm";
import { startEnrichmentWorker } from "./services/alpha/queue";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Boot cleanup — any capability stuck in `enrichmentStatus='running'`
  // means a worker crashed mid-job. Reset it AND delete the partial
  // capability_economics / dependency_edge_scores rows it may have written
  // so the next run starts clean instead of skipping the capability as
  // "already enriched". Scope is narrow: only caps the DB says are running.
  void (async () => {
    try {
      const stuck = await db
        .select({ id: capabilitiesTable.id })
        .from(capabilitiesTable)
        .where(eq(capabilitiesTable.enrichmentStatus, "running"));
      if (stuck.length === 0) return;
      const stuckIds = stuck.map(c => c.id);
      const delEcon = await db.delete(capabilityEconomicsTable).where(inArray(capabilityEconomicsTable.capabilityId, stuckIds)).returning({ id: capabilityEconomicsTable.id });
      const stuckDeps = await db.select({ id: capabilityDependenciesTable.id }).from(capabilityDependenciesTable).where(inArray(capabilityDependenciesTable.capabilityId, stuckIds));
      const delEdges = stuckDeps.length > 0
        ? await db.delete(dependencyEdgeScoresTable).where(inArray(dependencyEdgeScoresTable.dependencyId, stuckDeps.map(d => d.id))).returning({ id: dependencyEdgeScoresTable.id })
        : [];
      await db.update(capabilitiesTable)
        .set({ enrichmentStatus: "failed", enrichmentError: "interrupted by server restart — partial data cleared", enrichmentUpdatedAt: new Date() })
        .where(eq(capabilitiesTable.enrichmentStatus, "running"));
      logger.info({ capabilitiesReset: stuck.length, economicsDeleted: delEcon.length, edgeScoresDeleted: delEdges.length }, "Boot cleanup of interrupted enrichment");
    } catch (e) {
      logger.error({ err: e }, "Failed boot cleanup of interrupted enrichment");
    }
  })();

  // Also clean up the legacy LangGraph enrichment_runs table — any row with
  // status="running" and no completedAt is from a Node process that died
  // mid-run (most often a redeploy). The in-memory `enrichmentRunning`
  // guard resets on boot, so any such row is by definition stale.
  void (async () => {
    try {
      const stale = await db
        .update(enrichmentRunsTable)
        .set({ status: "interrupted", completedAt: new Date() })
        .where(and(eq(enrichmentRunsTable.status, "running"), isNull(enrichmentRunsTable.completedAt)))
        .returning({ id: enrichmentRunsTable.id });
      if (stale.length > 0) {
        logger.info({ runsReset: stale.length }, "Boot cleanup of stale enrichment_runs rows");
      }
    } catch (e) {
      logger.error({ err: e }, "Failed to clean up stale enrichment_runs");
    }
  })();

  startScheduler();
  logger.info("Agent scheduler started (30min interval)");

  startEnrichmentWorker();
  logger.info("Enrichment job worker started");
});
