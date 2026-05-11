import { pgTable, serial, text, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * Design-thinking pattern stories — Uber-style exemplars showing how a NEW
 * capability was invented by cross-pollinating existing ones to displace
 * incumbents.
 *
 * Distinct from `case_studies` (which is a heavily-structured analyst report
 * with KPIs / 5-year-outlook). Patterns are narrative: a tight headline,
 * a longer body, plus structured "what to learn" fields the UI can pull out
 * for the design-thinking workbench (B1) to surface as priming examples.
 *
 * Authored by admins. Public read.
 */
export const disruptionPatternsTable = pgTable(
  "disruption_patterns",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),                // "Uber: Inventing the ride-hailing platform"
    headline: text("headline").notNull(),          // one-line hook for the index
    disruptorCompany: text("disruptor_company").notNull(),
    incumbentsDisplaced: jsonb("incumbents_displaced").$type<string[]>().notNull().default([]),
    industriesAffected: jsonb("industries_affected").$type<string[]>().notNull().default([]),
    existingCapabilitiesUsed: jsonb("existing_capabilities_used").$type<string[]>().notNull().default([]),
    newCapabilityCreated: text("new_capability_created").notNull(),
    crossIndustryAnalogues: jsonb("cross_industry_analogues").$type<string[]>().notNull().default([]),
    narrative: text("narrative").notNull(),        // markdown body
    whatToLookFor: jsonb("what_to_look_for").$type<string[]>().notNull().default([]),
    sources: jsonb("sources").$type<Array<{ url: string; title: string }>>().notNull().default([]),
    coverImageUrl: text("cover_image_url"),
    featured: boolean("featured").notNull().default(false),
    publishedAt: timestamp("published_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("disruption_patterns_featured_idx").on(table.featured),
  ],
);

export type DisruptionPattern = typeof disruptionPatternsTable.$inferSelect;
export type NewDisruptionPattern = typeof disruptionPatternsTable.$inferInsert;
