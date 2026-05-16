/**
 * One-shot historical CVI replay. Walks source_triangulations history and
 * generates daily reconstructed snapshots for the past N days (default 90)
 * so the time-series UI has visible history immediately rather than waiting
 * weeks for live snapshots to accumulate.
 *
 * Idempotent — skips any date with an existing snapshot in the dedup
 * window. Safe to re-run.
 *
 * Args via env:
 *   CEI_REPLAY_DAYS         — how many days back from today (default 90)
 *   CEI_REPLAY_INTERVAL_DAYS — interval between snapshots (default 1)
 *   CEI_REPLAY_DRY_RUN=1    — compute but don't persist
 */
import { replayHistoricalCVI } from "../../artifacts/api-server/src/services/cvi-historical/replay";

async function main() {
  const days = Number(process.env.CEI_REPLAY_DAYS ?? "90");
  const intervalDays = Number(process.env.CEI_REPLAY_INTERVAL_DAYS ?? "1");
  const dryRun = process.env.CEI_REPLAY_DRY_RUN === "1";

  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`Replaying CVI history from ${fromDate.toISOString().slice(0, 10)} to ${toDate.toISOString().slice(0, 10)} (interval=${intervalDays}d, dryRun=${dryRun})…`);

  const result = await replayHistoricalCVI({ fromDate, toDate, intervalDays, dryRun });

  console.log("Done.");
  console.log(`  Scanned ${result.scanned} dates`);
  console.log(`  Inserted ${result.inserted} reconstructed snapshots`);
  console.log(`  Skipped (dedup) ${result.skippedDedup}`);
  console.log(`  Skipped (no source data yet) ${result.skippedNoData}`);
  if (result.errors.length > 0) {
    console.log(`  Errors (${result.errors.length}):`);
    for (const e of result.errors.slice(0, 10)) console.log(`    - ${e}`);
  }
  if (result.series) {
    console.log("  Sample series (dry run):");
    for (const s of result.series.slice(-10)) {
      console.log(`    ${s.asOf.slice(0, 10)}  index=${s.overallIndex.toFixed(2)}  industries=${s.industryCount}`);
    }
  }
}

main().catch(err => {
  console.error("CVI replay failed:", err);
  process.exit(1);
});
