/**
 * Org access gating.
 *
 * Three ownership models coexist on the organizations table:
 *  1. Session-token only — legacy public assess flow. Anyone with the token
 *     reads/writes. No identity attached.
 *  2. Personal (clerkUserId set) — claimed by a signed-in user. Read/write
 *     by that user; admins may impersonate.
 *  3. Team-shared (clerkOrgId set, optionally with clerkUserId as owner) —
 *     readable/writable by every member of the Clerk org. The original
 *     claimant can demote back to personal.
 *
 * Helpers below answer: "can THIS Clerk user access THIS organization row?"
 * Used by every Part-B ideation surface (workbench boards, etc.) and any
 * future org-scoped feature.
 */
import { getAuth } from "@clerk/express";
import { clerkClient } from "@clerk/express";
import type { Request } from "express";
import { db, organizationsTable } from "@workspace/db";
import { eq, and, or, inArray, sql } from "drizzle-orm";

export type AccessMode = "denied" | "session_token" | "owner" | "team_member" | "admin";

export interface OrgAccessResult {
  organizationId: number;
  mode: AccessMode;
  /** True only when mode !== "denied". */
  canRead: boolean;
  /** Writes are allowed for owner/team_member/admin/session_token-with-token-present. */
  canWrite: boolean;
}

/** Resolve the requesting Clerk user's org memberships. Cached on the request
 *  via a WeakMap-like attach to avoid a Clerk roundtrip per call. */
const memCache = new WeakMap<Request, Promise<string[]>>();
export function getUserClerkOrgIds(req: Request): Promise<string[]> {
  const cached = memCache.get(req);
  if (cached) return cached;
  const promise = (async () => {
    const auth = getAuth(req);
    if (!auth?.userId) return [];
    try {
      const memberships = await clerkClient.users.getOrganizationMembershipList({ userId: auth.userId });
      const data = (memberships as unknown as { data?: Array<{ organization?: { id?: string } }> }).data
        ?? (memberships as unknown as Array<{ organization?: { id?: string } }>);
      const orgIds: string[] = [];
      for (const m of data ?? []) {
        const id = m?.organization?.id;
        if (id) orgIds.push(id);
      }
      return orgIds;
    } catch {
      return [];
    }
  })();
  memCache.set(req, promise);
  return promise;
}

/** Decide access for one org row given an authenticated Clerk user and any
 *  caller-supplied session token. */
export async function checkOrgAccess(args: {
  req: Request;
  organizationId: number;
  /** When the caller is the legacy public flow, they may present the session token. */
  sessionToken?: string | null;
}): Promise<OrgAccessResult> {
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, args.organizationId));
  if (!org) {
    return { organizationId: args.organizationId, mode: "denied", canRead: false, canWrite: false };
  }
  // Session-token short-circuit: legacy flow, no identity required.
  if (args.sessionToken && args.sessionToken === org.sessionToken) {
    return { organizationId: org.id, mode: "session_token", canRead: true, canWrite: true };
  }

  const auth = getAuth(args.req);
  if (!auth?.userId) {
    return { organizationId: org.id, mode: "denied", canRead: false, canWrite: false };
  }

  // Owner check.
  if (org.clerkUserId && org.clerkUserId === auth.userId) {
    return { organizationId: org.id, mode: "owner", canRead: true, canWrite: true };
  }

  // Team-shared check.
  if (org.clerkOrgId) {
    const myOrgIds = await getUserClerkOrgIds(args.req);
    if (myOrgIds.includes(org.clerkOrgId)) {
      return { organizationId: org.id, mode: "team_member", canRead: true, canWrite: true };
    }
  }

  return { organizationId: org.id, mode: "denied", canRead: false, canWrite: false };
}

/** List all org ids the requesting user can read — for index endpoints. */
export async function listAccessibleOrgIds(req: Request): Promise<number[]> {
  const auth = getAuth(req);
  if (!auth?.userId) return [];
  const myOrgIds = await getUserClerkOrgIds(req);

  const rows = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(or(
      eq(organizationsTable.clerkUserId, auth.userId),
      myOrgIds.length > 0
        ? inArray(organizationsTable.clerkOrgId, myOrgIds)
        : sql`FALSE`,
    ));
  return rows.map(r => r.id);
}

/** Convenience: build a Drizzle filter that returns only org rows the
 *  current request can read. Pass directly to `.where(...)`. Returns
 *  `sql\`FALSE\`` when the caller has no access. */
export async function accessibleOrgFilter(req: Request) {
  const auth = getAuth(req);
  if (!auth?.userId) return sql`FALSE`;
  const myOrgIds = await getUserClerkOrgIds(req);
  return or(
    eq(organizationsTable.clerkUserId, auth.userId),
    myOrgIds.length > 0 ? inArray(organizationsTable.clerkOrgId, myOrgIds) : sql`FALSE`,
  );
}

// silence unused-import linter
void and;
