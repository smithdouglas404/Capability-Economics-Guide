import { pgTable, text, serial, integer, timestamp, real, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { industriesTable } from "./industries";
import { capabilitiesTable } from "./capabilities";

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  size: text("size").notNull().default("mid"),
  // Coarse-grained region for peer-cohort grouping. Optional — when unset the
  // org falls into a "global" bucket and only matches against industry+size.
  // Values: na | emea | apac | latam | global | other
  geography: text("geography"),
  // Revenue band — coarser than `size` (which is employee count): "lt_10m" |
  // "10m_100m" | "100m_1b" | "1b_10b" | "gt_10b". Used as a cohort dimension
  // in peer benchmarking when present.
  revenueBand: text("revenue_band"),
  // Flag indicating the org has opted in to peer benchmarking. Default false —
  // contributions are never used without an explicit opt-in.
  peerOptIn: boolean("peer_opt_in").notNull().default(false),
  // Clerk identity linkage. Both nullable: an org row may exist with
  // sessionToken-only ownership (the legacy public assess flow). When a
  // signed-in user "claims" an org, clerkUserId is set. When an admin
  // promotes a personal org to team-shared, clerkOrgId is set. Read access
  // for any org-scoped feature gates on (clerkUserId = me) OR
  // (clerkOrgId IN myClerkOrgs); legacy sessionToken-only orgs remain
  // accessible to whoever holds the token.
  clerkUserId: text("clerk_user_id"),
  clerkOrgId: text("clerk_org_id"),
  sessionToken: text("session_token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("organizations_clerk_user_idx").on(table.clerkUserId),
  index("organizations_clerk_org_idx").on(table.clerkOrgId),
]);

export const organizationCapabilitiesTable = pgTable("organization_capabilities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  maturityScore: real("maturity_score").notNull(),
  investmentLevel: text("investment_level").notNull().default("moderate"),
  strategicImportance: text("strategic_importance").notNull().default("medium"),
  notes: text("notes"),
  assessedAt: timestamp("assessed_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("org_cap_unique_idx").on(table.organizationId, table.capabilityId),
]);

export const insertOrganizationSchema = createInsertSchema(organizationsTable).omit({ id: true, createdAt: true, updatedAt: true, sessionToken: true });
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;

export const insertOrganizationCapabilitySchema = createInsertSchema(organizationCapabilitiesTable).omit({ id: true, assessedAt: true });
export type InsertOrganizationCapability = z.infer<typeof insertOrganizationCapabilitySchema>;
export type OrganizationCapability = typeof organizationCapabilitiesTable.$inferSelect;
