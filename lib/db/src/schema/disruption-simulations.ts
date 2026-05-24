/**
 * Disruption Simulator — saved user scenarios for the time-axis "what
 * happens over the next 36 months if someone executes this disruption"
 * tool at /disruption-simulator.
 *
 * Sibling to disruption_lab_scenarios (which captures point-in-time DI
 * recomputes); this one captures the full time-series trajectory + the
 * parameters that produced it, so the user can come back, fork, share,
 * and re-run with different assumptions.
 *
 * Trajectory is stored as JSON per-month: a small array (max 60 entries
 * for the 60-month max horizon) so the row stays compact.
 */
import { pgTable, serial, integer, real, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";

/** One month of the simulated trajectory. */
export interface SimulationTrajectoryPoint {
  month: number;
  entrantStrength: number;      // 0..100, Bass-derived adoption × capital × (1 - reg friction)
  incumbentCvi: number;         // incumbent's effective CVI, declining as entrant gains share
  entrantMarketShare: number;   // 0..1
  /** USD MM at risk for the incumbent at this month — cumulative revenue moved to entrant. */
  cumulativeDollarsDisruptedMm: number;
}

/** Per-dependent-capability cascade impact at horizon end. */
export interface SimulationCascadePoint {
  capabilityId: number;
  capabilityName: string;
  baselineCvi: number;
  finalCvi: number;
  deltaPct: number;
}

/** Defender-response counterfactual: what would shifting one knob do. */
export interface SimulationDefenderOption {
  action: "none" | "acquire" | "build" | "lobby_regulatory";
  description: string;
  newCrossoverMonth: number | null;
  estimatedCostUsdMm: number | null;
}

export const disruptionSimulationsTable = pgTable(
  "disruption_simulations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    /** The hypothetical disruptive capability the user defined. Not a row in
     *  capabilities — it's a hypothetical, captured inline. */
    entrantName: text("entrant_name").notNull(),
    entrantJtbd: text("entrant_jtbd").notNull(),
    /** Enabling tech ids from disruption_enabling_tech that the entrant uses. */
    entrantTechIds: jsonb("entrant_tech_ids").$type<number[]>().notNull().default([]),

    /** The incumbent capabilities the entrant is targeting (1-3 caps). */
    targetCapabilityIds: jsonb("target_capability_ids").$type<number[]>().notNull().default([]),

    /** Adoption-curve preset: "slow_burn" | "standard_b2b_saas" | "viral_b2c" | "stripe_dev". */
    adoptionCurve: text("adoption_curve").notNull().default("standard_b2b_saas"),
    /** Capital tier: "bootstrap" | "seed" | "series_b" | "mega_fund". Scales p in Bass. */
    capitalTier: text("capital_tier").notNull().default("seed"),
    /** Months of regulatory friction before adoption can begin. */
    regulatoryFrictionMonths: integer("regulatory_friction_months").notNull().default(0),
    /** Simulation horizon (12-60 months). */
    horizonMonths: integer("horizon_months").notNull().default(36),
    /** Substitution factor 0.1-1.0 — how perfectly the entrant replaces incumbent demand. */
    substitutionFactor: real("substitution_factor").notNull().default(0.7),

    /** Defender response: "none" | "acquire" | "build" | "lobby_regulatory". */
    defenderResponse: text("defender_response").notNull().default("none"),

    /** Output: month at which entrant strength crosses incumbent CVI. Null = no crossover in horizon. */
    crossoverMonth: integer("crossover_month"),
    /** Output: final entrant market share at horizon end (0..1). */
    finalEntrantShare: real("final_entrant_share").notNull().default(0),
    /** Output: total cumulative dollars disrupted (USD MM). */
    totalDollarsDisruptedMm: real("total_dollars_disrupted_mm").notNull().default(0),

    /** Output: time-series trajectory (one entry per simulated month). */
    trajectory: jsonb("trajectory").$type<SimulationTrajectoryPoint[]>().notNull().default([]),
    /** Output: cascade impact on each dependent capability at horizon end. */
    cascade: jsonb("cascade").$type<SimulationCascadePoint[]>().notNull().default([]),
    /** Output: defender counterfactual options computed alongside the main run. */
    defenderOptions: jsonb("defender_options").$type<SimulationDefenderOption[]>().notNull().default([]),

    /** Top playbook match for the entrant's tech stack + target combination. */
    topPlaybookId: integer("top_playbook_id"),
    /** Optional source pitch text (when origin=pitch). */
    pitchSource: text("pitch_source"),
    /** "manual" | "pitch" | "fork-of-lab" | "fork-of-sim". */
    origin: text("origin").notNull().default("manual"),
    /** When forked from another scenario, the parent's id. */
    parentSimulationId: integer("parent_simulation_id"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("disruption_simulations_user_idx").on(t.userId),
    index("disruption_simulations_created_idx").on(t.createdAt),
  ],
);

export type DisruptionSimulation = typeof disruptionSimulationsTable.$inferSelect;

/** Foreign keys are intentionally NOT declared on targetCapabilityIds /
 * entrantTechIds — they're stored as JSON arrays because most simulations
 * are exploratory (the user is testing what-ifs against ids that may be
 * deleted / merged later). The route layer validates ids exist at run time. */
void capabilitiesTable; // referenced for documentation
