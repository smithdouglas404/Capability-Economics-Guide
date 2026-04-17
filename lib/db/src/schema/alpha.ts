import { pgTable, serial, integer, text, real, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";
import { industriesTable } from "./industries";

export const capabilityEconomicsTable = pgTable("capability_economics", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  runId: integer("run_id"),
  tamUsdMm: real("tam_usd_mm"),
  samUsdMm: real("sam_usd_mm"),
  marginStructurePct: real("margin_structure_pct"),
  halfLifeMonths: real("half_life_months"),
  commoditizationVelocity: real("commoditization_velocity"),
  revenueExposureMm: real("revenue_exposure_mm"),
  consensusQuadrant: varchar("consensus_quadrant", { length: 20 }),
  consensusConfidence: real("consensus_confidence"),
  consensusSummary: text("consensus_summary"),
  consensusSources: jsonb("consensus_sources").$type<string[]>(),
  rationale: text("rationale"),
  // Capability detail enrichments (added 2026-04)
  aiExposureScore: real("ai_exposure_score"),
  aiTimeToDisplacementMonths: real("ai_time_to_displacement_months"),
  aiSubstitutes: jsonb("ai_substitutes").$type<string[]>(),
  aiNarrative: text("ai_narrative"),
  traditionalNarrative: text("traditional_narrative"),
  economicNarrative: text("economic_narrative"),
  metricInterpretations: jsonb("metric_interpretations").$type<Array<{ name: string; interpretation: string }>>(),
  dependencyRationales: jsonb("dependency_rationales").$type<Array<{ dependsOnName: string; rationale: string }>>(),
  roleConsequences: jsonb("role_consequences").$type<Array<{ roleTitle: string; consequence: string }>>(),
  playbook: jsonb("playbook").$type<string[]>(),
  benchmarkInterpretation: text("benchmark_interpretation"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const dependencyEdgeScoresTable = pgTable("dependency_edge_scores", {
  id: serial("id").primaryKey(),
  dependencyId: integer("dependency_id").notNull(),
  disruptionProbability: real("disruption_probability"),
  timeToImpactMonths: real("time_to_impact_months"),
  dollarImpactMm: real("dollar_impact_mm"),
  rationale: text("rationale"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});
