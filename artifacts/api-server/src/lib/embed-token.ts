import crypto from "crypto";

/**
 * Server-verifiable embed entitlement token.
 *
 * Format: base64url(payload).base64url(hmacSha256(secret, payload))
 *   payload = JSON { tier: "platform" | "pro", exp: unix-ms,
 *                    customLogo?: string, customLink?: string,
 *                    tenant?: string }
 *
 * The token is the ONLY trusted source for white-label rights — the
 * `?hideBranding=1` query param alone is ignored by the API. This stops
 * an anonymous user from stripping our branding off the widget by simply
 * editing the iframe URL. Customers receive their token from
 * billing/admin once their Platform-tier subscription is active.
 *
 * Verification is constant-time on the signature comparison, and an
 * unset EMBED_SIGNING_SECRET hard-fails token validation rather than
 * silently allowing every token through.
 */

export interface EmbedEntitlements {
  tier: "platform" | "pro";
  exp: number;
  customLogo?: string;
  customLink?: string;
  tenant?: string;
}

function getSecret(): string | null {
  const s = process.env["EMBED_SIGNING_SECRET"];
  return s && s.length >= 16 ? s : null;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signEmbedToken(payload: EmbedEntitlements): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyEmbedToken(token: unknown): EmbedEntitlements | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  const secret = getSecret();
  if (!secret) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  // constant-time compare — same-length buffers required.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (p["tier"] !== "platform" && p["tier"] !== "pro") return null;
  if (typeof p["exp"] !== "number" || p["exp"] < Date.now()) return null;
  return {
    tier: p["tier"] as "platform" | "pro",
    exp: p["exp"] as number,
    customLogo: typeof p["customLogo"] === "string" ? (p["customLogo"] as string) : undefined,
    customLink: typeof p["customLink"] === "string" ? (p["customLink"] as string) : undefined,
    tenant: typeof p["tenant"] === "string" ? (p["tenant"] as string) : undefined,
  };
}

/**
 * Resolve the branding block returned in embed API responses. The widget
 * trusts THIS, not URL params — `?hideBranding=1` without a Platform-tier
 * token does nothing. `customLogo`/`customLink` are sanitized to https URLs.
 */
export function resolveBranding(token: unknown): {
  hideBranding: boolean;
  customLogo: string | null;
  customLink: string | null;
  tenant: string | null;
} {
  const ent = verifyEmbedToken(token);
  if (!ent || ent.tier !== "platform") {
    return { hideBranding: false, customLogo: null, customLink: null, tenant: null };
  }
  const safeUrl = (u: string | undefined): string | null => {
    if (!u) return null;
    try {
      const parsed = new URL(u);
      return parsed.protocol === "https:" ? parsed.toString() : null;
    } catch {
      return null;
    }
  };
  return {
    hideBranding: true,
    customLogo: safeUrl(ent.customLogo),
    customLink: safeUrl(ent.customLink),
    tenant: ent.tenant ?? null,
  };
}
