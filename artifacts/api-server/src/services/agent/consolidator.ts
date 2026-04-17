import { db } from "@workspace/db";
import { agentMemoriesTable, consolidationRunsTable } from "@workspace/db";
import { sql, desc, eq, and } from "drizzle-orm";
import { storeMemory, deleteMemory } from "./memory";
import { lettaArchivalInsert, lettaUpdateBlock, lettaReadBlock } from "./letta";
import { getGraphStats } from "./graphMemory";
import { emitAgentEvent } from "./events";

const CONSOLIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const MIN_REPEAT_FOR_VALIDATION = 3; // entity seen 3+ times = validated pattern
const REDUNDANT_OBSERVATION_AGE_DAYS = 7; // observations older than this with mem0Id are deletable post-consolidation

let consolidatorTimer: ReturnType<typeof setInterval> | null = null;
let isConsolidating = false;

export function startConsolidator(intervalMs: number = CONSOLIDATE_INTERVAL_MS): void {
  if (consolidatorTimer) {
    console.log("[Consolidator] Already running");
    return;
  }
  console.log(`[Consolidator] Sleeptime job scheduled every ${(intervalMs / 3600000).toFixed(1)}h`);
  consolidatorTimer = setInterval(() => runConsolidation().catch(e => console.error("[Consolidator] cycle failed:", e)), intervalMs);
  // Kick off first run after 60s so the system can warm up
  setTimeout(() => runConsolidation().catch(e => console.error("[Consolidator] startup run failed:", e)), 60_000);
}

export function stopConsolidator(): void {
  if (consolidatorTimer) {
    clearInterval(consolidatorTimer);
    consolidatorTimer = null;
    console.log("[Consolidator] Stopped");
  }
}

export async function runConsolidation(): Promise<{
  observationsScanned: number;
  patternsConsolidated: number;
  redundantDeleted: number;
  archivalInserted: number;
} | null> {
  if (isConsolidating) {
    console.log("[Consolidator] Skipping — previous run still in progress");
    return null;
  }
  isConsolidating = true;

  const [run] = await db.insert(consolidationRunsTable).values({}).returning();
  emitAgentEvent({ type: "consolidation_started", runId: run.id });

  let observationsScanned = 0;
  let patternsConsolidated = 0;
  let redundantDeleted = 0;
  let archivalInserted = 0;
  let errorMessage: string | null = null;

  try {
    // 1. Group recent observations/patterns by capability+industry
    const recentMemories = await db.select().from(agentMemoriesTable)
      .where(sql`${agentMemoriesTable.createdAt} > NOW() - INTERVAL '30 days'`)
      .orderBy(desc(agentMemoriesTable.createdAt))
      .limit(500);
    observationsScanned = recentMemories.length;

    const groups = new Map<string, typeof recentMemories>();
    for (const m of recentMemories) {
      const meta = (m.metadata as Record<string, unknown>) || {};
      const indName = (meta.industryName as string) || "";
      const capName = (meta.capabilityName as string) || "";
      if (!indName || !capName) continue;
      const key = `${indName}::${capName}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    // 2. For each group with enough repeats, write a validated_pattern + delete redundant raw observations
    for (const [key, items] of groups) {
      if (items.length < MIN_REPEAT_FOR_VALIDATION) continue;

      const [indName, capName] = key.split("::");
      const scores = items
        .map(i => (i.metadata as { score?: number })?.score)
        .filter((s): s is number => typeof s === "number");
      const confs = items
        .map(i => (i.metadata as { confidence?: number })?.confidence)
        .filter((c): c is number => typeof c === "number");

      if (scores.length === 0) continue;

      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const avgConf = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.7;
      const variance = scores.length > 1
        ? scores.reduce((s, x) => s + (x - avgScore) ** 2, 0) / scores.length
        : 0;
      const stability = 1 / (1 + Math.sqrt(variance));

      const consolidationContent =
        `VALIDATED PATTERN (${items.length} observations across last 30d): ${capName} in ${indName} ` +
        `holds at avg score ${avgScore.toFixed(1)} (σ²=${variance.toFixed(2)}, stability ${stability.toFixed(2)}, ` +
        `avg confidence ${avgConf.toFixed(2)}). This pattern is durable.`;

      try {
        await storeMemory(
          "pattern",
          consolidationContent,
          {
            industryName: indName,
            capabilityName: capName,
            avgScore,
            avgConfidence: avgConf,
            stability,
            sourceCount: items.length,
            consolidationRunId: run.id,
          },
          { category: "validated_pattern", ttlDays: 365 },
        );
        patternsConsolidated++;

        // Insert into Letta archival memory for long-term reasoning
        const ok = await lettaArchivalInsert(`[validated_pattern] ${consolidationContent}`);
        if (ok) archivalInserted++;

        // Delete redundant raw observations (only those tied to Mem0, older than 7d)
        const cutoff = Date.now() - REDUNDANT_OBSERVATION_AGE_DAYS * 86400000;
        for (const m of items) {
          if (m.mem0Id && m.memoryType === "observation" && m.createdAt.getTime() < cutoff) {
            try {
              const ok = await deleteMemory(m.mem0Id);
              if (ok) redundantDeleted++;
            } catch { /* ignore individual delete failures */ }
          }
        }
      } catch (err) {
        console.error(`[Consolidator] group ${key} failed:`, err instanceof Error ? err.message : err);
      }
    }

    // 3. Update Letta industry_priors block with a top-of-mind summary derived from graph
    try {
      const graph = await getGraphStats();
      if (graph.topRelations.length > 0) {
        const summary =
          `Top observed capability relationships (graph layer): ` +
          graph.topRelations.slice(0, 8).map(r => `${r.from}→${r.to} [${r.kind}, w=${r.weight.toFixed(2)}, n=${r.observedCount}]`).join("; ");
        const current = (await lettaReadBlock("research_strategy")) || "";
        const merged = current.split("\n\n[graph]").slice(0, 1).join("") + `\n\n[graph] ${summary}`;
        await lettaUpdateBlock("research_strategy", merged);
      }
    } catch (err) {
      console.log("[Consolidator] graph→Letta update skipped:", err instanceof Error ? err.message : err);
    }

  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Consolidator] Run failed:", errorMessage);
  } finally {
    await db.update(consolidationRunsTable)
      .set({
        completedAt: new Date(),
        observationsScanned,
        patternsConsolidated,
        redundantDeleted,
        archivalInserted,
        errorMessage,
      })
      .where(eq(consolidationRunsTable.id, run.id));

    emitAgentEvent({
      type: "consolidation_complete",
      runId: run.id,
      observationsScanned,
      patternsConsolidated,
      redundantDeleted,
      archivalInserted,
    });
    isConsolidating = false;
  }

  return { observationsScanned, patternsConsolidated, redundantDeleted, archivalInserted };
}

export async function getLastConsolidation(): Promise<typeof consolidationRunsTable.$inferSelect | null> {
  const [last] = await db.select().from(consolidationRunsTable)
    .orderBy(desc(consolidationRunsTable.startedAt))
    .limit(1);
  return last ?? null;
}
