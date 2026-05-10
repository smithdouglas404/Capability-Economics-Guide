import { sql } from "drizzle-orm";
import { pgTable, serial, text, jsonb, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Per-user saved dashboard views. Each dashboard (CEI, Alpha, Knowledge Graph,
 * Companies) has its own namespace via `dashboardKey`. `stateJson` is opaque
 * to the server — the dashboard component owns the shape and is responsible
 * for tolerating older saved versions.
 *
 * Constraints:
 * - (userId, dashboardKey, name) is unique so renaming/saving doesn't quietly
 *   create duplicates.
 * - At most one default per (userId, dashboardKey) — enforced by a partial
 *   unique index on `is_default = true`.
 * - Hard cap of 10 views per (userId, dashboardKey) — enforced in route code.
 */
export const dashboardViewsTable = pgTable(
  "dashboard_views",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    dashboardKey: text("dashboard_key").notNull(),
    name: text("name").notNull(),
    stateJson: jsonb("state_json").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("dashboard_views_user_dash_idx").on(t.userId, t.dashboardKey),
    uniqueIndex("dashboard_views_unique_name_idx").on(t.userId, t.dashboardKey, t.name),
    // At most one default per (user, dashboard). Partial unique index over the
    // small subset of rows where is_default = true.
    uniqueIndex("dashboard_views_one_default_idx")
      .on(t.userId, t.dashboardKey)
      .where(sql`is_default = true`),
  ],
);

export type DashboardView = typeof dashboardViewsTable.$inferSelect;
export type NewDashboardView = typeof dashboardViewsTable.$inferInsert;
