/**
 * Render the most-recent macro events (CVI signal events + SEC 8-K
 * filings) into the Letta "market_context" core memory block. Called
 * from the scheduler after edgarRssTick + ceiSignalsTick run, so the
 * Letta agent sees the latest news within minutes of detection.
 *
 * Block content is intentionally a small rolling window — the block
 * limit is 3000 chars and we want the agent's reasoning to dwell on
 * priors + project_focus + economic_rules, not on a verbose news
 * dump. Top 5 of each source, with severity / form type / industry
 * for context.
 *
 * Per plan Phase 1.6.4.
 */
import { db, cviSignalEventsTable, capabilityFilingsTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
// Letta replaced by PostgresStore helpers per Phase 1.8.
import { putAgentPriorBlock } from "./store";

const MAX_SIGNAL_EVENTS = 5;
const MAX_FILINGS = 5;
const ONLY_FORM_TYPES = new Set(["8-K", "10-K", "10-Q", "DEF 14A"]);

/**
 * Compose the block text. Empty body (just a header) when neither
 * source has anything to surface — that's a legitimate state and
 * the agent should know "no flagged macro events in the last sweep".
 */
async function renderMarketContextBlock(): Promise<string> {
  const lines: string[] = [];
  lines.push("Recent macro events (auto-updated by scheduler):");
  lines.push("");

  // ── CVI signal events ──────────────────────────────────────────────
  try {
    const signals = await db
      .select({
        id: cviSignalEventsTable.id,
        capabilityName: capabilitiesTable.name,
        industryName: industriesTable.name,
        magnitudePoints: cviSignalEventsTable.magnitudePoints,
        direction: cviSignalEventsTable.direction,
        severity: cviSignalEventsTable.severity,
        windowEndAt: cviSignalEventsTable.windowEndAt,
        windowDays: cviSignalEventsTable.windowDays,
      })
      .from(cviSignalEventsTable)
      .leftJoin(capabilitiesTable, eq(cviSignalEventsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(industriesTable, eq(cviSignalEventsTable.industryId, industriesTable.id))
      .where(sql`${cviSignalEventsTable.severity} in ('large', 'extreme')`)
      .orderBy(desc(cviSignalEventsTable.windowEndAt))
      .limit(MAX_SIGNAL_EVENTS);

    if (signals.length > 0) {
      lines.push("CVI moves (large/extreme severity):");
      for (const s of signals) {
        const arrow = s.direction === "up" ? "↑" : "↓";
        const cap = s.capabilityName ?? `cap#${s.id}`;
        const ind = s.industryName ?? "—";
        lines.push(`  - ${arrow} ${cap} (${ind}) ${s.magnitudePoints.toFixed(1)}pt over ${s.windowDays}d [${s.severity}]`);
      }
      lines.push("");
    }
  } catch (err) {
    console.warn("[market-context-sync] signal-events fetch failed:", err instanceof Error ? err.message : err);
  }

  // ── EDGAR filings ──────────────────────────────────────────────────
  try {
    const filings = await db
      .select({
        formType: capabilityFilingsTable.formType,
        companyName: capabilityFilingsTable.companyName,
        ticker: capabilityFilingsTable.ticker,
        filingDate: capabilityFilingsTable.filingDate,
        sectionRef: capabilityFilingsTable.sectionRef,
        excerpt: capabilityFilingsTable.excerpt,
        capabilityName: capabilitiesTable.name,
      })
      .from(capabilityFilingsTable)
      .leftJoin(capabilitiesTable, eq(capabilityFilingsTable.capabilityId, capabilitiesTable.id))
      .orderBy(desc(capabilityFilingsTable.filingDate))
      .limit(MAX_FILINGS * 4); // overshoot — we filter form_type below
    const filtered = filings.filter(f => ONLY_FORM_TYPES.has(f.formType)).slice(0, MAX_FILINGS);

    if (filtered.length > 0) {
      lines.push("Recent SEC filings touching tracked capabilities:");
      for (const f of filtered) {
        const ticker = f.ticker ? ` ${f.ticker}` : "";
        const section = f.sectionRef ? ` §${f.sectionRef}` : "";
        const cap = f.capabilityName ?? "—";
        const excerpt = f.excerpt ? ` — "${f.excerpt.slice(0, 80).trim()}…"` : "";
        const date = f.filingDate.toISOString().slice(0, 10);
        lines.push(`  - [${f.formType}] ${f.companyName}${ticker} ${date}${section} re: ${cap}${excerpt}`);
      }
      lines.push("");
    }
  } catch (err) {
    console.warn("[market-context-sync] filings fetch failed:", err instanceof Error ? err.message : err);
  }

  if (lines.length <= 2) {
    return "(no flagged macro events in the last sweep — operating in routine cycle mode)";
  }
  return lines.join("\n");
}

/**
 * Build the block text and push it to Letta. Non-fatal: if Letta is
 * unreachable or the block update fails, we log and continue — the
 * underlying data remains queryable from the Postgres tables.
 */
export async function syncMarketContextToLetta(): Promise<boolean> {
  try {
    const text = await renderMarketContextBlock();
    return await putAgentPriorBlock("market_context", text, { updatedReason: "macro_events_poll" });
  } catch (err) {
    console.error("[market-context-sync] failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
