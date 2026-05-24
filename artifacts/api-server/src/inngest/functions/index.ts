import { inngest } from "../client";
import { agentFunctions } from "./agents";
import { workflowFunctions } from "./workflows";
import { maintenanceFunctions } from "./maintenance";
import { cronCleanupFunctions } from "./cron-cleanups";

const pingFn = inngest.createFunction(
  {
    id: "ping",
    triggers: [{ event: "test/ping" }],
    retries: 0,
  },
  async ({ event, step }) => {
    const echo = await step.run("echo", () => ({
      receivedAt: new Date().toISOString(),
      message: (event.data as { message?: string })?.message ?? "pong",
    }));
    return { ok: true, ...echo };
  },
);

export const functions = [pingFn, ...agentFunctions, ...workflowFunctions, ...maintenanceFunctions, ...cronCleanupFunctions];
