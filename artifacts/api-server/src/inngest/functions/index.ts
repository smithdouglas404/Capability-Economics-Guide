import { inngest } from "../client";

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

export const functions = [pingFn];
