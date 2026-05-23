import { AsyncLocalStorage } from "async_hooks";
import type { GetStepTools } from "inngest";
import { inngest } from "./client";

// Phase 2 — AsyncLocalStorage-threaded Inngest step context.
//
// Lets deep LangGraph / agent code call `maybeStepRun("name", fn)` to opt
// into per-LLM-call Inngest steps WITHOUT changing function signatures.
// The Inngest cron wrappers in functions/agents.ts call `withStep(step, ...)`
// to populate the ALS before invoking the agent's entry point; any nested
// call to `maybeStepRun` inside that async stack picks up the active `step`
// and wraps its work in `step.run`. When called from the legacy scheduler
// path (no ALS context — dev runs, tests, or the setInterval fallback),
// `maybeStepRun` is a no-op and just invokes `fn` directly.

type Step = GetStepTools<typeof inngest>;

const ctx = new AsyncLocalStorage<Step>();

export function withStep<T>(step: Step, fn: () => Promise<T>): Promise<T> {
  return ctx.run(step, fn);
}

/**
 * If we're inside an Inngest function execution, wrap `fn` in `step.run()`.
 * Otherwise (legacy scheduler path, dev, tests) just call `fn` directly.
 *
 * IMPORTANT: the return value MUST be JSON-serializable — Inngest persists
 * it for replay. Wrap LLM/tool calls so only plain data (strings, numbers,
 * `{output, toolCallCount}` shapes) crosses the step boundary. Class
 * instances like LangChain `BaseMessage` will NOT round-trip.
 */
export async function maybeStepRun<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const step = ctx.getStore();
  if (!step) return fn();
  return step.run(name, fn) as Promise<T>;
}
