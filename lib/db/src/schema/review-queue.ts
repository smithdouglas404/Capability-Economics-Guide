/**
 * Review queue for content that used to be hardcoded seeds.
 *
 * Two-stage workflow:
 *   1. A proposer (seed script, agent discovery, admin UI form) writes a
 *      row into a *_proposed table with reviewStatus='pending', metadata
 *      about source, and a proposedBy identifier.
 *   2. An admin reviews via /admin/review-queue and either:
 *      - Approves → row gets promoted to the corresponding live table
 *        and reviewStatus moves to 'approved' with reviewedBy/reviewedAt.
 *      - Rejects → reviewStatus moves to 'rejected' with reviewerNotes.
 *      - Edits-then-approves → proposed row updated, then promoted.
 *
 * Why proposed-then-promoted instead of soft-delete on the live table:
 *   - Live tables stay clean — every row in `regulations` IS an approved
 *     authoritative entry. No filtering required on read paths.
 *   - Promotion is an explicit, auditable insert. The reviewer's identity
 *     and timestamp are captured at the moment of approval.
 *   - Re-runs of seed scripts populate proposals, never live rows. Stops
 *     the silent "deploy → seed overwrites curated content" pattern.
 *
 * Provenance columns on every proposed row:
 *   proposedBy       e.g., "seed:regulations", "agent:discovery",
 *                    "user:dsmith@example.com"
 *   sourceUrl        URL of the source citation, if any
 *   sourceCitation   freeform citation text — analyst report,
 *                    regulatory body name, framework reference
 *   verificationNotes  why the proposer thinks this is correct
 */

import { pgTable, serial, integer, text, real, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { regulationsTable } from "./innovation";
import { capabilitiesTable } from "./capabilities";

export const regulationsProposedTable = pgTable("regulations_proposed", {
  id: serial("id").primaryKey(),
  // Mirror of regulationsTable fields
  name: text("name").notNull(),
  shortCode: text("short_code").notNull(),
  description: text("description"),
  jurisdiction: text("jurisdiction").notNull().default("global"),
  effectiveDate: timestamp("effective_date"),
  industries: jsonb("industries").$type<number[]>().notNull().default([]),
  // Proposal metadata
  proposedBy: text("proposed_by").notNull(),
  proposedAt: timestamp("proposed_at").defaultNow().notNull(),
  sourceUrl: text("source_url"),
  sourceCitation: text("source_citation"),
  verificationNotes: text("verification_notes"),
  // Review state machine
  reviewStatus: text("review_status").notNull().default("pending"), // pending | approved | rejected | needs-edit
  reviewerNotes: text("reviewer_notes"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  // Link back when approved + promoted
  promotedToLiveId: integer("promoted_to_live_id").references(() => regulationsTable.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("reg_proposed_shortcode_idx").on(table.shortCode, table.proposedBy),
]);

export const regulationRequirementsProposedTable = pgTable("regulation_requirements_proposed", {
  id: serial("id").primaryKey(),
  // The regulation this requirement targets — references the LIVE regulations
  // table because requirement proposals only make sense against an existing reg.
  // (New-regulation proposals go through the regulations queue first.)
  regulationId: integer("regulation_id").notNull().references(() => regulationsTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  requiredMaturity: real("required_maturity").notNull(),
  priority: text("priority").notNull().default("required"),
  evidenceNotes: text("evidence_notes"),
  article: text("article"),
  // Proposal metadata
  proposedBy: text("proposed_by").notNull(),
  proposedAt: timestamp("proposed_at").defaultNow().notNull(),
  sourceUrl: text("source_url"),
  sourceCitation: text("source_citation"),
  verificationNotes: text("verification_notes"),
  // Review state machine
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewerNotes: text("reviewer_notes"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
}, (table) => [
  uniqueIndex("reg_req_proposed_unique_idx").on(table.regulationId, table.capabilityId, table.proposedBy),
]);

export type RegulationProposed = typeof regulationsProposedTable.$inferSelect;
export type NewRegulationProposed = typeof regulationsProposedTable.$inferInsert;
export type RegulationRequirementProposed = typeof regulationRequirementsProposedTable.$inferSelect;
export type NewRegulationRequirementProposed = typeof regulationRequirementsProposedTable.$inferInsert;
