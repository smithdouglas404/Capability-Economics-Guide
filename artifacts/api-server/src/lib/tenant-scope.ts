/**
 * Tenant-scope helpers — the *only* sanctioned way to read or mutate a row
 * on a tenant-scoped table.
 *
 * Why: a single missed `WHERE org_id = ?` filter on a tenant-scoped table
 * is a cross-tenant data leak. Routes used to spell out the where clause
 * inline; that left footguns like `db.delete(simulationScenariosTable)
 * .where(eq(simulationScenariosTable.id, req.params.id))` — accept any
 * tenant's id, delete it. These helpers force the filter at the type level.
 *
 * Two flavours of tenancy live in the schema right now:
 *   1. Anonymous *session* orgs (the public sandbox / assessment tool):
 *      tables carry a nullable `organizationId` plus a `sessionToken`
 *      column. The session token is the credential.
 *   2. Clerk-backed billing orgs (B2B SaaS): tables carry `orgId` and
 *      membership is enforced via `requireOrgRole` against
 *      `billing_org_members`.
 *
 * Helpers below cover (1) — that is where the bugs were. (2) already goes
 * through `requireOrgRole` and audited routes pass the orgId explicitly.
 */

import { db } from "@workspace/db";
import {
  simulationScenariosTable,
  innovationProjectsTable,
  roiRecordsTable,
  warRoomSessionsTable,
  watchlistsTable,
  benchmarkSessionsTable,
  strategyCommentsTable,
  strategyDecisionsTable,
  organizationsTable,
} from "@workspace/db";
import { and, eq, type SQL } from "drizzle-orm";

/**
 * Closed registry of tables scoped by anonymous session token. Adding a new
 * tenant table to this map is required before the helpers will accept it —
 * forces a deliberate decision instead of "looks tenant-scoped, must be
 * fine".
 */
export const SESSION_SCOPED = {
  simulation_scenarios: { table: simulationScenariosTable, column: simulationScenariosTable.sessionToken },
  innovation_projects:  { table: innovationProjectsTable,  column: innovationProjectsTable.sessionToken },
  roi_records:          { table: roiRecordsTable,          column: roiRecordsTable.sessionToken },
  war_room_sessions:    { table: warRoomSessionsTable,     column: warRoomSessionsTable.sessionToken },
  watchlists:           { table: watchlistsTable,          column: watchlistsTable.sessionToken },
  benchmark_sessions:   { table: benchmarkSessionsTable,   column: benchmarkSessionsTable.sessionToken },
  strategy_comments:    { table: strategyCommentsTable,    column: strategyCommentsTable.sessionToken },
  strategy_decisions:   { table: strategyDecisionsTable,   column: strategyDecisionsTable.sessionToken },
} as const;

export type SessionScopedKey = keyof typeof SESSION_SCOPED;

/**
 * Returns a Drizzle WHERE expression that filters `key`'s table down to the
 * rows owned by `sessionToken`. Combine with extra filters via `and()`.
 *
 * Example:
 *   const rows = await db.select().from(simulationScenariosTable)
 *     .where(forSession("simulation_scenarios", token));
 */
export function forSession(key: SessionScopedKey, sessionToken: string): SQL {
  const spec = SESSION_SCOPED[key];
  return eq(spec.column, sessionToken);
}

/**
 * Returns a WHERE that matches a single row by id AND tenant. Use this for
 * GET /:id, PATCH /:id, DELETE /:id endpoints. Refusing to provide a
 * helper that filters by id alone is intentional.
 */
export function forSessionRow(
  key: SessionScopedKey,
  sessionToken: string,
  id: number,
): SQL {
  const spec = SESSION_SCOPED[key];
  // Every registered table has a numeric `id` primary key.
  const idCol = (spec.table as unknown as { id: { name: string } & SQL }).id as unknown as SQL;
  return and(eq(idCol, id), eq(spec.column, sessionToken)) as SQL;
}

/**
 * Compose a tenant filter with caller-supplied additional predicates. This
 * is the recommended primitive for any query that already has a non-tenant
 * WHERE clause (e.g. filtering comments by `targetType` AND `targetId`):
 *
 *   .where(withOrgScope("strategy_comments", token,
 *     and(eq(strategyCommentsTable.targetType, t),
 *         eq(strategyCommentsTable.targetId, i))))
 *
 * Centralising it makes it impossible to forget the tenant predicate when
 * adding a new filter.
 */
export function withOrgScope(
  key: SessionScopedKey,
  sessionToken: string,
  extra?: SQL | undefined,
): SQL {
  const base = forSession(key, sessionToken);
  return extra ? (and(base, extra) as SQL) : base;
}

/**
 * Resolve sessionToken from a request — accepts query string, body, or
 * `X-Session-Token` header (in that order). Returns null when missing.
 *
 * Centralised so every route reads it the same way; if we later move the
 * token to a cookie, only this function changes.
 */
export function resolveSessionToken(req: {
  query: Record<string, unknown>;
  body?: Record<string, unknown> | null;
  headers: Record<string, unknown>;
}): string | null {
  const q = req.query?.sessionToken;
  if (typeof q === "string" && q.length > 0) return q;
  const b = req.body?.sessionToken;
  if (typeof b === "string" && b.length > 0) return b;
  const h = req.headers["x-session-token"];
  if (typeof h === "string" && h.length > 0) return h;
  return null;
}

/**
 * Verify a session token resolves to a real org (and optionally that
 * `expectedOrgId` matches). Returns the org row or null. Use before any
 * mutation that creates rows on behalf of a session.
 */
export async function resolveSessionOrg(sessionToken: string): Promise<{ id: number; name: string } | null> {
  const [org] = await db.select({ id: organizationsTable.id, name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.sessionToken, sessionToken));
  return org ?? null;
}
