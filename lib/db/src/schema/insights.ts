import { pgTable, serial, integer, text, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";
import { industriesTable } from "./industries";

export const capabilityThresholdsTable = pgTable("capability_thresholds", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id),
  greenMin: integer("green_min").notNull().default(70),
  yellowMin: integer("yellow_min").notNull().default(40),
  redMax: integer("red_max").notNull().default(39),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const capabilityInsightsTable = pgTable("capability_insights", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").references(() => capabilitiesTable.id),
  industryId: integer("industry_id").references(() => industriesTable.id),
  insightType: varchar("insight_type", { length: 50 }).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default("info"),
  recommendation: text("recommendation"),
  metadata: jsonb("metadata"),
  generatedAt: timestamp("generated_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export const industryWhitePapersTable = pgTable("industry_white_papers", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").references(() => industriesTable.id),
  title: text("title").notNull(),
  author: text("author").notNull(),
  organization: text("organization").notNull(),
  abstract: text("abstract").notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  url: text("url"),
  publishedYear: integer("published_year").notNull(),
  relevanceScore: integer("relevance_score").notNull().default(80),
  tags: text("tags"),
});

export const industryLeaderboardTable = pgTable("industry_leaderboard", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id),
  companyName: text("company_name").notNull(),
  overallMaturity: integer("overall_maturity").notNull(),
  topCapability: text("top_capability").notNull(),
  topCapabilityScore: integer("top_capability_score").notNull(),
  weakestCapability: text("weakest_capability").notNull(),
  weakestCapabilityScore: integer("weakest_capability_score").notNull(),
  investmentLevel: varchar("investment_level", { length: 20 }).notNull(),
  trend: varchar("trend", { length: 20 }).notNull().default("stable"),
  rank: integer("rank").notNull(),
});
