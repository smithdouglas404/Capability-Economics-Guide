import { recallMemories, storeMemory } from "./memory";
import { inferTopic } from "./topics";
import { extractEntitiesFromText, upsertEntity, recordRelation } from "./graphMemory";
import { lettaReadBlock, lettaUpdateBlock } from "./letta";
import { emitAgentEvent } from "./events";

export interface ResearchFinding {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  newScore: number;
  confidence: number;
  prevScore?: number;
}

export interface ReflectionResult {
  findings: ResearchFinding[];
  added: number;
  updated: number;
  contradictions: number;
  prirorsUpdated: boolean;
}

const CONTRADICTION_THRESHOLD = 15; // 15-point swing in score = contradiction
const REFINEMENT_THRESHOLD = 5; // 5-point change with related memory = refinement
const HIGH_CONFIDENCE = 0.8;

/**
 * For each finding: compare against recalled memories.
 *  - contradiction (>15pt swing from a high-confidence prior) → store as `contradiction`
 *  - refinement (related memory exists, small delta) → reinforce via add (Mem0's dedup will merge)
 *  - novel → add as `capability_signal`
 * Then update Letta `industry_priors` block with high-confidence consolidation.
 */
export async function reflectOnFindings(
  runId: number,
  findings: ResearchFinding[],
): Promise<ReflectionResult> {
  emitAgentEvent({ type: "phase", phase: "reflecting", message: `Reflecting on ${findings.length} findings...` });

  let added = 0;
  let updated = 0;
  let contradictions = 0;

  for (const f of findings) {
    const query = `${f.industryName} ${f.capabilityName} score moat trend`;
    const priors = await recallMemories(query, "pattern", 5);

    let isContradiction = false;
    let isRefinement = false;

    for (const prior of priors) {
      const priorScore = (prior.metadata as { score?: number })?.score;
      if (typeof priorScore === "number") {
        const delta = Math.abs(f.newScore - priorScore);
        if (delta >= CONTRADICTION_THRESHOLD && prior.relevanceScore > 0.6 && f.confidence >= HIGH_CONFIDENCE) {
          isContradiction = true;
          const contradictionContent =
            `CONTRADICTION: ${f.capabilityName} in ${f.industryName} now scores ${f.newScore.toFixed(1)} (conf ${f.confidence.toFixed(2)}), ` +
            `prior recall said ~${priorScore.toFixed(1)}. Δ=${delta.toFixed(1)}pts. Prior memory: "${prior.content.slice(0, 200)}".`;
          await storeMemory(
            "observation",
            contradictionContent,
            {
              capabilityId: f.capabilityId,
              capabilityName: f.capabilityName,
              industryId: f.industryId,
              industryName: f.industryName,
              priorMemoryId: prior.mem0Id ?? prior.id,
              priorScore,
              newScore: f.newScore,
              delta,
              topic: inferTopic(contradictionContent),
            },
            { category: "contradiction", runId },
          );
          contradictions++;
          break;
        }
        if (delta < REFINEMENT_THRESHOLD && delta > 0) {
          isRefinement = true;
        }
      }
    }

    if (!isContradiction) {
      const tier = f.confidence >= HIGH_CONFIDENCE ? "validated_pattern" : "capability_signal";
      const memoryContent = isRefinement
        ? `Refined: ${f.capabilityName} (${f.industryName}) holds at ~${f.newScore.toFixed(1)} with ${f.confidence.toFixed(2)} confidence. Prior signals corroborate.`
        : `${f.capabilityName} in ${f.industryName} scored ${f.newScore.toFixed(1)} with confidence ${f.confidence.toFixed(2)}. Captured during run #${runId}.`;
      await storeMemory(
        "pattern",
        memoryContent,
        {
          capabilityId: f.capabilityId,
          capabilityName: f.capabilityName,
          industryId: f.industryId,
          industryName: f.industryName,
          score: f.newScore,
          confidence: f.confidence,
          isRefinement,
          topic: inferTopic(memoryContent),
        },
        { category: tier, runId },
      );
      if (isRefinement) updated++; else added++;
    }

    // Graph extraction — record entities and a co_occurs_with relation between industry & capability
    try {
      const entities = await extractEntitiesFromText(`${f.industryName} ${f.capabilityName} ${f.confidence}`);
      const indEnt = entities.find(e => e.kind === "industry" && e.industryId === f.industryId);
      const capEnt = entities.find(e => e.kind === "capability" && e.capabilityId === f.capabilityId);
      if (indEnt && capEnt) {
        const indId = await upsertEntity(indEnt);
        const capId = await upsertEntity(capEnt);
        await recordRelation(indId, capId, "co_occurs_with", f.confidence, {
          runId,
          note: `score=${f.newScore.toFixed(1)} conf=${f.confidence.toFixed(2)}`,
        });
      }
    } catch (err) {
      console.log("[reflect] graph extract failed:", err instanceof Error ? err.message : err);
    }
  }

  // Promote validated_pattern findings into Letta industry_priors block
  let priorsUpdated = false;
  const validated = findings.filter(f => f.confidence >= HIGH_CONFIDENCE);
  if (validated.length > 0) {
    try {
      const current = (await lettaReadBlock("industry_priors")) || "";
      const newLines = validated.map(f =>
        `- [${new Date().toISOString().slice(0, 10)}] ${f.industryName} :: ${f.capabilityName} → score ${f.newScore.toFixed(1)} (conf ${f.confidence.toFixed(2)})`
      );
      const merged = (current + "\n" + newLines.join("\n")).split("\n").filter(l => l.trim()).slice(-60).join("\n");
      priorsUpdated = await lettaUpdateBlock("industry_priors", merged);
    } catch (err) {
      console.log("[reflect] industry_priors update failed:", err instanceof Error ? err.message : err);
    }
  }

  emitAgentEvent({
    type: "reflect_complete",
    runId,
    findings: findings.length,
    added,
    updated,
    contradictions,
    priorsUpdated,
  });

  return { findings, added, updated, contradictions, prirorsUpdated: priorsUpdated };
}
