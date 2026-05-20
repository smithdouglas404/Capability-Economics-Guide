/**
 * Seed the economic_rules table with the platform's implicit strategic
 * thresholds — the ones currently hardcoded as constants in the engine
 * and graph nodes. Idempotent upsert by `key`.
 *
 * Pulls defaults from:
 *   - services/agent/graph.ts:72-77 (STALE_THRESHOLD_DAYS,
 *     HIGH_VOLATILITY_THRESHOLD, LOW_CONFIDENCE_THRESHOLD,
 *     DEFAULT_MAX_RESEARCH_PER_RUN — operational, not strategic, so
 *     stays in agent_tuning)
 *   - services/cvi-engine.ts / services/dvx-engine.ts — score floors,
 *     posterior-variance limits
 *   - The DVX 3-factor weighting (40/30/30)
 *
 * Once this table is populated, an admin can update any value via the
 * /api/admin/economic-rules PATCH endpoint and the Letta agent picks
 * up the change on the next sync (via economic-rules-sync.ts).
 *
 * Skip flag: SKIP_ECONOMIC_RULES_SEED=1.
 */
import { db, economicRulesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

interface RuleDef {
  key: string;
  value: unknown;
  unit: string | null;
  description: string;
}

const RULES: RuleDef[] = [
  // ─── CVI thresholds ─────────────────────────────────────────────────
  {
    key: "cvi_floor",
    value: 400,
    unit: "score",
    description: "Capabilities scoring below this CVI value are considered economically weak. The agent should flag any capability that crosses below this threshold for at least 2 consecutive cycles.",
  },
  {
    key: "cvi_ceiling_for_attention",
    value: 850,
    unit: "score",
    description: "Capabilities above this CVI are considered stable / dominant. The agent deprioritizes them in routine cycles unless DVX > dvx_ceiling.",
  },
  {
    key: "cvi_posterior_variance_max",
    value: 0.25,
    unit: "ratio",
    description: "Maximum acceptable variance on the Bayesian posterior before the score is treated as 'low confidence' and prioritized for fresh research.",
  },

  // ─── DVX thresholds ─────────────────────────────────────────────────
  {
    key: "dvx_ceiling",
    value: 70,
    unit: "score",
    description: "Capabilities with DVX >= this value are in the disruption red zone. The agent should always research these regardless of CVI score, and the c-suite recommendation engine flags them as 'urgent'.",
  },
  {
    key: "dvx_watch_threshold",
    value: 50,
    unit: "score",
    description: "Capabilities with DVX between this value and dvx_ceiling are 'watch' zone — prioritized in routine cycles, but not yet alarm-worthy.",
  },
  {
    key: "dvx_velocity_band_low",
    value: -0.05,
    unit: "ratio_per_year",
    description: "Capability velocity below this (i.e. declining quickly) is treated as a fragility signal that bumps DVX prior.",
  },
  {
    key: "dvx_velocity_band_high",
    value: 0.15,
    unit: "ratio_per_year",
    description: "Substitute/competitor capability velocity above this is treated as a strong displacement signal in the DVX velocity-divergence factor.",
  },
  {
    key: "dvx_pattern_match_min_confidence",
    value: 0.55,
    unit: "ratio",
    description: "Minimum pattern-match confidence (0-1) before the agent considers a historical disruption pattern (Uber/Airbnb/Stripe/etc.) genuinely applicable. Below this, pattern match contributes only weakly to DVX.",
  },

  // ─── Economic multipliers + EV ──────────────────────────────────────
  {
    key: "economic_multiplier_min",
    value: 0.5,
    unit: "multiplier",
    description: "Minimum acceptable multiplier on industry GDP contribution before the capability's economic weight is considered negligible.",
  },
  {
    key: "ev_at_risk_alarm_threshold",
    value: 250,
    unit: "usd_millions",
    description: "Per-capability enterprise value exposure (EVaR) above this triggers an admin-level alarm and prioritized c-suite recommendation generation.",
  },
  {
    key: "ev_at_risk_warn_threshold",
    value: 50,
    unit: "usd_millions",
    description: "EVaR above this surfaces in the CFO-persona recommendation copy but does not page operators.",
  },

  // ─── Reflection / contradiction policy ──────────────────────────────
  {
    key: "contradiction_score_delta",
    value: 15,
    unit: "score_points",
    description: "Reflection flags a contradiction when a fresh research finding moves a high-confidence prior by more than this many CVI points.",
  },
  {
    key: "contradiction_min_prior_confidence",
    value: 0.8,
    unit: "ratio",
    description: "A contradiction is only declared if the overturned prior had at least this much confidence (otherwise it's just a refinement).",
  },
  {
    key: "refinement_score_delta",
    value: 5,
    unit: "score_points",
    description: "Movement less than this is treated as a refinement (small update) rather than novel signal or contradiction.",
  },

  // ─── Validation / consolidation ─────────────────────────────────────
  {
    key: "validation_min_repeat_count",
    value: 3,
    unit: "count",
    description: "A raw observation must be corroborated by at least this many independent research findings before the consolidator promotes it to validated_pattern category.",
  },
  {
    key: "memory_relevance_min",
    value: 0.35,
    unit: "ratio",
    description: "Mem0 search threshold — vector similarity hits below this are dropped before reaching the decide node.",
  },

  // ─── DVX factor weights (these are policy, expose for tuning) ───────
  {
    key: "dvx_weight_velocity_divergence",
    value: 0.4,
    unit: "ratio",
    description: "Weight of factor 1 (velocity divergence) in the DVX combined score. Sum of all three weights must equal 1.0.",
  },
  {
    key: "dvx_weight_dependency_fragility",
    value: 0.3,
    unit: "ratio",
    description: "Weight of factor 2 (dependency fragility) in the DVX combined score.",
  },
  {
    key: "dvx_weight_pattern_match",
    value: 0.3,
    unit: "ratio",
    description: "Weight of factor 3 (pattern-match confidence) in the DVX combined score.",
  },
];

async function main(): Promise<void> {
  if (process.env.SKIP_ECONOMIC_RULES_SEED === "1") {
    console.log("[seed:economic-rules] SKIP_ECONOMIC_RULES_SEED=1 — skipping");
    return;
  }
  for (const rule of RULES) {
    await db.insert(economicRulesTable).values({
      key: rule.key,
      value: rule.value,
      unit: rule.unit,
      description: rule.description,
    }).onConflictDoUpdate({
      target: economicRulesTable.key,
      // Update description but preserve admin-customized value/unit.
      // If someone has tuned a threshold, we don't want a redeploy to
      // clobber it back to the seed default.
      set: {
        description: sql`excluded.description`,
        lastUpdatedAt: sql`now()`,
      },
    });
  }
  console.log(`[seed:economic-rules] processed ${RULES.length} rules (inserts + idempotent updates).`);
}

main()
  .catch((err) => {
    console.error("[seed:economic-rules] failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
