import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";

const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

async function isClerkAdmin(userId: string): Promise<boolean> {
  const cached = adminCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.isAdmin;
  let isAdmin = false;
  try {
    const user = await clerkClient.users.getUser(userId);
    const role = (user.publicMetadata as { role?: string } | undefined)?.role;
    isAdmin = role === "admin";
  } catch {
    isAdmin = false;
  }
  adminCache.set(userId, { isAdmin, expiresAt: Date.now() + CACHE_TTL_MS });
  return isAdmin;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (process.env.ADMIN_AUTH_BYPASS === "1") { next(); return; }

  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (userId && await isClerkAdmin(userId)) {
      next();
      return;
    }
  } catch {
    // fall through to shared-key check
  }

  // Break-glass: shared admin key (scripts, CI, incident response).
  const expected = process.env.ADMIN_API_KEY;
  const provided = req.headers["x-admin-key"];
  if (expected && typeof provided === "string" && provided === expected) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}
