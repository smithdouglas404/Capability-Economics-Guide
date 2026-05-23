import { Inngest } from "inngest";

// Pass baseUrl explicitly so the SDK doesn't fall back to https://api.inngest.com
// when INNGEST_BASE_URL isn't picked up (e.g. typo or unset on a staging env).
// isDev is omitted so the SDK auto-detects from baseUrl. See feat/inngest-migration
// Phase 0 debug 2026-05-23.
const baseUrl = process.env["INNGEST_BASE_URL"];

export const inngest = new Inngest({
  id: "capabilityeconomics-api-server",
  eventKey: process.env["INNGEST_EVENT_KEY"],
  signingKey: process.env["INNGEST_SIGNING_KEY"],
  signingKeyFallback: process.env["INNGEST_SIGNING_KEY_FALLBACK"],
  ...(baseUrl ? { baseUrl } : {}),
});

// Log the resolved config on boot so deployment misconfig is visible in Railway
// logs (no secrets — only flags + url presence).
// eslint-disable-next-line no-console
console.info(
  "[inngest] client booted —",
  JSON.stringify({
    baseUrl: baseUrl ?? "(default)",
    hasEventKey: Boolean(process.env["INNGEST_EVENT_KEY"]),
    hasSigningKey: Boolean(process.env["INNGEST_SIGNING_KEY"]),
    nodeEnv: process.env["NODE_ENV"] ?? "(unset)",
  }),
);
