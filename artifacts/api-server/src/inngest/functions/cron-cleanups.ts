import { inngest } from "../client";
import { runMarketplaceAutoArchive } from "../../services/marketplace-auto-archive";
import { runEdgarRssWatcherOnce } from "../../services/edgar/rss-watcher";
import { runGdpWeightsRefresh } from "../../services/gdp-weights-refresh";
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

// Original cadence: every 15 minutes (EDGAR_RSS_INTERVAL_MS = 15 * 60 * 1000
// in services/agent/scheduler.ts). Cron expression `*/15 * * * *` fires at
// :00 / :15 / :30 / :45 to match — staying well under SEC's per-IP rate
// limits and matching the comment on the original setInterval.
export const edgarRssWatcherCron = inngest.createFunction(
  {
    id: "edgar-rss-watcher",
    triggers: [{ cron: "*/15 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_EDGAR_RSS")) return { skipped: "flag-off" };
    return await withStep(step, () => runEdgarRssWatcherOnce());
  },
);

// Weekly GDP weight refresh. Re-runs the seed logic against the live World
// Bank API + the in-code allocation rules. The refresh function auto-detects
// drift >10% between stored value and rule-computed value and updates in
// place — so retuned multipliers or new World Bank data flow through without
// requiring a deploy or a FORCE flag.
//
// Cadence: weekly (Sundays 04:30 UTC). WB indicators update annually, so
// weekly is plenty fresh without hammering the public API.
export const gdpWeightsRefreshCron = inngest.createFunction(
  {
    id: "gdp-weights-refresh",
    triggers: [{ cron: "30 4 * * 0" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_GDP_WEIGHTS_REFRESH")) return { skipped: "flag-off" };
    return await withStep(step, () => runGdpWeightsRefresh());
  },
);

export const cronCleanupFunctions = [marketplaceAutoArchiveCron, edgarRssWatcherCron, gdpWeightsRefreshCron];
