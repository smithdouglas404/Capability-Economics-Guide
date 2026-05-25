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

/**
 * Wrap an LLM call (OpenRouter, Perplexity, OpenAI, Anthropic, etc.) so it
 * becomes a durable, retriable, observable Inngest step. Uses `step.ai.wrap`
 * which gives us per-LLM-call retry granularity AND surfaces the call (with
 * arguments + result) in the Inngest dashboard for cost/usage tracking.
 *
 * Adopted after the 2026-05-25 Gemini-fallback cost incident — raw `fetch()`
 * to OpenRouter from un-gated setInterval timers silently billed Gemini 2.5
 * Flash whenever Perplexity returned 401. With `step.ai.wrap`, the call
 * becomes part of the Inngest run record and any cron-level `rateLimit` or
 * `throttle` includes it in budget accounting.
 *
 * Fail-open: if NOT running inside an Inngest function (HTTP route, test,
 * legacy scheduler), the call still executes — just unwrapped. This keeps
 * adoption purely additive; no existing caller breaks.
 *
 * Naming convention: pass the call-site name in `service:operation` form
 * (e.g. "perplexity:chat", "openrouter:gemini-fallback") so the Inngest
 * dashboard groups them sensibly.
 */
export async function maybeStepAiWrap<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const step = ctx.getStore();
  if (!step) return fn();
  // step.ai.wrap takes (idOrOptions, fn, ...input). Empty input list since
  // our callers close over their own args.
  return step.ai.wrap(name, fn) as Promise<T>;
}
