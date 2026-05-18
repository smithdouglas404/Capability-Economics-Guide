import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import { apiKeyAuth } from "./middlewares/apiKeyAuth";
import { rateLimitMiddleware } from "./middlewares/rateLimit";
import router from "./routes";
import v1Router from "./routes/v1";
import stripeWebhookRouter from "./routes/stripe-webhook";
import kycWebhookRouter from "./routes/kyc-webhook";
import nowpaymentsWebhookRouter from "./routes/nowpayments-webhook";
import { logger } from "./lib/logger";
import { buildFrameAncestorsCsp } from "./lib/embed-csp";

const app: Express = express();

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Stripe, Didit (KYC), NOWPayments (crypto), and Dify callback routes all
// read the raw body for signature verification — mount BEFORE express.json().
app.use("/api", stripeWebhookRouter);
app.use("/api", kycWebhookRouter);
app.use("/api", nowpaymentsWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: "text/csv" }));

app.use(clerkMiddleware());
// Runs after Clerk so a real browser session always wins. Only falls back to
// API-key auth when the caller is programmatic (no Clerk cookie).
app.use(apiKeyAuth());

// Per-tenant rate limiting. Mounts after auth so we can identify the bucket
// by Clerk userId / API key when present, then session token, then IP. Skips
// health + webhooks internally. Fails open if Redis is down.
app.use("/api", rateLimitMiddleware());

app.use("/api", router);

// Public Data License API — versioned, stable URLs, per-key auth + metering.
// Mounted at top level so customers can integrate against /v1/* independent
// of the in-app /api namespace. The v1 router has its own per-key rate
// limiter (see middlewares/requireApiKey.ts) and skips the /api tier limiter.
app.use("/v1", v1Router);

// Serve the built inflexcvi SPA when a frontend bundle is available.
// FRONTEND_DIST_PATH lets ops override the location; otherwise we try the
// monorepo layout (../inflexcvi/dist/public) resolved from the
// running bundle's dirname. When no bundle exists (backend-only deploys,
// local API-only dev) static serving is silently skipped.
function resolveFrontendDist(): string | null {
  const override = process.env.FRONTEND_DIST_PATH;
  const candidates = [
    override,
    path.resolve(process.cwd(), "artifacts/inflexcvi/dist/public"),
    path.resolve(__dirname, "../../inflexcvi/dist/public"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

const frontendDist = resolveFrontendDist();
if (frontendDist) {
  logger.info({ frontendDist }, "Serving SPA from static directory");
  app.use(express.static(frontendDist, { index: false, maxAge: "1h" }));

  // SPA fallback: any non-/api GET returns index.html so client-side routing works.
  app.get(/^\/(?!api(?:\/|$)).*/, (req: Request, res: Response, next: NextFunction) => {
    // Iframe-friendly headers for the embed widget shells. Uses the same
    // helper as /api/embed/* so a `?domains=` allowlist is honored on the
    // HTML response too — without this, a Platform-tier customer passing
    // ?domains=acme.com would still ship `frame-ancestors *` to the iframe
    // shell. Also strips X-Frame-Options in case a future helmet/proxy
    // flips on SAMEORIGIN.
    if (req.path.startsWith("/embed/")) {
      res.setHeader("Content-Security-Policy", buildFrameAncestorsCsp(req.query.domains));
      res.removeHeader("X-Frame-Options");
    }
    res.sendFile(path.join(frontendDist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
} else {
  logger.warn(
    "No frontend dist found — running API-only. Set FRONTEND_DIST_PATH or build @workspace/inflexcvi to enable SPA serving.",
  );
}

export default app;
