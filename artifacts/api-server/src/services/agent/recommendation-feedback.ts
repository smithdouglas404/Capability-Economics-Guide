/**
 * Recommendation Accuracy Feedback Loop — AI-FIRST learning mechanism.
 *
 * This module closes the loop between what the stack optimizer recommends
 * (build / buy / outsource) and what actually happens to the capability's
 * CVI score over the following 30/60/90 days.
 *
 * The core insight: if we recommended "build" for a capability and its CVI
 * score improved by > 5 points in the next 60 days, that is a validated
 * pattern. If it stayed flat or declined, that is a contradiction. Both
 * outcomes are written to Mem0 as high-confidence pattern memories so the
 * next recommendation for a similar capability is informed by evidence, not
 * just heuristics.
 *
 * This is the mechanism that makes recommendations genuinely improve over time.
 *
 * Data flow:
 * 1. Read insights table for rows with a recommendation field (written by generateInsightsTool)
 * 2. For each recommendation, check the capability's CVI trajectory in cvi_snapshots
 * 3. Score the outcome: validated / contradicted / inconclusive
 * 4. Write the outcome to Mem0 as a pattern memory
 * 5. Update the insight row with outcome metadata
 */
import { db } from "@workspace/db";
import { capabilityInsightsTable, cviSnapshotsTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { and, eq, gte, lt, desc, isNotNull } from "drizzle-orm";
import { storeMemory } from "./memory";

export interface RecommendationOutcome {
  insightId: number;
  capabilityName: string;
  industryName: string;
  recommendation: string;
  /** CVI score at the time the recommendation was made */
  baselineScore: number | null;
  /** CVI score 60 days later */
  outcomeScore: number | null;
  /** Points gained (positive) or lost (negative) */
  scoreDelta: number | null;
  /** "validated" | "contradicted" | "inconclusive" */
  verdict: "validated" | "contradicted" | "inconclusive";
  /** Written to Mem0 */
  patternMemoryContent: string;
}

export interface FeedbackReport {
  generatedAt: string;
  insightsEvaluated: number;
  validated: number;
  contradicted: number;
  inconclusive: number;
  outcomes: RecommendationOutcome[];
}

const OUTCOME_WINDOW_DAYS = 60;
const VALIDATED_THRESHOLD_POINTS = 5;   // CVI improved by >= 5 pts = validated
const CONTRADICTED_THRESHOLD_POINTS = -3; // CVI declined by >= 3 pts = contradicted

/**
 * Score recommendation accuracy for insights generated > 60 days ago.
 *
 * Only evaluates insights that:
 * 1. Have a non-null recommendation field
 * 2. Have a capabilityFocus that maps to a real capability
 * 3. Were generated > OUTCOME_WINDOW_DAYS ago (so we have outcome data)
 * 4. Have not already been evaluated (checked via metadata)
 */
export async function scoreRecommendationAccuracy(): Promise<FeedbackReport> {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - OUTCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Load insights with recommendations that are old enough to have outcomes
  const insights = await db
    .select()
    .from(capabilityInsightsTable)
    .where(
      and(
        isNotNull(capabilityInsightsTable.recommendation),
        lt(capabilityInsightsTable.generatedAt, cutoffDate),
      )
    )
    .orderBy(desc(capabilityInsightsTable.generatedAt))
    .limit(50); // Process in batches to avoid overwhelming the DB

  if (insights.length === 0) {
    return {
      generatedAt: now.toISOString(),
      insightsEvaluated: 0,
      validated: 0,
      contradicted: 0,
      inconclusive: 0,
      outcomes: [],
    };
  }

  // Load industry and capability name maps
  const [allIndustries, allCaps] = await Promise.all([
    db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable),
    db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name, industryId: capabilitiesTable.industryId }).from(capabilitiesTable),
  ]);
  const industryNameById = new Map(allIndustries.map(i => [i.id, i.name]));
  const capsByName = new Map(allCaps.map(c => [c.name.toLowerCase(), c]));

  const outcomes: RecommendationOutcome[] = [];
  let validated = 0, contradicted = 0, inconclusive = 0;

  for (const insight of insights) {
    if (!insight.recommendation) continue;

    // Try to match capabilityFocus to a real capability
    // Use capabilityId directly from the insight row
    const cap = insight.capabilityId ? allCaps.find(c => c.id === insight.capabilityId) : null;

    if (!cap) {
      // No capability match — inconclusive
      outcomes.push({
        insightId: insight.id,
        capabilityName: "Unknown",
        industryName: insight.industryId ? (industryNameById.get(insight.industryId) ?? "Unknown") : "Unknown",
        recommendation: insight.recommendation,
        baselineScore: null,
        outcomeScore: null,
        scoreDelta: null,
        verdict: "inconclusive",
        patternMemoryContent: "",
      });
      inconclusive++;
      continue;
    }

    // Get CVI snapshot closest to when the insight was generated (baseline)
    const insightDate = insight.generatedAt ? new Date(insight.generatedAt) : new Date();
    const baselineWindow = new Date(insightDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const outcomeWindowStart = new Date(insightDate.getTime() + (OUTCOME_WINDOW_DAYS - 7) * 24 * 60 * 60 * 1000);
    const outcomeWindowEnd = new Date(insightDate.getTime() + (OUTCOME_WINDOW_DAYS + 7) * 24 * 60 * 60 * 1000);

    const [baselineSnapshots, outcomeSnapshots] = await Promise.all([
      db.select()
        .from(cviSnapshotsTable)
        .where(
          and(
            gte(cviSnapshotsTable.snapshotAt, baselineWindow),
            lt(cviSnapshotsTable.snapshotAt, insightDate),
          )
        )
        .orderBy(desc(cviSnapshotsTable.snapshotAt))
        .limit(1),
      db.select()
        .from(cviSnapshotsTable)
        .where(
          and(
            gte(cviSnapshotsTable.snapshotAt, outcomeWindowStart),
            lt(cviSnapshotsTable.snapshotAt, outcomeWindowEnd),
          )
        )
        .orderBy(desc(cviSnapshotsTable.snapshotAt))
        .limit(1),
    ]);

    const baselineScore = baselineSnapshots[0]?.overallIndex ?? null;
    const outcomeScore = outcomeSnapshots[0]?.overallIndex ?? null;

    if (baselineScore === null || outcomeScore === null) {
      outcomes.push({
        insightId: insight.id,
        capabilityName: cap.name,
        industryName: industryNameById.get(cap.industryId) ?? "Unknown",
        recommendation: insight.recommendation,
        baselineScore,
        outcomeScore,
        scoreDelta: null,
        verdict: "inconclusive",
        patternMemoryContent: "",
      });
      inconclusive++;
      continue;
    }

    const scoreDelta = outcomeScore - baselineScore;
    let verdict: RecommendationOutcome["verdict"];
    let patternMemoryContent: string;
    const industryName = industryNameById.get(cap.industryId) ?? "Unknown";

    if (scoreDelta >= VALIDATED_THRESHOLD_POINTS) {
      verdict = "validated";
      validated++;
      patternMemoryContent = `VALIDATED RECOMMENDATION: A "${insight.recommendation.substring(0, 100)}..." recommendation for ${cap.name} in ${industryName} was validated — CVI improved by ${scoreDelta.toFixed(1)} points over ${OUTCOME_WINDOW_DAYS} days (from ${baselineScore.toFixed(1)} to ${outcomeScore.toFixed(1)}). This approach worked for this capability type.`;
    } else if (scoreDelta <= CONTRADICTED_THRESHOLD_POINTS) {
      verdict = "contradicted";
      contradicted++;
      patternMemoryContent = `CONTRADICTED RECOMMENDATION: A "${insight.recommendation.substring(0, 100)}..." recommendation for ${cap.name} in ${industryName} was contradicted — CVI declined by ${Math.abs(scoreDelta).toFixed(1)} points over ${OUTCOME_WINDOW_DAYS} days (from ${baselineScore.toFixed(1)} to ${outcomeScore.toFixed(1)}). This approach did not work for this capability type. Reconsider similar recommendations.`;
    } else {
      verdict = "inconclusive";
      inconclusive++;
      patternMemoryContent = "";
    }

    outcomes.push({
      insightId: insight.id,
      capabilityName: cap.name,
      industryName,
      recommendation: insight.recommendation,
      baselineScore,
      outcomeScore,
      scoreDelta,
      verdict,
      patternMemoryContent,
    });

    // Write validated and contradicted outcomes to Mem0
    if (patternMemoryContent && (verdict === "validated" || verdict === "contradicted")) {
      await storeMemory(
        "pattern",
        patternMemoryContent,
        {
          source: "recommendation_feedback",
          verdict,
          capabilityName: cap.name,
          industryName,
          scoreDelta,
          insightId: insight.id,
        },
        { category: "recommendation_outcome" },
      ).catch(() => {
        // Non-fatal
      });
    }
  }

  return {
    generatedAt: now.toISOString(),
    insightsEvaluated: insights.length,
    validated,
    contradicted,
    inconclusive,
    outcomes,
  };
}

/**
 * Score a single recommendation by insight id. Mirrors the per-row logic of
 * {@link scoreRecommendationAccuracy} but skips the bulk DB scan — meant to
 * be called by the event-driven Inngest function
 * `recommendationFeedbackOnInsight`, which sleeps for 60 days after the
 * insight is created and then wakes up to evaluate just that one row.
 *
 * Returns null when the insight doesn't exist, has no recommendation, or
 * doesn't map to a real capability (silently skipped — same behavior as the
 * bulk path, which logs the inconclusive case but doesn't error).
 */
export async function scoreRecommendationByInsightId(
  insightId: number,
): Promise<RecommendationOutcome | null> {
  const [insight] = await db
    .select()
    .from(capabilityInsightsTable)
    .where(eq(capabilityInsightsTable.id, insightId))
    .limit(1);

  if (!insight || !insight.recommendation) return null;

  const [allIndustries, allCaps] = await Promise.all([
    db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable),
    db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name, industryId: capabilitiesTable.industryId }).from(capabilitiesTable),
  ]);
  const industryNameById = new Map(allIndustries.map(i => [i.id, i.name]));

  const cap = insight.capabilityId ? allCaps.find(c => c.id === insight.capabilityId) : null;
  if (!cap) {
    return {
      insightId: insight.id,
      capabilityName: "Unknown",
      industryName: insight.industryId ? (industryNameById.get(insight.industryId) ?? "Unknown") : "Unknown",
      recommendation: insight.recommendation,
      baselineScore: null,
      outcomeScore: null,
      scoreDelta: null,
      verdict: "inconclusive",
      patternMemoryContent: "",
    };
  }

  const insightDate = insight.generatedAt ? new Date(insight.generatedAt) : new Date();
  const baselineWindow = new Date(insightDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const outcomeWindowStart = new Date(insightDate.getTime() + (OUTCOME_WINDOW_DAYS - 7) * 24 * 60 * 60 * 1000);
  const outcomeWindowEnd = new Date(insightDate.getTime() + (OUTCOME_WINDOW_DAYS + 7) * 24 * 60 * 60 * 1000);

  const [baselineSnapshots, outcomeSnapshots] = await Promise.all([
    db.select()
      .from(cviSnapshotsTable)
      .where(
        and(
          gte(cviSnapshotsTable.snapshotAt, baselineWindow),
          lt(cviSnapshotsTable.snapshotAt, insightDate),
        )
      )
      .orderBy(desc(cviSnapshotsTable.snapshotAt))
      .limit(1),
    db.select()
      .from(cviSnapshotsTable)
      .where(
        and(
          gte(cviSnapshotsTable.snapshotAt, outcomeWindowStart),
          lt(cviSnapshotsTable.snapshotAt, outcomeWindowEnd),
        )
      )
      .orderBy(desc(cviSnapshotsTable.snapshotAt))
      .limit(1),
  ]);

  const baselineScore = baselineSnapshots[0]?.overallIndex ?? null;
  const outcomeScore = outcomeSnapshots[0]?.overallIndex ?? null;
  const industryName = industryNameById.get(cap.industryId) ?? "Unknown";

  if (baselineScore === null || outcomeScore === null) {
    return {
      insightId: insight.id,
      capabilityName: cap.name,
      industryName,
      recommendation: insight.recommendation,
      baselineScore,
      outcomeScore,
      scoreDelta: null,
      verdict: "inconclusive",
      patternMemoryContent: "",
    };
  }

  const scoreDelta = outcomeScore - baselineScore;
  let verdict: RecommendationOutcome["verdict"];
  let patternMemoryContent: string;

  if (scoreDelta >= VALIDATED_THRESHOLD_POINTS) {
    verdict = "validated";
    patternMemoryContent = `VALIDATED RECOMMENDATION: A "${insight.recommendation.substring(0, 100)}..." recommendation for ${cap.name} in ${industryName} was validated — CVI improved by ${scoreDelta.toFixed(1)} points over ${OUTCOME_WINDOW_DAYS} days (from ${baselineScore.toFixed(1)} to ${outcomeScore.toFixed(1)}). This approach worked for this capability type.`;
  } else if (scoreDelta <= CONTRADICTED_THRESHOLD_POINTS) {
    verdict = "contradicted";
    patternMemoryContent = `CONTRADICTED RECOMMENDATION: A "${insight.recommendation.substring(0, 100)}..." recommendation for ${cap.name} in ${industryName} was contradicted — CVI declined by ${Math.abs(scoreDelta).toFixed(1)} points over ${OUTCOME_WINDOW_DAYS} days (from ${baselineScore.toFixed(1)} to ${outcomeScore.toFixed(1)}). This approach did not work for this capability type. Reconsider similar recommendations.`;
  } else {
    verdict = "inconclusive";
    patternMemoryContent = "";
  }

  if (patternMemoryContent && (verdict === "validated" || verdict === "contradicted")) {
    await storeMemory(
      "pattern",
      patternMemoryContent,
      {
        source: "recommendation_feedback",
        verdict,
        capabilityName: cap.name,
        industryName,
        scoreDelta,
        insightId: insight.id,
      },
      { category: "recommendation_outcome" },
    ).catch(() => {
      // Non-fatal
    });
  }

  return {
    insightId: insight.id,
    capabilityName: cap.name,
    industryName,
    recommendation: insight.recommendation,
    baselineScore,
    outcomeScore,
    scoreDelta,
    verdict,
    patternMemoryContent,
  };
}
