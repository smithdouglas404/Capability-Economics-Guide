/**
 * Single source of truth for the 7 autonomous agents that run on the
 * Inflexcvi platform.
 *
 * Until 2026-05-17, only `cvi-autonomous-agent` was registered in Letta
 * Cloud + Mem0 Cloud. The other 6 specialized agents (macro-event,
 * disruption, peer-coop, stack-optimizer, ontology, synthesis) were
 * LangChain `createAgent()` instances that shared the cvi agent's Letta
 * blocks and Mem0 agent_id. That meant the dashboards couldn't surface
 * per-agent state, sleeptime learning couldn't refine each agent's beliefs
 * independently, and pattern recall always pulled from one shared pool.
 *
 * This registry fixes that. Each agent now has:
 *   - Its own Letta agent (find-or-create by `lettaAgentName`)
 *   - Its own Letta memory_blocks (persona + current_focus + beliefs)
 *   - Its own Letta archive (created + attached on first boot)
 *   - Its own Mem0 agent_id for per-agent semantic recall
 *   - Its own sleeptime learning loop (`enable_sleeptime: true`)
 *
 * The 7th — `cvi-autonomous-agent` — is the existing one and is left
 * verbatim so its accumulated memories carry forward.
 */

export type AgentRegistryEntry = {
  /** Canonical short name used in code paths / scheduler logs / agent_runs.agentName */
  shortName: string;
  /** Letta agent name (find-or-create by this) */
  lettaAgentName: string;
  /** Mem0 agent_id for semantic recall filtering */
  mem0AgentId: string;
  /** Model tier — "sonnet" for synthesis (deeper reasoning), "haiku" for the rest (cost) */
  modelTier: "haiku" | "sonnet";
  /** Letta-flavored model handle (provider/model). Cheaper agents use Haiku. */
  lettaModel: string;
  /** First-person persona statement seeded into the agent's persona memory block. */
  persona: string;
  /** What this agent is focused on right now — seeded into current_focus block. */
  initialFocus: string;
  /** Whether Letta's sleeptime learning loop is enabled. Default true. */
  enableSleeptime: boolean;
};

// Both default to `letta/letta-free` (ships with every Letta deploy). Operator
// overrides via LETTA_MODEL (the heavier agents — synthesis, CVI autonomous)
// and LETTA_MODEL_FAST (the lighter ones — disruption, peer-coop, etc.) to
// upgrade to whatever model handles the Letta server has cataloged. Setting a
// handle Letta doesn't have causes agent creation to 404 with
// "Handle ... not found, must be one of []", which fails registration silently.
const DEFAULT_LETTA_MODEL_SONNET = process.env.LETTA_MODEL ?? "letta/letta-free";
const DEFAULT_LETTA_MODEL_HAIKU = process.env.LETTA_MODEL_FAST ?? process.env.LETTA_MODEL ?? "letta/letta-free";

export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    shortName: "cvi-autonomous-agent",
    lettaAgentName: "cvi-autonomous-agent",
    mem0AgentId: "cvi-autonomous-agent",
    modelTier: "sonnet",
    lettaModel: DEFAULT_LETTA_MODEL_SONNET,
    persona:
      "I am the CVI Autonomous Agent — a senior capability economics analyst. I track how industry capabilities evolve over time, " +
      "identify durable moats, flag fragile ones, and surface cross-industry analogies. I prefer evidence over speculation, " +
      "I update my beliefs when contradicted, and I reason about second-order effects on enterprise value.",
    initialFocus: "(initialized — updated each cycle with the targeted industries and the reasoning trigger)",
    enableSleeptime: true,
  },
  {
    shortName: "macro-event-agent",
    lettaAgentName: "cvi-macro-event-agent",
    mem0AgentId: "cvi-macro-event-agent",
    modelTier: "haiku",
    lettaModel: DEFAULT_LETTA_MODEL_HAIKU,
    persona:
      "I am the Macro Event Agent. I watch global macroeconomic, regulatory, and sector-wide signals (rate decisions, " +
      "regulatory rulings, GDP releases, earnings surprises) and translate them into structured impact deltas on the " +
      "capability graph. I am the bridge between Bloomberg-grade signals and capability-level economics.",
    initialFocus: "Watching: Fed rate decisions, major regulatory rulings, sector earnings, GDP releases.",
    enableSleeptime: true,
  },
  {
    shortName: "disruption-agent",
    lettaAgentName: "cvi-disruption-agent",
    mem0AgentId: "cvi-disruption-agent",
    modelTier: "haiku",
    lettaModel: DEFAULT_LETTA_MODEL_HAIKU,
    persona:
      "I am the Disruption Agent. I scan the capability graph for new signal events, classify them by quadrant pressure " +
      "(velocity vs vulnerability), and queue high-confidence cases for the human-in-the-loop review queue. I am the " +
      "earliest-warning layer for capabilities under threat.",
    initialFocus: "Scanning ~1,000 capability-pair signal events per cycle for high-confidence disruption cases.",
    enableSleeptime: true,
  },
  {
    shortName: "peer-coop-agent",
    lettaAgentName: "cvi-peer-coop-agent",
    mem0AgentId: "cvi-peer-coop-agent",
    modelTier: "haiku",
    lettaModel: DEFAULT_LETTA_MODEL_HAIKU,
    persona:
      "I am the Peer-Coop Agent. I maintain the peer-benchmark cohorts and track which organizations are valid " +
      "comparators per industry + size + region. I make sure benchmark math compares like with like.",
    initialFocus: "Refreshing peer cohort membership and tracking benchmark validity per (industry, size, region) bucket.",
    enableSleeptime: true,
  },
  {
    shortName: "stack-optimizer-agent",
    lettaAgentName: "cvi-stack-optimizer-agent",
    mem0AgentId: "cvi-stack-optimizer-agent",
    modelTier: "haiku",
    lettaModel: DEFAULT_LETTA_MODEL_HAIKU,
    persona:
      "I am the Stack Optimizer Agent. I observe which LLM model/route succeeded per task across the platform, and " +
      "I write recommendations to agent_tuning so cron-driven workloads pick the cheapest model that still hits " +
      "the quality bar. I am the cost-efficiency layer for the AI itself.",
    initialFocus: "Observing LLM call success rates per task class; writing tuning recommendations to agent_tuning.",
    enableSleeptime: true,
  },
  {
    shortName: "ontology-agent",
    lettaAgentName: "cvi-ontology-agent",
    mem0AgentId: "cvi-ontology-agent",
    modelTier: "haiku",
    lettaModel: DEFAULT_LETTA_MODEL_HAIKU,
    persona:
      "I am the Ontology Agent. I propose new capability nodes and relationship edges from external research and " +
      "submit them to the pending_review queue for human governance. I also write entities into Neo4j as :Entity " +
      "nodes for downstream graph traversal.",
    initialFocus: "Mining digests for new capability candidates; dual-writing entities to Postgres + Neo4j.",
    enableSleeptime: true,
  },
  {
    shortName: "synthesis-agent",
    lettaAgentName: "cvi-synthesis-agent",
    mem0AgentId: "cvi-synthesis-agent",
    modelTier: "sonnet",
    lettaModel: DEFAULT_LETTA_MODEL_SONNET,
    persona:
      "I am the Synthesis Agent — the cross-agent intelligence layer. I read every specialized agent's digest, the " +
      "graph correlations, the Mem0 pattern store, and the temporal-shift signals, and I produce a unified daily " +
      "strategic brief. I find convergence signals (multiple agents pointing at one capability), contradiction " +
      "signals (agents disagreeing — usually a transition), and cross-agent insights that no single agent could see.",
    initialFocus: "Daily cross-agent synthesis. Look for convergence, contradiction, and temporal momentum signals.",
    enableSleeptime: true,
  },
];

const BY_SHORT = new Map(AGENT_REGISTRY.map((a) => [a.shortName, a]));
const BY_LETTA = new Map(AGENT_REGISTRY.map((a) => [a.lettaAgentName, a]));

/**
 * Look up an agent registry entry by its short name (e.g. "macro-event-agent"
 * or "cvi-autonomous-agent"). Returns null on miss — callers should fall back
 * to the cvi-autonomous-agent for unknown names to preserve backward compat.
 */
export function getAgentRegistryEntry(shortName: string): AgentRegistryEntry | null {
  return BY_SHORT.get(shortName) ?? BY_LETTA.get(shortName) ?? null;
}

/**
 * The canonical Mem0 agent_id for a given short name. Falls back to
 * "cvi-autonomous-agent" if the name is unrecognised so existing call sites
 * don't break during the migration.
 */
export function mem0AgentIdFor(shortName: string | undefined): string {
  if (!shortName) return "cvi-autonomous-agent";
  return BY_SHORT.get(shortName)?.mem0AgentId
    ?? BY_LETTA.get(shortName)?.mem0AgentId
    ?? "cvi-autonomous-agent";
}

/**
 * The canonical Letta agent name for a given short name. Defaults to the
 * cvi-autonomous-agent for unknown short names.
 */
export function lettaAgentNameFor(shortName: string | undefined): string {
  if (!shortName) return "cvi-autonomous-agent";
  return BY_SHORT.get(shortName)?.lettaAgentName
    ?? BY_LETTA.get(shortName)?.lettaAgentName
    ?? "cvi-autonomous-agent";
}

/**
 * Build the application-layer identity tags stamped onto every memory artifact
 * (Mem0 memories, Letta archival passages). Replaces server-side identity
 * tracking (deprecated upstream by Letta) with tags that travel with the data
 * itself. Filtering on these tags works in both Mem0 (`metadata.tags`) and
 * Letta archival (`PassageCreateParams.tags`).
 *
 * Format: ["agent:<shortName>", "platform:inflexcvi", "env:<NODE_ENV>"].
 * The env tag separates prod/staging data when the same Mem0/Letta cloud
 * accounts back multiple deploys.
 */
export function buildIdentityTags(shortName?: string): string[] {
  const tags = ["platform:inflexcvi"];
  if (shortName) tags.push(`agent:${shortName}`);
  const env = process.env.NODE_ENV;
  if (env) tags.push(`env:${env}`);
  return tags;
}
