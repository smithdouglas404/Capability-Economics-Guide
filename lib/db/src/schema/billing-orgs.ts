import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { membershipTiersTable } from "./membership";

/**
 * Multi-seat billing organizations. Distinct from the existing assessment-
 * session `organizations` table — these represent a billable team that pools
 * access under a single tier/invoice and can invite multiple users.
 *
 * A user can belong to multiple billing orgs simultaneously; requireTier
 * resolves the highest tier across their personal membership + all orgs they
 * belong to.
 */
export const billingOrganizationsTable = pgTable(
  "billing_organizations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    ownerUserId: text("owner_user_id").notNull(),
    ownerEmail: text("owner_email"),
    tierId: integer("tier_id").references(() => membershipTiersTable.id),
    status: text("status").notNull().default("active"), // "active" | "cancelled" | "past_due"
    seatLimit: integer("seat_limit").notNull().default(5),
    // Stripe subscription that covers this org's seats (nullable until billing is wired)
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    // Applied to invitees at acceptance time so they land in the org's preferred workspace.
    defaultPersonaSlug: text("default_persona_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("billing_orgs_owner_idx").on(table.ownerUserId),
  ],
);

export const billingOrgMembersTable = pgTable(
  "billing_org_members",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().references(() => billingOrganizationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    email: text("email"),
    role: text("role").notNull().default("member"), // "owner" | "admin" | "member"
    invitedBy: text("invited_by"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("billing_org_member_unique").on(table.orgId, table.userId),
    index("billing_org_members_user_idx").on(table.userId),
  ],
);

export const billingOrgInvitesTable = pgTable(
  "billing_org_invites",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id").notNull().references(() => billingOrganizationsTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    token: text("token").notNull().unique(),
    role: text("role").notNull().default("member"),
    invitedBy: text("invited_by").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedByUserId: text("accepted_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("billing_org_invites_org_idx").on(table.orgId),
    index("billing_org_invites_email_idx").on(table.email),
  ],
);

export type BillingOrganization = typeof billingOrganizationsTable.$inferSelect;
export type BillingOrgMember = typeof billingOrgMembersTable.$inferSelect;
export type BillingOrgInvite = typeof billingOrgInvitesTable.$inferSelect;
