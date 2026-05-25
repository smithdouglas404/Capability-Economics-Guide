/**
 * Drop-in replacement for `tool()` from `@langchain/core/tools`.
 *
 * The migrated AgentKit agents in `services/<agent>-agentkit.ts` call our
 * tool wrappers (defined in `services/agent/tools.ts` and
 * `services/vcr/tools.ts`) directly via `.invoke(args)` — they don't go
 * through LangChain's tool-selection or run-management machinery. That
 * means the whole `@langchain/core` dependency exists solely to give us
 * `tool(handler, {name, description, schema})` returning something with
 * `.invoke()`. This file provides exactly that surface with zero
 * LangChain dependency.
 *
 * Validation behavior matches LangChain: `schema.parse(input)` runs before
 * the handler so a bad shape throws synchronously (well, in the promise),
 * just like the LangChain wrapper would.
 */

import type { z } from "zod";

export interface ToolHandle<TSchema extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: TSchema;
  invoke(input: z.infer<TSchema>): Promise<string>;
}

export function tool<TSchema extends z.ZodTypeAny>(
  handler: (input: z.infer<TSchema>) => Promise<string> | string,
  config: { name: string; description: string; schema: TSchema },
): ToolHandle<TSchema> {
  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    async invoke(input: z.infer<TSchema>): Promise<string> {
      const parsed = config.schema.parse(input);
      const result = await handler(parsed as z.infer<TSchema>);
      return result;
    },
  };
}
