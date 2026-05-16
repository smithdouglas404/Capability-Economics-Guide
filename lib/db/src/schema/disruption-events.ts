import { pgTable, serial, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Real-world disruption events. Distinct from disruption_patterns (which
 * are abstract playbook templates — "the Uber pattern", "the Airbnb
 * pattern"). disruption_events is the actual historical and ongoing
 * catalog of when specific companies disrupted specific incumbents:
 * "Netflix kills Blockbuster, 2010" / "Uber Series A, 2011" / etc.
 *
 * Foundation for two things:
 *   1. User idea analyzer (POST /api/ideas/analyze-disruption) — given a
 *      user's idea, find the closest historical analogues from this catalog.
 *   2. Per-capability evidence panel — for any capability X, show "events
 *      where X was disrupted" + "events where X was created."
 *
 * Seeded with ~25 well-documented historical events at boot. The autonomous
 * agent can append new events via the discover_disruption_events tool
 * (future) — typically by scanning news / EDGAR / industry analyst reports.
 *
 * Idempotency: slug is unique. Re-running the seed is a no-op for existing
 * slugs; new events that the agent discovers get added.
 */
export const disruptionEventsTable = pgTable(
  "disruption_events",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(), // "netflix-vs-blockbuster-2007", "stripe-launch-2011"
    title: text("title").notNull(), // "Netflix streaming displaces Blockbuster retail"
    headline: text("headline").notNull(), // one-line hook
    /** Year the disruption became materially measurable (inflection, not founding). */
    eventYear: integer("event_year").notNull(),
    /** Optional precise date if known. */
    eventDate: timestamp("event_date"),
    /** Disruptor company name. */
    disruptorCompany: text("disruptor_company").notNull(),
    /** Disruptor's CIK if US public + ever filed (nullable for private/foreign). */
    disruptorCik: text("disruptor_cik"),
    /** Disruptor ticker if publicly traded at time of event. */
    disruptorTicker: text("disruptor_ticker"),
    /** Incumbent companies primarily displaced. */
    incumbentCompanies: jsonb("incumbent_companies").$type<string[]>().notNull().default([]),
    /** Industries this event affected, by name. */
    industriesAffected: jsonb("industries_affected").$type<string[]>().notNull().default([]),
    /** capabilities table ids that this event displaced. Empty array until
     *  the mapping pass resolves names → ids (agent-discovered or manual). */
    displacedCapabilityIds: jsonb("displaced_capability_ids").$type<number[]>().notNull().default([]),
    /** capabilities table ids that this event created. Same caveat. */
    createdCapabilityIds: jsonb("created_capability_ids").$type<number[]>().notNull().default([]),
    /** Descriptive capability names — populated whether ids are resolved or not. */
    displacedCapabilityNames: jsonb("displaced_capability_names").$type<string[]>().notNull().default([]),
    createdCapabilityNames: jsonb("created_capability_names").$type<string[]>().notNull().default([]),
    /** Which playbook this event ran (FK by slug to disruption_patterns). */
    patternSlug: text("pattern_slug"),
    /** Severity tier: "moderate" (incumbent loses market share) | "severe"
     *  (incumbent enters bankruptcy / sells off divisions) | "extinction"
     *  (incumbent ceases operations). */
    severity: text("severity").notNull().default("moderate"),
    /** Markdown narrative: 1-2 paragraphs explaining what happened and why. */
    narrative: text("narrative").notNull(),
    /** Quantifiable evidence: "Blockbuster filed Chapter 11 in 2010 with $1.5B in debt." */
    evidence: jsonb("evidence").$type<Array<{ claim: string; source: string }>>().notNull().default([]),
    /** Source citations. */
    sources: jsonb("sources").$type<Array<{ url: string; title: string }>>().notNull().default([]),
    /** Where this row came from. */
    discoverySource: text("discovery_source").notNull().default("seed"), // "seed" | "agent" | "manual"
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("disruption_events_year_idx").on(table.eventYear),
    index("disruption_events_severity_idx").on(table.severity),
    index("disruption_events_pattern_idx").on(table.patternSlug),
    index("disruption_events_discovery_idx").on(table.discoverySource),
  ],
);

export type DisruptionEvent = typeof disruptionEventsTable.$inferSelect;
export type NewDisruptionEvent = typeof disruptionEventsTable.$inferInsert;

/**
 * Per-idea disruption analysis. Records what the analyzer concluded for a
 * given user idea: matched historical events, capabilities the idea would
 * displace / create, projected DVX impact, pattern match.
 *
 * Persisted so users can revisit their analyses + share results.
 */
export const ideaDisruptionAnalysesTable = pgTable(
  "idea_disruption_analyses",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** Optional FK to a business_case row if the idea came from an upload. */
    businessCaseId: integer("business_case_id"),
    title: text("title").notNull(),
    description: text("description").notNull(), // the user's idea text
    /** ids of matched historical events from disruption_events. */
    matchedEventIds: jsonb("matched_event_ids").$type<number[]>().notNull().default([]),
    /** Capability ids the idea would displace (from analysis). */
    wouldDisplaceCapabilityIds: jsonb("would_displace_capability_ids").$type<number[]>().notNull().default([]),
    /** Capability ids the idea would create (new — may not exist in DB yet). */
    wouldCreateCapabilityNames: jsonb("would_create_capability_names").$type<string[]>().notNull().default([]),
    /** Best-fit pattern slug. */
    patternMatchSlug: text("pattern_match_slug"),
    patternMatchConfidence: integer("pattern_match_confidence"), // 0-100
    /** Sum of displaced caps' current CVI scores — the value the idea is targeting. */
    targetCviValue: integer("target_cvi_value"),
    /** Markdown narrative of the analysis. */
    analysisBody: text("analysis_body").notNull(),
    /** One-line action verb header. */
    headline: text("headline"),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idea_analyses_user_idx").on(table.userId),
    index("idea_analyses_pattern_idx").on(table.patternMatchSlug),
  ],
);

export type IdeaDisruptionAnalysis = typeof ideaDisruptionAnalysesTable.$inferSelect;
