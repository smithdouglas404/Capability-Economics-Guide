import { pgTable, text, serial, integer, timestamp, real, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { capabilitiesTable } from "./capabilities";

/**
 * A named product or SKU offered by a company. Products sit between
 * companies and capabilities so a capability shift can be traced to
 * specific product moves (launches, EOLs, repositioning).
 *
 * Out of scope for v1: pricing, customer/usage data.
 */
export const companyProductsTable = pgTable("company_products", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category"),
  launchDate: text("launch_date"),
  status: text("status", { enum: ["active", "preview", "deprecated", "discontinued"] }).notNull().default("active"),
  websiteUrl: text("website_url"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uqSlug: uniqueIndex("company_products_company_slug_idx").on(t.companyId, t.slug),
  companyIdx: index("company_products_company_idx").on(t.companyId),
}));

/**
 * Many-to-many between products and capabilities. Weight is the share
 * of the product's effort/value attributable to that capability and
 * should sum to roughly 1.0 across a product's mappings (not enforced).
 */
export const productCapabilitiesTable = pgTable("product_capabilities", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => companyProductsTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  weight: real("weight").notNull().default(1.0),
  evidenceNote: text("evidence_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uqPair: uniqueIndex("product_capabilities_pair_idx").on(t.productId, t.capabilityId),
  capIdx: index("product_capabilities_capability_idx").on(t.capabilityId),
}));

export const insertCompanyProductSchema = createInsertSchema(companyProductsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyProduct = z.infer<typeof insertCompanyProductSchema>;
export type CompanyProduct = typeof companyProductsTable.$inferSelect;

export const insertProductCapabilitySchema = createInsertSchema(productCapabilitiesTable).omit({ id: true, createdAt: true });
export type InsertProductCapability = z.infer<typeof insertProductCapabilitySchema>;
export type ProductCapability = typeof productCapabilitiesTable.$inferSelect;
