import { pgTable, serial, text, integer, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { capabilitiesTable } from "./capabilities";
import { sourceTriangulationsTable } from "./cei";

/**
 * Analyst annotations on a capability. Three kinds:
 *  - note:              free-form private/team note
 *  - dispute:           formal "I think this score is wrong" with reasoning
 *  - source_flag:       flags a specific source_triangulation row as outdated /
 *                       methodologically unsound (targetSourceTriangulationId set)
 *
 * Threading: parentAnnotationId points at the annotation being replied to,
 * giving us flat threads off a root note/dispute. Replies inherit the kind of
 * their root.
 *
 * Status: "open" → "resolved" (the issue was addressed; e.g. fresh source
 * landed, score recomputed) or "dismissed" (reviewer judged the dispute
 * unfounded). "open" stays the default.
 */
export const capabilityAnnotationsTable = pgTable(
  "capability_annotations",
  {
    id: serial("id").primaryKey(),
    capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    userEmail: text("user_email"),
    userDisplayName: text("user_display_name"),
    kind: text("kind").notNull().default("note"), // "note" | "dispute" | "source_flag"
    body: text("body").notNull(),
    targetSourceTriangulationId: integer("target_source_triangulation_id")
      .references(() => sourceTriangulationsTable.id, { onDelete: "set null" }),
    parentAnnotationId: integer("parent_annotation_id")
      .references((): AnyPgColumn => capabilityAnnotationsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"), // "open" | "resolved" | "dismissed"
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    resolutionNote: text("resolution_note"),
    // Soft-delete: deletedAt + deletedBy. We never hard-delete annotations
    // because they're part of the evidentiary record for a capability — but
    // authors / admins can hide them. Queries filter `deletedAt IS NULL`
    // unless explicitly asked to include them.
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("cap_annotations_capability_idx").on(table.capabilityId),
    index("cap_annotations_user_idx").on(table.userId),
    index("cap_annotations_status_idx").on(table.status),
    index("cap_annotations_kind_idx").on(table.kind),
    index("cap_annotations_parent_idx").on(table.parentAnnotationId),
  ],
);

export const insertCapabilityAnnotationSchema = createInsertSchema(capabilityAnnotationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedBy: true,
  resolvedAt: true,
  resolutionNote: true,
  deletedAt: true,
  deletedBy: true,
});
export type InsertCapabilityAnnotation = z.infer<typeof insertCapabilityAnnotationSchema>;
export type CapabilityAnnotation = typeof capabilityAnnotationsTable.$inferSelect;
