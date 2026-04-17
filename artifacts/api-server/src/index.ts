import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./services/agent";
import { db, capabilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

  void db.update(capabilitiesTable)
    .set({ enrichmentStatus: "failed", enrichmentError: "interrupted by server restart", enrichmentUpdatedAt: new Date() })
    .where(eq(capabilitiesTable.enrichmentStatus, "running"))
    .then(() => logger.info("Reset stale running enrichment rows on boot"))
    .catch(e => logger.error({ err: e }, "Failed to reset stale enrichment rows"));

  startScheduler();
  logger.info("Agent scheduler started (30min interval)");

  startEnrichmentWorker();
  logger.info("Enrichment job worker started");
});
