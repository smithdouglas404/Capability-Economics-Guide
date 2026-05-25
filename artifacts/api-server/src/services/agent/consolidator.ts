import { db } from "@workspace/db";
import { agentMemoriesTable, consolidationRunsTable } from "@workspace/db";
import { sql, desc, eq, and } from "drizzle-orm";
import { storeMemory, deleteMemory } from "./memory";
// Letta replaced by PostgresStore helpers per Phase 1.8.
import { appendAgentArchive, putAgentPriorBlock, getAgentPriorBlock } from "./store";
import { getGraphStats } from "./graphMemory";
import { emitAgentEvent } from "./events";
import { maybeStepAiWrap } from "../../inngest/step-context";

const CONSOLIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const MIN_REPEAT_FOR_VALIDATION = 3; // entity seen 3+ times = validated pattern
const REDUNDANT_OBSERVATION_AGE_DAYS = 7; // observations older than this with mem0Id are deletable post-consolidation
const CLAUDE_MODEL = "anthropic/claude-haiku-4.5";
const CLAUDE_TIMEOUT_MS = 30_000;

let consolidatorTimer: ReturnType<typeof setInterval> | null = null;
let isConsolidating = false;

function isConsolidatorEnabled(): boolean {
  // Feature flag — defaults ON; set CONSOLIDATOR_ENABLED=false to disable in any env
  return (process.env.CONSOLIDATOR_ENABLED ?? "true").toLowerCase() !== "false";
}

export function startConsolidator(intervalMs: number = CONSOLIDATE_INTERVAL_MS): void {
  if (!isConsolidatorEnabled()) {
    console.log("[Consolidator] Disabled via CONSOLIDATOR_ENABLED=false — not scheduling");
    return;
  }
  if (consolidatorTimer) {
    console.log("[Consolidator] Already running");
    return;
  }
  console.log(`[Consolidator] Sleeptime job scheduled every ${(intervalMs / 3600000).toFixed(1)}h (Claude=${CLAUDE_MODEL})`);
  consolidatorTimer = setInterval(() => runConsolidation().catch(e => console.error("[Consolidator] cycle failed:", e)), intervalMs);
  // Kick off first run after 60s so the system can warm up
  setTimeout(() => runConsolidation().catch(e => console.error("[Consolidator] startup run failed:", e)), 60_000);
}

/**
 * Synthesize a validated-pattern narrative from a group of observations using Claude.
 * Returns null on any failure (network, missing key, malformed response) so the caller
 * can fall back to the deterministic statistical summary — the consolidation job MUST
 * still produce output even when the LLM is unreachable.
 */
async function synthesizePatternViaClaude(args: {
  industryName: string;
  capabilityName: string;
  observations: Array<{ content: string; createdAt: Date; metadata: Record<string, unknown> }>;
  avgScore: number;
  avgConfidence: number;
  stability: number;
  variance: number;
}): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  // Build a compact bullet list of observations — cap text length per item to keep prompt under ~6k tokens.
  const bullets = args.observations.slice(0, 20).map((o, i) => {
    const meta = o.metadata || {};
    const score = typeof meta.score === "number" ? `score=${meta.score.toFixed(1)}` : "";
    const conf = typeof meta.confidence === "number" ? `conf=${meta.confidence.toFixed(2)}` : "";
    const date = o.createdAt.toISOString().slice(0, 10);
    const text = (o.content || "").slice(0, 400).replace(/\s+/g, " ").trim();
    return `${i + 1}. [${date} ${score} ${conf}] ${text}`;
  }).join("\n");

  const prompt = `You are summarizing ${args.observations.length} agent observations about the capability "${args.capabilityName}" in the ${args.industryName} industry, collected over the last 30 days.

Statistical signals across the group:
- Average score: ${args.avgScore.toFixed(1)} / 100
- Score variance: ${args.variance.toFixed(2)} (stability ${args.stability.toFixed(2)} where 1.0 = perfectly stable)
- Average confidence: ${args.avgConfidence.toFixed(2)}

Observations:
${bullets}

Write ONE concise paragraph (3-5 sentences, max 600 chars) that captures the validated pattern. Include:
- The current state of the capability (level, trajectory)
- The most consistent signal across observations
- Any divergence or volatility worth flagging

Be factual and specific — do not invent details, only synthesize what the observations actually say. Do NOT use markdown. Do NOT prefix with "VALIDATED PATTERN" or any heading. Output the paragraph only.`;

  try {
    const resp = await maybeStepAiWrap(`openrouter:consolidator:${CLAUDE_MODEL}`, () =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://inflexcvi.ai",
          "X-Title": "Inflexcvi Memory Consolidator",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 400,
          messages: [{ role: "user", content: prompt }],
          usage: { include: true },
        }),
        signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
      }),
    );
    if (!resp.ok) {
      console.warn(`[Consolidator] Claude HTTP ${resp.status} — falling back to statistical summary`);
      return null;
    }
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (data.error) {
      console.warn(`[Consolidator] Claude error: ${data.error.message} — falling back`);
      return null;
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text || text.length < 20) return null;
    return text.slice(0, 800);
  } catch (err) {
    console.warn("[Consolidator] Claude call failed:", err instanceof Error ? err.message : err);
    return null;
  }
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
    // 1. Group recent OBSERVATIONS (not patterns) by industry+capability+topic.
    // Filtering on memoryType='observation' is critical — including pattern rows
    // would re-count already-consolidated memories, distorting MIN_REPEAT_FOR_VALIDATION
    // and producing duplicative pattern outputs cycle after cycle.
    const recentMemories = await db.select().from(agentMemoriesTable)
      .where(and(
        sql`${agentMemoriesTable.createdAt} > NOW() - INTERVAL '30 days'`,
        eq(agentMemoriesTable.memoryType, "observation"),
      ))
      .orderBy(desc(agentMemoriesTable.createdAt))
      .limit(500);
    observationsScanned = recentMemories.length;

    const groups = new Map<string, typeof recentMemories>();
    for (const m of recentMemories) {
      const meta = (m.metadata as Record<string, unknown>) || {};
      const indName = (meta.industryName as string) || "";
      const capName = (meta.capabilityName as string) || "";
      if (!indName || !capName) continue;
      // Topic axis — defaults to "general" when the upstream observation didn't tag one.
      // Once observation producers populate metadata.topic (regulation, M&A, talent, etc.)
      // patterns will become topic-specific automatically.
      const topic = (typeof meta.topic === "string" && meta.topic.trim()) ? meta.topic.trim() : "general";
      const key = `${indName}::${capName}::${topic}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    // 2. For each group with enough repeats, write a validated_pattern + delete redundant raw observations
    for (const [key, items] of groups) {
      if (items.length < MIN_REPEAT_FOR_VALIDATION) continue;

      const [indName, capName, topic] = key.split("::");
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

      const topicTag = topic && topic !== "general" ? ` · topic=${topic}` : "";
      const statsHeader =
        `VALIDATED PATTERN (${items.length} observations / last 30d${topicTag}, avg score ${avgScore.toFixed(1)}, ` +
        `σ²=${variance.toFixed(2)}, stability ${stability.toFixed(2)}, avg confidence ${avgConf.toFixed(2)})`;

      // Try Claude synthesis; fall back to a deterministic line if the LLM is unreachable
      // so consolidation still runs in degraded mode (offline, no API key, rate-limited, etc).
      const claudeSummary = await synthesizePatternViaClaude({
        industryName: indName,
        capabilityName: capName,
        observations: items.map(i => ({
          content: i.content,
          createdAt: i.createdAt,
          metadata: (i.metadata as Record<string, unknown>) || {},
        })),
        avgScore,
        avgConfidence: avgConf,
        stability,
        variance,
      });
      const synthesisMethod: "claude" | "statistical" = claudeSummary ? "claude" : "statistical";
      const narrative = claudeSummary
        ?? `${capName} in ${indName} holds at avg score ${avgScore.toFixed(1)} across ${items.length} observations; ` +
           `low variance (${variance.toFixed(2)}) suggests a durable pattern.`;
      const consolidationContent = `${statsHeader}: ${narrative}`;

      try {
        await storeMemory(
          "pattern",
          consolidationContent,
          {
            industryName: indName,
            capabilityName: capName,
            topic,
            avgScore,
            avgConfidence: avgConf,
            stability,
            sourceCount: items.length,
            consolidationRunId: run.id,
            synthesisMethod,
            synthesisModel: synthesisMethod === "claude" ? CLAUDE_MODEL : null,
          },
          { category: "validated_pattern", ttlDays: 365 },
        );
        patternsConsolidated++;

        // Insert into the agent's archival namespace (PostgresStore) for
        // long-term reasoning. Same kind/runId metadata pattern as the
        // cycle_summary append from graph.ts:memorizeNode.
        const ok = await appendAgentArchive(
          `[validated_pattern] ${consolidationContent}`,
          { kind: "validated_pattern", groupKey: key, patternsInGroup: items.length },
        );
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

    // 3. Append a top-of-mind graph summary into the agent's
    //    research_strategy block (PostgresStore). Same "replace anything
    //    after the [graph] marker" behavior as the old Letta version.
    try {
      const graph = await getGraphStats();
      if (graph.topRelations.length > 0) {
        const summary =
          `Top observed capability relationships (graph layer): ` +
          graph.topRelations.slice(0, 8).map(r => `${r.from}→${r.to} [${r.kind}, w=${r.weight.toFixed(2)}, n=${r.observedCount}]`).join("; ");
        const current = (await getAgentPriorBlock("research_strategy")) || "";
        const merged = current.split("\n\n[graph]").slice(0, 1).join("") + `\n\n[graph] ${summary}`;
        await putAgentPriorBlock("research_strategy", merged, { updatedReason: "consolidator_graph_summary" });
      }
    } catch (err) {
      console.log("[Consolidator] graph→store update skipped:", err instanceof Error ? err.message : err);
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
