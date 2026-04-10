import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { capabilitiesTable } from "./capabilities";

export const cSuiteRolesTable = pgTable("c_suite_roles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  name: text("name").notNull(),
  focus: text("focus").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
});

export const capabilityRoleMappingsTable = pgTable("capability_role_mappings", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  roleId: integer("role_id").notNull().references(() => cSuiteRolesTable.id, { onDelete: "cascade" }),
  relevance: text("relevance").notNull().default("medium"),
  perspective: text("perspective").notNull(),
});

export const insertCSuiteRoleSchema = createInsertSchema(cSuiteRolesTable).omit({ id: true });
export type InsertCSuiteRole = z.infer<typeof insertCSuiteRoleSchema>;
export type CSuiteRole = typeof cSuiteRolesTable.$inferSelect;

export const insertCapabilityRoleMappingSchema = createInsertSchema(capabilityRoleMappingsTable).omit({ id: true });
export type InsertCapabilityRoleMapping = z.infer<typeof insertCapabilityRoleMappingSchema>;
export type CapabilityRoleMapping = typeof capabilityRoleMappingsTable.$inferSelect;
