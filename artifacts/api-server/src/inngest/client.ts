import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "capabilityeconomics-api-server",
  eventKey: process.env["INNGEST_EVENT_KEY"],
  signingKey: process.env["INNGEST_SIGNING_KEY"],
  signingKeyFallback: process.env["INNGEST_SIGNING_KEY_FALLBACK"],
  isDev: process.env["NODE_ENV"] !== "production",
});
