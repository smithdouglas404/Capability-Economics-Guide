import { pgTable, serial, integer, text, real, timestamp, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";
import { industriesTable } from "./industries";
import { organizationsTable } from "./organizations";

// ── Feature 1: Simulation / What-If Scenario Engine ──

export const simulationScenariosTable = pgTable("simulation_scenarios", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  sessionToken: text("session_token"),
  name: text("name").notNull(),
  description: text("description"),
  baselineCvi: real("baseline_cei"),
  projectedCvi: real("projected_cei"),
  investments: jsonb("investments").$type<Array<{
    capabilityId: number;
    capabilityName: string;
    investmentUsdMm: number;
    targetMaturityDelta: number;
    timelineMonths: number;
  }>>().notNull().default([]),
  results: jsonb("results").$type<{
    cviDelta: number;
    moatChanges: Array<{ capabilityId: number; name: string; before: number; after: number }>;
    fragilitChanges: Array<{ capabilityId: number; name: string; before: number; after: number }>;
    evarReduction: Array<{ capabilityId: number; name: string; before12mo: number; after12mo: number }>;
    cascadeEffects: Array<{ fromId: number; fromName: string; toId: number; toName: string; impactDelta: number }>;
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Feature 2: Competitive War Room (uses existing orgs + companies, no new tables needed for MVP) ──

export const warRoomSessionsTable = pgTable("war_room_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull(),
  name: text("name").notNull(),
  industryId: integer("industry_id").references(() => industriesTable.id),
  myOrgId: integer("my_org_id").references(() => organizationsTable.id),
  competitorCompanyIds: jsonb("competitor_company_ids").$type<number[]>().notNull().default([]),
  alerts: jsonb("alerts").$type<Array<{
    id: string;
    type: "moat_gap" | "evar_shift" | "ai_exposure" | "score_move";
    message: string;
    severity: "info" | "warning" | "critical";
    capabilityId: number;
    detectedAt: string;
  }>>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Feature 3: Trade Signals ──

export const tradeSignalsTable = pgTable("trade_signals", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  signal: text("signal").notNull(), // "long" | "short" | "hold"
  strength: real("strength").notNull(), // 0-100
  ceQuadrant: text("ce_quadrant"),
  streetQuadrant: text("street_quadrant"),
  spreadPct: real("spread_pct"),
  rationale: text("rationale"),
  entryDate: timestamp("entry_date").defaultNow().notNull(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedDate: timestamp("resolved_date"),
  outcome: text("outcome"), // "hit" | "miss" | "pending"
  returnPct: real("return_pct"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Feature 4: Innovation Pipeline Tracker ──

export const innovationProjectsTable = pgTable("innovation_projects", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  sessionToken: text("session_token"),
  name: text("name").notNull(),
  description: text("description"),
  stage: text("stage").notNull().default("ideation"), // ideation | pilot | scale | mature | killed
  industryId: integer("industry_id").references(() => industriesTable.id),
  targetCapabilities: jsonb("target_capabilities").$type<Array<{
    capabilityId: number;
    capabilityName: string;
    projectedUplift: number;
    actualUplift: number | null;
  }>>().notNull().default([]),
  investmentUsdK: real("investment_usd_k"),
  projectedRoiPct: real("projected_roi_pct"),
  actualRoiPct: real("actual_roi_pct"),
  stageHistory: jsonb("stage_history").$type<Array<{
    stage: string;
    enteredAt: string;
    decision: string;
    notes: string;
  }>>().notNull().default([]),
  owner: text("owner"),
  startDate: timestamp("start_date"),
  targetDate: timestamp("target_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Feature 5: Capability Decay Early Warning / Watchlists ──

export const watchlistsTable = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull(),
  name: text("name").notNull().default("My Watchlist"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const watchlistItemsTable = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  watchlistId: integer("watchlist_id").notNull().references(() => watchlistsTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  thresholdType: text("threshold_type").notNull(), // "half_life_below" | "fragility_above" | "moat_below" | "evar_above" | "score_below"
  thresholdValue: real("threshold_value").notNull(),
  currentValue: real("current_value"),
  triggered: boolean("triggered").notNull().default(false),
  triggeredAt: timestamp("triggered_at"),
  notificationChannel: text("notification_channel").notNull().default("in_app"), // "in_app" | "email" | "webhook"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const watchlistAlertsTable = pgTable("watchlist_alerts", {
  id: serial("id").primaryKey(),
  watchlistItemId: integer("watchlist_item_id").notNull().references(() => watchlistItemsTable.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  previousValue: real("previous_value"),
  currentValue: real("current_value"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Feature 6: Competitive Benchmarking Sessions ──

export const benchmarkSessionsTable = pgTable("benchmark_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token"),
  name: text("name").notNull(),
  industryId: integer("industry_id").references(() => industriesTable.id),
  region: text("region"),
  ownership: text("ownership"),
  selectedCapabilityIds: jsonb("selected_capability_ids").$type<number[]>().notNull().default([]),
  selectedCompanyIds: jsonb("selected_company_ids").$type<number[]>().notNull().default([]),
  discoveredCompanyIds: jsonb("discovered_company_ids").$type<number[]>().notNull().default([]),
  status: text("status").notNull().default("completed"), // "searching" | "completed"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Feature 7: ROI Attribution ──

export const roiRecordsTable = pgTable("roi_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
  sessionToken: text("session_token"),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  quarter: text("quarter").notNull(), // "2026-Q1"
  spendUsdK: real("spend_usd_k"),
  revenueImpactUsdK: real("revenue_impact_usd_k"),
  efficiencyGainPct: real("efficiency_gain_pct"),
  maturityBefore: real("maturity_before"),
  maturityAfter: real("maturity_after"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Feature 8: NL Query (conversation-based, uses existing conversations table — no new schema needed for MVP) ──

export const nlQueryLogsTable = pgTable("nl_query_logs", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token"),
  query: text("query").notNull(),
  response: text("response").notNull(),
  sqlGenerated: text("sql_generated"),
  dataReturned: jsonb("data_returned"),
  modelUsed: text("model_used"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Feature 9: Regulatory / Compliance Mapping ──

export const regulationsTable = pgTable("regulations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull(), // "DORA", "GDPR", "SOX"
  description: text("description"),
  jurisdiction: text("jurisdiction").notNull().default("global"),
  effectiveDate: timestamp("effective_date"),
  industries: jsonb("industries").$type<number[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const regulationCapabilityRequirementsTable = pgTable("regulation_capability_requirements", {
  id: serial("id").primaryKey(),
  regulationId: integer("regulation_id").notNull().references(() => regulationsTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  requiredMaturity: real("required_maturity").notNull(), // minimum score needed
  priority: text("priority").notNull().default("required"), // "required" | "recommended" | "optional"
  evidenceNotes: text("evidence_notes"),
  article: text("article"), // "Article 5.2"
}, (table) => [
  uniqueIndex("reg_cap_unique_idx").on(table.regulationId, table.capabilityId),
]);

// ── Feature 10: Collaborative Strategy Workspace ──

export const strategyCommentsTable = pgTable("strategy_comments", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull(), // "capability" | "assessment" | "cei" | "scenario"
  targetId: integer("target_id").notNull(),
  authorRole: text("author_role").notNull(), // "CEO" | "CFO" | "CTO" | etc.
  authorName: text("author_name").notNull(),
  sessionToken: text("session_token"),
  body: text("body").notNull(),
  parentCommentId: integer("parent_comment_id"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const strategyDecisionsTable = pgTable("strategy_decisions", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  sessionToken: text("session_token"),
  decision: text("decision").notNull(), // "invest" | "hold" | "divest" | "pivot" | "kill"
  rationale: text("rationale").notNull(),
  decidedBy: text("decided_by").notNull(),
  decidedByRole: text("decided_by_role").notNull(),
  investmentUsdK: real("investment_usd_k"),
  timelineMonths: integer("timeline_months"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
