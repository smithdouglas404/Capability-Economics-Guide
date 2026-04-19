import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import stripeWebhookRouter from "./routes/stripe-webhook";
import kycWebhookRouter from "./routes/kyc-webhook";
import nowpaymentsWebhookRouter from "./routes/nowpayments-webhook";
import { logger } from "./lib/logger";

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
// Stripe, Didit (KYC) & NOWPayments (crypto) webhooks must read the raw body for signature verification — mount BEFORE express.json().
app.use("/api", stripeWebhookRouter);
app.use("/api", kycWebhookRouter);
app.use("/api", nowpaymentsWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: "text/csv" }));

app.use(clerkMiddleware());

app.use("/api", router);

// Serve the built capability-economics SPA when a frontend bundle is available.
// FRONTEND_DIST_PATH lets ops override the location; otherwise we try the
// monorepo layout (../capability-economics/dist/public) resolved from the
// running bundle's dirname. When no bundle exists (backend-only deploys,
// local API-only dev) static serving is silently skipped.
function resolveFrontendDist(): string | null {
  const override = process.env.FRONTEND_DIST_PATH;
  const candidates = [
    override,
    path.resolve(process.cwd(), "artifacts/capability-economics/dist/public"),
    path.resolve(__dirname, "../../capability-economics/dist/public"),
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
  app.get(/^\/(?!api(?:\/|$)).*/, (_req: Request, res: Response, next: NextFunction) => {
    res.sendFile(path.join(frontendDist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
} else {
  logger.warn(
    "No frontend dist found — running API-only. Set FRONTEND_DIST_PATH or build @workspace/capability-economics to enable SPA serving.",
  );
}

export default app;
