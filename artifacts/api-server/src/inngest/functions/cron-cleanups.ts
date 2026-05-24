import { inngest } from "../client";
import { runMarketplaceAutoArchive } from "../../services/marketplace-auto-archive";
import { withStep } from "../step-context";

// Phase 1.x — Inngest wrappers around long-running cleanup pollers.
// Same flag-gated cutover pattern as the agent crons in agents.ts: each
// function checks its `INNGEST_OWNS_*` flag and no-ops when the legacy
// in-process timer still owns the job. The legacy `start*` helpers in
// services/marketplace-auto-archive.ts + services/edgar/rss-watcher.ts
// likewise check the same flag and skip the setInterval when Inngest owns it,
// so the same job never double-runs.

const ownedBy = (flag: string) => process.env[flag] === "1";

// Original cadence: hourly (ARCHIVE_INTERVAL_MS = 60 * 60 * 1000 in
// services/marketplace-auto-archive.ts). Cron expression `0 * * * *` fires
// at the top of every hour to match.
export const marketplaceAutoArchiveCron = inngest.createFunction(
  {
    id: "marketplace-auto-archive",
    triggers: [{ cron: "0 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_MARKETPLACE_AUTO_ARCHIVE")) return { skipped: "flag-off" };
    return await withStep(step, () => runMarketplaceAutoArchive());
  },
);

export const cronCleanupFunctions = [marketplaceAutoArchiveCron];
