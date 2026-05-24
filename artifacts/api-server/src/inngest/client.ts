import { Inngest } from "inngest";

// Pass baseUrl explicitly so the SDK doesn't fall back to https://api.inngest.com
// when INNGEST_BASE_URL isn't picked up (e.g. typo or unset on a staging env).
// isDev is omitted so the SDK auto-detects from baseUrl. See feat/inngest-migration
// Phase 0 debug 2026-05-23.
const baseUrl = process.env["INNGEST_BASE_URL"];

// Branch environments: each Railway preview deploy gets its own Inngest
// namespace so PR previews don't pollute prod function runs / event streams.
// Resolution order:
//   1) explicit INNGEST_ENV (operator override, used for staging/preview pinning)
//   2) RAILWAY_GIT_BRANCH (auto-set by Railway on preview deploys: PR branch slug)
//   3) NODE_ENV=production → "production"
//   4) fallback "development"
// Branch names with slashes (feature/foo) become hyphenated (feature-foo) to
// keep Inngest's env identifier valid.
const branch = process.env["RAILWAY_GIT_BRANCH"];
const env = process.env["INNGEST_ENV"]
  ?? (branch && branch !== "main" ? branch.replace(/[^a-zA-Z0-9-]/g, "-") : undefined)
  ?? (process.env["NODE_ENV"] === "production" ? "production" : "development");

export const inngest = new Inngest({
  id: "capabilityeconomics-api-server",
  env,
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
    env,
    hasEventKey: Boolean(process.env["INNGEST_EVENT_KEY"]),
    hasSigningKey: Boolean(process.env["INNGEST_SIGNING_KEY"]),
    nodeEnv: process.env["NODE_ENV"] ?? "(unset)",
  }),
);
