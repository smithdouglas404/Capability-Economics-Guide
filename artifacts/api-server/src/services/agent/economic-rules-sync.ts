/**
 * Serialize the economic_rules table into the Letta "economic_rules"
 * core memory block. Called:
 *   1. Once at api-server boot (in startScheduler) so the agent always
 *      sees the latest thresholds on cold start.
 *   2. Whenever an admin PATCH /api/admin/economic-rules/:key fires
 *      (lib/api change), so the agent sees rule edits within seconds
 *      rather than waiting for the next consolidator pass.
 *
 * Format kept deliberately compact — the block has a 4000-char limit
 * and we want headroom for the agent's reasoning, not for verbose
 * descriptions. Long descriptions are truncated to 120 chars per line.
 *
 * Per plan Phase 1.5.2 + 1.5.6.
 */
import { db, economicRulesTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import { lettaUpdateBlock } from "./letta";

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function formatValue(v: unknown, unit: string | null): string {
  if (typeof v === "number") {
    const u = unit ? ` ${unit}` : "";
    return `${v}${u}`;
  }
  return `${JSON.stringify(v)}${unit ? ` ${unit}` : ""}`;
}

export async function renderEconomicRulesBlock(): Promise<string> {
  const rules = await db.select().from(economicRulesTable).orderBy(asc(economicRulesTable.key));
  if (rules.length === 0) {
    return "(no economic rules configured yet — seed:economic-rules has not run)";
  }
  const header =
    "Strategic thresholds I reason against. These are admin-configured. " +
    "When live data crosses one of these, I should flag it via my write tools rather than silently note it.\n\n";
  const lines = rules.map(r => `- ${r.key} = ${formatValue(r.value, r.unit)} — ${truncate(r.description, 120)}`);
  return header + lines.join("\n");
}

/**
 * Push the latest rendered block into Letta. Returns true on success
 * (Letta connected + block update ok), false otherwise — failures are
 * non-fatal; the rules remain authoritative in Postgres.
 */
export async function syncEconomicRulesToLetta(): Promise<boolean> {
  try {
    const text = await renderEconomicRulesBlock();
    return await lettaUpdateBlock("economic_rules", text);
  } catch (err) {
    console.error("[economic-rules-sync] failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
