import { Inngest } from "inngest";

// isDev is intentionally omitted — the SDK auto-detects: if INNGEST_BASE_URL is
// set (self-hosted) or INNGEST_DEV=0 is set, it operates in non-dev mode and
// targets the configured server. Hardcoding `isDev: NODE_ENV !== "production"`
// forced dev mode on staging/preview environments and made the SDK ignore
// INNGEST_BASE_URL — see feat/inngest-migration Phase 0 debug 2026-05-23.
export const inngest = new Inngest({
  id: "capabilityeconomics-api-server",
  eventKey: process.env["INNGEST_EVENT_KEY"],
  signingKey: process.env["INNGEST_SIGNING_KEY"],
  signingKeyFallback: process.env["INNGEST_SIGNING_KEY_FALLBACK"],
});
