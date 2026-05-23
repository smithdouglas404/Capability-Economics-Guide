import { pgTable, serial, integer, text, real, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { regulationsTable } from "./innovation";

/**
 * Forward-looking enforcement-intensity forecast per regulation.
 *
 * Refreshed weekly by the regulation-enforcement-forecaster service. For each
 * live regulation we ask Perplexity whether enforcement of {shortCode} has
 * been getting stricter, steady, or softer over the last ~12 months, with
 * citations. The result powers the chip rendered next to compliance % on
 * /regulations.
 *
 * Reads pick the most-recent row per regulationId whose validUntil is still
 * in the future. Old forecasts are kept as an audit trail (no upsert).
 */
export const regulationEnforcementForecastsTable = pgTable(
  "regulation_enforcement_forecasts",
  {
    id: serial("id").primaryKey(),
    regulationId: integer("regulation_id")
      .notNull()
      .references(() => regulationsTable.id, { onDelete: "cascade" }),
    forecastedAt: timestamp("forecasted_at").defaultNow().notNull(),
    /** "stricter" | "steady" | "softer" — Perplexity-classified direction. */
    direction: text("direction").notNull(),
    /** 0..1 confidence reported by the model. */
    confidence: real("confidence").notNull(),
    /** Two-sentence rationale shown in the tooltip. */
    summary: text("summary").notNull(),
    /** Array of source URLs the model leaned on. */
    sourceCitations: jsonb("source_citations").$type<string[]>().notNull().default([]),
    /** After this timestamp the forecast is considered stale; the next weekly run will replace it. */
    validUntil: timestamp("valid_until").notNull(),
  },
  (t) => [
    index("regulation_enforcement_forecasts_reg_idx").on(t.regulationId),
    index("regulation_enforcement_forecasts_valid_idx").on(t.regulationId, t.validUntil),
  ],
);

export type RegulationEnforcementForecast = typeof regulationEnforcementForecastsTable.$inferSelect;
export type RegulationEnforcementForecastDirection = "stricter" | "steady" | "softer";
