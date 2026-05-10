/**
 * Build the Content-Security-Policy `frame-ancestors` value for embeddable
 * widget responses. Used by both the JSON API (/api/embed/*) and the SPA
 * HTML fallback so the two never drift.
 *
 * Behavior:
 *  - No `domains` query param  → permissive `frame-ancestors *` (default
 *    for the public widget, embeddable on any site).
 *  - With `domains=a.com,b.com` → tightened
 *    `frame-ancestors 'self' https://a.com https://b.com` (Platform-tier
 *    white-label allowlist).
 *  - Tokens are validated as host or wildcard-host names (e.g. `acme.com`,
 *    `*.acme.com`); malformed tokens are dropped silently. If everything
 *    is dropped we fall back to `*` rather than `'none'` so we don't
 *    silently break embedding because of a typo.
 */
export function buildFrameAncestorsCsp(rawDomainsParam: unknown): string {
  if (typeof rawDomainsParam !== "string" || rawDomainsParam.trim() === "") {
    return "frame-ancestors *";
  }
  // Valid host: optional leading "*." then one or more dot-separated labels
  // of letters/digits/hyphens. RFC 1035-ish, intentionally strict.
  const hostRe = /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
  const allow = rawDomainsParam
    .split(",")
    .map(d => d.trim().toLowerCase())
    .filter(d => d.length > 0 && d.length <= 253 && hostRe.test(d))
    .slice(0, 25);
  if (allow.length === 0) return "frame-ancestors *";
  return `frame-ancestors 'self' ${allow.map(d => `https://${d}`).join(" ")}`;
}
