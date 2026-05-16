import { pgTable, serial, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * SEC EDGAR filing cache, scoped per-capability. Each row represents one
 * filing × one capability mention — the same 10-K can appear in N rows if
 * it mentions N different capabilities. This denormalization is the cheap
 * path to "for capability X, what are filers saying?" lookups.
 *
 * Lazy ingestion model: rows are written when a user (or bot) views a
 * capability detail page and the on-demand extraction runs. Subsequent
 * views serve from this cache. The (future) incremental watcher subscribes
 * to EDGAR's new-filing RSS and appends rows for cached capabilities.
 *
 * Schema kept intentionally permissive — EDGAR's various endpoints return
 * subtly different shapes for 10-K vs 8-K vs DEF 14A and the structured
 * JSON evolves over time; we store the raw payload too so future analytics
 * can re-extract without re-fetching from SEC.
 */
export const capabilityFilingsTable = pgTable(
  "capability_filings",
  {
    id: serial("id").primaryKey(),
    capabilityId: integer("capability_id").notNull(),
    /** Filing accession number (e.g. "0000320193-25-000123") — SEC's primary key. */
    accessionNumber: text("accession_number").notNull(),
    /** Company filer info from EDGAR. */
    cik: text("cik").notNull(),
    companyName: text("company_name").notNull(),
    ticker: text("ticker"),
    /** Filing type: "10-K" | "10-Q" | "8-K" | "DEF 14A" | etc. */
    formType: text("form_type").notNull(),
    filingDate: timestamp("filing_date").notNull(),
    /** EDGAR URL to view the filing. */
    filingUrl: text("filing_url").notNull(),
    /** Free-text excerpt mentioning the capability (from EDGAR search highlight or LLM-extracted section). */
    excerpt: text("excerpt"),
    /** Item / section reference for excerpts ("1A Risk Factors" | "7 MD&A" | "8-K Item 4.02" | etc.). */
    sectionRef: text("section_ref"),
    /** Source of the excerpt: "edgar-search" (raw highlight) | "llm-extracted" (Haiku-tagged) | "manual" (admin curation). */
    extractionSource: text("extraction_source").notNull().default("edgar-search"),
    /** Raw EDGAR response payload for this hit, for downstream re-analysis without re-fetching. */
    rawPayload: jsonb("raw_payload"),
    /** Last time the on-demand fetcher confirmed this filing still matches the capability. Drives cache freshness. */
    lastConfirmedAt: timestamp("last_confirmed_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("capability_filings_cap_accession_unique").on(table.capabilityId, table.accessionNumber),
    index("capability_filings_cap_idx").on(table.capabilityId),
    index("capability_filings_filing_date_idx").on(table.filingDate),
    index("capability_filings_form_type_idx").on(table.formType),
  ],
);

/**
 * Per-capability extraction queue / status. One row per (capability) so the
 * on-demand extractor knows when each capability was last refreshed and
 * doesn't re-fetch on every page view. Drives the "viewed 10+ times → queue
 * deep historical backfill" usage signal (future).
 */
export const capabilityFilingStatusTable = pgTable(
  "capability_filing_status",
  {
    capabilityId: integer("capability_id").primaryKey(),
    /** Total times a user or bot viewed this capability — drives backfill triggers. */
    viewCount: integer("view_count").notNull().default(0),
    /** Wall-clock of the most recent successful on-demand extraction. */
    lastExtractedAt: timestamp("last_extracted_at"),
    /** Was a deep historical backfill queued/completed for this capability? */
    historicalBackfillStatus: text("historical_backfill_status").notNull().default("none"), // "none" | "queued" | "in_progress" | "complete" | "failed"
    /** Filing count cached for this capability — fast O(1) lookup for UI badges. */
    filingsCached: integer("filings_cached").notNull().default(0),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

export type CapabilityFiling = typeof capabilityFilingsTable.$inferSelect;
export type CapabilityFilingStatus = typeof capabilityFilingStatusTable.$inferSelect;
