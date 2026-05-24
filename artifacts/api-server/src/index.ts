import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./services/agent";
import { db, capabilitiesTable, capabilityAlphaTable, dependencyEdgeScoresTable, capabilityDependenciesTable, enrichmentRunsTable } from "@workspace/db";
import { eq, inArray, isNull, and } from "drizzle-orm";
import { verifySchema } from "./lib/schema-check";
import { backfillMissingSubCapabilities } from "./services/sub-cap-backfill";
import { ensurePublicPreviewSeed } from "./services/public-preview-seed";
import { startFoundryHourlySync, fireFoundrySync, rehydrateFoundryAlertState } from "./services/foundry/sync";
import { startInngestConnectWorker, stopInngestConnectWorker } from "./inngest/connect-worker";

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

  // Schema check — fail loudly if any load-bearing table is missing. Runs
  // before scheduler/worker start so missing tables are visible at boot in
  // logs and on /healthz/schema instead of silently breaking enrichment.
  void verifySchema().catch(err => logger.error({ err }, "[schema] verifySchema threw"));

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
      const delEcon = await db.delete(capabilityAlphaTable).where(inArray(capabilityAlphaTable.capabilityId, stuckIds)).returning({ id: capabilityAlphaTable.id });
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
  // Inngest Realtime is the sole agent-events transport now (Phase 7
  // cleanup). The legacy SSE bus + bridge were deleted along with the
  // /api/agent/events endpoints — browsers subscribe directly via
  // `inngest/react`'s `useRealtime` hook + a token minted by
  // POST /api/agent/realtime-token.

  // Auto-rotation checker — daily tick that rotates ADMIN_API_KEY when
  // cadence is reached (and the operator has enabled auto-rotation +
  // configured notifyEmail). No-op when DB row doesn't exist or auto
  // is off; see services/scheduled-rotation.ts for details.
  void import("./services/scheduled-rotation").then(({ startScheduledRotation }) => {
    startScheduledRotation();
    logger.info("Scheduled admin-key rotation checker started (24h interval)");
  });

  // Sub-capability self-heal — drives every environment toward the same
  // canonical state on boot. If staging and dev drift (e.g., decomposition
  // ran on one but not the other), this is what closes the gap. Idempotent
  // and cheap when nothing's missing — see sub-cap-backfill.ts.
  void backfillMissingSubCapabilities()
    .catch(err => logger.error({ err }, "[sub-cap-backfill] threw"));

  // Public-preview self-heal — guarantees /explore is populated in any
  // environment (dev, staging, prod-after-restore) without requiring a
  // manual seed step. Idempotent and a no-op once 10+ caps are flagged.
  void ensurePublicPreviewSeed()
    .catch(err => logger.error({ err }, "[public-preview-seed] threw"));

  // Foundry mirror — hourly catch-up sync covers writes that don't go through
  // the agent (manual reviewer edits, assessments, direct DB writes). The
  // agent itself fires fireFoundrySync at end-of-run so per-cap reruns
  // surface in Foundry within seconds. No-ops if Foundry env vars aren't set.
  // Rebuild the in-memory token-rotation alert from the persisted sync log
  // tail BEFORE the boot-tick fires, so the banner stays visible across
  // restarts even if the boot sync hasn't run yet. Awaited so the boot
  // sync's alert evaluation doesn't race against rehydration.
  void (async () => {
    await rehydrateFoundryAlertState();
    startFoundryHourlySync();
    fireFoundrySync("api-server boot");
  })();

  // Inngest Connect — opt-in WebSocket worker. When INNGEST_CONNECT=1 is set,
  // dial out to the self-hosted Inngest gateway and receive step invocations
  // over a persistent socket instead of the inbound HTTP webhook at
  // /api/inngest. The webhook stays mounted regardless so we can flip back
  // by unsetting the flag. Connect is beta in inngest@4.4.0 — see
  // ./inngest/connect-worker.ts for the verification trail.
  void startInngestConnectWorker().catch((err) => {
    logger.error({ err }, "[inngest-connect] startInngestConnectWorker rejected");
  });
});

// Graceful shutdown — when Railway sends SIGTERM during a redeploy, close
// the Connect worker before the process exits so in-flight WebSocket leases
// drain cleanly. The Inngest SDK already wires its own signal handlers by
// default; this is the explicit belt-and-braces path that also lets us log
// the shutdown reason at the api-server level.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    logger.info({ signal: sig }, "[inngest-connect] shutdown signal received");
    void stopInngestConnectWorker();
  });
}
