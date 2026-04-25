/**
 * One-shot: apply schema to all 7 CE Datasets so their columns become
 * queryable. Run this after the initial sync once — subsequent syncs handle
 * schema-apply automatically (see replaceDatasetCsv in client.ts).
 *
 * Run: pnpm --filter @workspace/scripts run apply-schemas:foundry
 */

import { DATASETS } from "./config";
import { applySchemaFromCsv } from "./client";

const log = (...args: unknown[]) =>
  console.error(`[${new Date().toISOString().slice(11, 19)}] ${args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);

async function main() {
  log("Applying schema to all 7 CE Datasets...");
  const entries = Object.entries(DATASETS);
  let ok = 0, failed = 0;
  for (const [name, rid] of entries) {
    const t = Date.now();
    const r = await applySchemaFromCsv(rid);
    if (r.ok) {
      log(`  ✓ ${name.padEnd(20)} via=${r.via} (${Date.now() - t}ms)`);
      ok++;
    } else {
      log(`  ✗ ${name.padEnd(20)} ${r.error}`);
      failed++;
    }
  }
  log(`Done — ${ok}/${entries.length} OK, ${failed} failed`);
  if (failed > 0) {
    log("For any failed Dataset, apply schema manually in Foundry: open the Dataset → Schema tab → Apply schema.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => {
  console.error("FAIL:", e);
  process.exit(1);
});
