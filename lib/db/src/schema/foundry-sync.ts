import { pgTable, serial, integer, text, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Hourly Foundry sync outcome log.
 *
 * Each call to runFoundrySyncOnce inserts a row here with the classified
 * outcome so the admin dashboard can show last-status / last-success / run
 * history, and so the consecutive-401 alerter has a durable signal to read
 * across restarts.
 *
 * status:
 *   - "ok"        — sync completed end-to-end
 *   - "http_401"  — Foundry rejected the bearer token (rotate it)
 *   - "http_5xx"  — Foundry returned a 5xx (transient, retried next tick)
 *   - "network"   — fetch threw before getting a response (DNS/timeout/TLS)
 *   - "other"     — anything else (e.g. malformed CSV, DB read error)
 */
export const foundrySyncLogTable = pgTable(
  "foundry_sync_log",
  {
    id: serial("id").primaryKey(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    status: varchar("status", { length: 16 }).notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    rowsByDataset: jsonb("rows_by_dataset").$type<Record<string, number>>(),
    errorMessage: text("error_message"),
    reason: text("reason"),
  },
  (t) => [
    index("foundry_sync_log_started_idx").on(t.startedAt),
    index("foundry_sync_log_status_idx").on(t.status),
  ],
);

export type FoundrySyncLog = typeof foundrySyncLogTable.$inferSelect;
export type InsertFoundrySyncLog = typeof foundrySyncLogTable.$inferInsert;
