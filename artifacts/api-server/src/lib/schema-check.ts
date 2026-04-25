import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Tables the application MUST have to function correctly. If any of these are
 * missing, features depending on them silently degrade (the historical bug
 * was `enrichment_config` missing → auto-enrich tick threw → caught silently
 * → no enrichment ever ran). The boot check turns that silent failure into
 * a loud one.
 */
const REQUIRED_TABLES = [
  "industries",
  "capabilities",
  "capability_economics",
  "capability_dependencies",
  "enrichment_runs",
  "enrichment_config",
  "enrichment_industry_overrides",
  "enrichment_jobs",
  "membership_tiers",
  "user_memberships",
  "credit_accounts",
  "credit_transactions",
] as const;

export interface SchemaStatus {
  ok: boolean;
  checkedAt: string;
  required: string[];
  present: string[];
  missing: string[];
}

let cached: SchemaStatus | null = null;

export async function verifySchema(): Promise<SchemaStatus> {
  const r = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const rows = (r as unknown as { rows?: { table_name: string }[] }).rows ?? (r as unknown as { table_name: string }[]);
  const present = new Set<string>();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (row && typeof row === "object" && "table_name" in row) present.add(String(row.table_name));
  }
  const missing = REQUIRED_TABLES.filter(t => !present.has(t));
  const status: SchemaStatus = {
    ok: missing.length === 0,
    checkedAt: new Date().toISOString(),
    required: [...REQUIRED_TABLES],
    present: [...REQUIRED_TABLES].filter(t => present.has(t)),
    missing,
  };
  cached = status;
  if (missing.length > 0) {
    logger.error({ missing }, "[schema] REQUIRED TABLES MISSING — features will silently degrade. Run `cd lib/db && npx drizzle-kit push --force`.");
  } else {
    logger.info({ checked: REQUIRED_TABLES.length }, "[schema] all required tables present");
  }
  return status;
}

export function getCachedSchemaStatus(): SchemaStatus | null {
  return cached;
}
