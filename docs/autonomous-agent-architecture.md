# Autonomous Agent Architecture Redesign

This document outlines the architectural shift required to move the Inflexcvi platform from a **cron-driven, LangGraph-scheduled execution model** to a **truly autonomous, event-driven agent ecosystem** with persistent memory.

## 1. The Current State (Why it feels non-autonomous)

Currently, the agents in the platform are not truly autonomous; they are **stateless functions invoked by a central clock**.

*   **The Trigger:** `scheduler.ts` runs a `setInterval` loop that blindly fires off agents (e.g., `runMacroEventAgent()`, `runDisruptionAgent()`) on fixed intervals (e.g., every 60 minutes).
*   **The Execution:** When triggered, the agent boots up, reads its system prompt, executes a single LangChain `createAgent` pass (`base-agent.ts`), writes to the shared store, and then **dies**.
*   **The Memory:** While the agents *can* read from the shared `PostgresStore` (e.g., the Disruption Agent reads what the Macro Event Agent wrote), they have no persistent internal loop. They only act when the cron tells them to.

This is a "batch processing" model disguised as an agent model. True autonomy requires agents that stay alive, monitor their environment, and decide *when* to act based on events, not just a clock.

## 2. The Target Architecture: Event-Driven Autonomy

To achieve true autonomy, we must invert the control flow. Instead of a central scheduler waking agents up, the agents should be **persistent workers** that listen to an event bus and react to changes in their environment.

### 2.1. The Event Bus (The Nervous System)

We will introduce a central Event Bus (using PostgreSQL `LISTEN/NOTIFY` or a lightweight Redis pub/sub, depending on infrastructure constraints).

*   **Events:** Everything that happens in the platform becomes an event: `edgar_filing_received`, `macro_event_detected`, `capability_score_changed`, `user_override_applied`.
*   **Subscriptions:** Agents subscribe to the events they care about.

### 2.2. The Persistent Agent Loop

Instead of `runReactAgent` executing once and returning, agents will run in a continuous `while(true)` loop (or a robust worker queue like BullMQ).

1.  **Listen:** The agent waits for relevant events on the bus.
2.  **Evaluate:** When an event arrives, the agent reads its **Mem0 semantic memory** and its **PostgresStore prior blocks** to decide if the event warrants action.
3.  **Act:** If action is needed, the agent executes its tool loop.
4.  **Reflect & Memorize:** The agent writes its findings back to Mem0 and the shared store, and potentially emits new events (e.g., the Macro Event Agent emits `macro_digest_published`).
5.  **Sleep:** The agent goes back to listening.

### 2.3. Memory as the Driver of Action

Memory will shift from being a passive lookup to an active driver of behavior.

*   **Mem0 (Semantic Memory):** When an `edgar_filing_received` event arrives, the agent queries Mem0: *"Have I seen this pattern of capability investment before?"* If yes, it skips deep research. If no, it triggers a deep dive.
*   **PostgresStore (Shared Blackboard):** Agents will use the shared store to leave "bounties" or "requests for research" for other agents, creating true multi-agent collaboration rather than just sequential cron jobs.

## 3. Implementation Plan

Transitioning to this model requires a phased approach to avoid breaking the current production pipeline.

### Phase 1: Introduce the Event Bus

1.  Implement a lightweight event bus using PostgreSQL `LISTEN/NOTIFY` (since PostgreSQL is already the core database).
2.  Modify the existing data ingestion pipelines (e.g., EDGAR RSS) to emit events (`edgar_filing_inserted`) instead of just writing to the database.

### Phase 2: Convert Agents to Event Listeners

1.  Refactor `base-agent.ts` to support a persistent listening mode.
2.  Migrate the `MacroEventAgent`: Remove it from `scheduler.ts`. Have it listen for `edgar_filing_inserted` events and run its analysis only when new data arrives.
3.  Migrate the `DisruptionAgent`: Have it listen for the `macro_digest_published` event emitted by the Macro Event Agent.

### Phase 3: Active Memory Integration

1.  Enhance the agent prompts to explicitly instruct them to query Mem0 *before* taking action on an event.
2.  Implement the "bounty" system in `PostgresStore` where agents can request specific analyses from peers.

### Phase 4: Decommission the Cron Scheduler

1.  Once all agents are event-driven, remove the fixed-interval timers from `scheduler.ts`.
2.  The scheduler's only job will be to emit "heartbeat" events for tasks that truly require periodic checks (e.g., token expiry).

## Conclusion

By moving from a cron-driven LangGraph execution to an event-driven, persistent loop, the agents will become truly autonomous. They will react to the world as it changes, use Mem0 to contextualize those changes, and collaborate via the shared PostgresStore, fulfilling the vision of a self-directing intelligence platform.
