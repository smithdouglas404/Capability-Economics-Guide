import crypto from "node:crypto";
import { db, apiKeysTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

const KEY_PREFIX = "ce_live_";
const RAW_LENGTH_BYTES = 32; // 32 bytes → 43 chars base64url

/** Generate a new API key. The raw value is returned ONCE; only a hash is stored. */
export function generateApiKey(): { raw: string; prefix: string; hashed: string } {
  const random = crypto.randomBytes(RAW_LENGTH_BYTES).toString("base64url");
  const raw = `${KEY_PREFIX}${random}`;
  const prefix = raw.slice(0, 12); // "ce_live_abCd"
  const hashed = hashApiKey(raw);
  return { raw, prefix, hashed };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Resolve an incoming Authorization header to a userId, or null if invalid.
 * Updates lastUsedAt on a successful lookup (best-effort; errors ignored).
 */
export async function resolveApiKey(authHeader: string | undefined): Promise<{ userId: string; keyId: number } | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const raw = match?.[1];
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;

  const hashed = hashApiKey(raw);
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.hashedKey, hashed), isNull(apiKeysTable.revokedAt)))
    .limit(1);
  if (!row) return null;

  // Best-effort lastUsedAt update
  db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, row.id)).catch(() => {});

  return { userId: row.userId, keyId: row.id };
}
