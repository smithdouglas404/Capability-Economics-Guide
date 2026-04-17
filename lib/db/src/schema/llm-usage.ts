import { pgTable, serial, integer, text, timestamp, numeric, index } from "drizzle-orm/pg-core";

export const llmUsageTable = pgTable(
  "llm_usage",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    endpoint: text("endpoint").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    status: text("status").notNull().default("ok"),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    calledAt: timestamp("called_at").defaultNow().notNull(),
  },
  (t) => ({
    calledAtIdx: index("llm_usage_called_at_idx").on(t.calledAt),
    endpointIdx: index("llm_usage_endpoint_idx").on(t.endpoint),
  }),
);

export type LlmUsage = typeof llmUsageTable.$inferSelect;
export type InsertLlmUsage = typeof llmUsageTable.$inferInsert;
