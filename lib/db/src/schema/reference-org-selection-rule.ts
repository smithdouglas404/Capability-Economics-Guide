import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-row config table holding the criterion used to choose which
 * organizations populate the `organizations` table as "reference orgs"
 * (the anchors for peer benchmarks).
 *
 * Previously the reference set was a hardcoded 12-org array inside
 * `scripts/src/seed-organizations.ts`. That list was arbitrary, skewed
 * toward US large-cap public companies, and had no defensible criterion
 * a customer could audit.
 *
 * Now: the rule text below is the only thing that's hand-curated. A
 * Perplexity-driven populator (`scripts/src/seed-reference-orgs.ts`)
 * reads this rule, applies it per industry, and inserts orgs with
 * source URLs. The rule itself is the thing you defend; the list is
 * derived.
 *
 * Singleton row. Seeded by `scripts/src/seed-reference-org-rule.ts`
 * (idempotent). Editable later via admin UI without redeploy.
 */
export const referenceOrgSelectionRuleTable = pgTable("reference_org_selection_rule", {
  id: serial("id").primaryKey(),
  // The criterion itself. Surfaced to users on peer-benchmark views so
  // they can see exactly how the reference set is constructed.
  ruleText: text("rule_text").notNull(),
  // Bumped on every edit so downstream tooling can detect rule drift.
  ruleVersion: integer("rule_version").notNull().default(1),
  // Which Perplexity model the populator should use. `sonar` is sufficient
  // for this query shape; `sonar-pro` if you want richer reasoning on the
  // "largest private" tail.
  perplexityModel: text("perplexity_model").notNull().default("sonar"),
  // How often the populator should re-run against the rule. The scheduler
  // checks `lastAppliedAt + refreshIntervalDays` and skips if not due.
  refreshIntervalDays: integer("refresh_interval_days").notNull().default(90),
  // null until the populator has applied the rule at least once.
  lastAppliedAt: timestamp("last_applied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ReferenceOrgSelectionRule = typeof referenceOrgSelectionRuleTable.$inferSelect;
export type NewReferenceOrgSelectionRule = typeof referenceOrgSelectionRuleTable.$inferInsert;
