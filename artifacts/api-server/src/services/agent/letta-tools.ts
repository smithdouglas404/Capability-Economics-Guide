/**
 * Letta custom-tool definitions.
 *
 * Letta runs each tool's Python `source_code` inside its own container.
 * To let the stateful agent call back into the Inflexcvi platform without
 * holding any DB/Mem0 credentials of its own, every tool here is a thin
 * HTTP shim that hits an authenticated endpoint on the api-server
 * (mounted under /api/agent/tools/*). The api-server validates the shared
 * INFLEXCVI_AGENT_TOOL_KEY header before doing the actual work and
 * returning JSON.
 *
 * Why this matters: previously the Letta agent only saw whatever text
 * we shoved into messages via lettaSendMessage — it had no way to query
 * live CVI state, recall memories, or look at recent reflections on its
 * own. Registering these tools makes it an actual agent (autonomous
 * tool-use between user messages) instead of a stateful chat puppet.
 *
 * Schema discipline: Letta auto-extracts a JSON schema from the Python
 * source's signature + docstring. We define source code only — no manual
 * JSON schema — to stay aligned with whatever the installed Letta server
 * version expects.
 */

export interface LettaToolDef {
  name: string;
  description: string;
  sourceCode: string;
}

/**
 * Resolve the api-server base URL the tool should call back to. In
 * Railway, this is the api-server's internal hostname (set via env on
 * the Letta service). Falls back to a placeholder that will fail loud.
 */
const PY_BASE_URL_RESOLVER = `
    import os
    base = os.environ.get("INFLEXCVI_API_BASE", "").rstrip("/")
    if not base:
        return {"error": "INFLEXCVI_API_BASE not set on the Letta service"}
`.trim();

/**
 * Read the shared tool-call auth key from env. Matched against
 * INFLEXCVI_AGENT_TOOL_KEY on the api-server side. If unset on Letta,
 * tool returns a helpful error rather than 401-ing silently.
 */
const PY_AUTH_HEADER = `
    key = os.environ.get("INFLEXCVI_AGENT_TOOL_KEY", "")
    if not key:
        return {"error": "INFLEXCVI_AGENT_TOOL_KEY not set on the Letta service"}
    headers = {"X-Agent-Tool-Key": key, "Accept": "application/json"}
`.trim();

/**
 * Tool 1 — query the live CVI/DVX state for a single capability. The
 * agent uses this when a user asks about a specific capability or when
 * it needs to ground a recommendation in current scores.
 */
const QUERY_CAPABILITY: LettaToolDef = {
  name: "query_capability_state",
  description: "Fetch the current CVI score, DVX score, posterior, top disruptors, and recent velocity for a single capability in a given industry. Use this to ground any recommendation in live platform data.",
  sourceCode: `def query_capability_state(industry: str, capability: str) -> dict:
    """Fetch live CVI/DVX state for a capability.

    Args:
        industry: Industry slug or name (e.g. "insurance", "financial-services").
        capability: Capability name or slug (e.g. "underwriting", "claims-processing").

    Returns:
        dict with keys: cvi_score, dvx_score, posterior, top_disruptors,
        velocity, last_updated. Returns {"error": "..."} on failure.
    """
    import os, urllib.parse, urllib.request, json
    ${PY_BASE_URL_RESOLVER}
    ${PY_AUTH_HEADER}
    qs = urllib.parse.urlencode({"industry": industry, "capability": capability})
    url = base + "/api/agent/tools/capability-state?" + qs
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": "fetch failed: " + str(e)}
`,
};

/**
 * Tool 2 — semantic recall over Mem0. The agent uses this when it wants
 * to check "have I seen something like this before?" before answering.
 */
const RECALL_MEMORIES: LettaToolDef = {
  name: "recall_pattern_memories",
  description: "Search Mem0 for past insights, patterns, and contradictions relevant to a freeform query. Use this before forming an opinion to check whether prior cycles already learned something pertinent.",
  sourceCode: `def recall_pattern_memories(query: str, limit: int = 5, category: str = "") -> dict:
    """Semantic search over the agent's institutional memory.

    Args:
        query: Freeform text to vector-search against past memories.
        limit: Max results to return (1-20, default 5).
        category: Optional filter — "pattern", "validated_pattern",
                  "contradiction", "decision", "observation". Empty = all.

    Returns:
        dict with "results": list of {content, category, runScope, score, createdAt}.
        Returns {"error": "..."} on failure.
    """
    import os, urllib.parse, urllib.request, json
    ${PY_BASE_URL_RESOLVER}
    ${PY_AUTH_HEADER}
    params = {"q": query, "limit": max(1, min(20, int(limit)))}
    if category:
        params["category"] = category
    url = base + "/api/agent/tools/recall?" + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": "fetch failed: " + str(e)}
`,
};

/**
 * Tool 3 — list recent reflections + contradictions. The agent uses this
 * to spot drift in its own beliefs over time.
 */
const RECENT_REFLECTIONS: LettaToolDef = {
  name: "list_recent_reflections",
  description: "List the agent's last N reflection summaries — what was added, refined, contradicted in recent cycles. Use this to detect belief drift or to cite specific cycles when explaining a recommendation.",
  sourceCode: `def list_recent_reflections(limit: int = 5) -> dict:
    """Most recent agent reflection summaries.

    Args:
        limit: How many cycles back to fetch (1-20, default 5).

    Returns:
        dict with "reflections": list of {runId, trigger, added, updated,
        contradictions, priorsUpdated, finishedAt}.
    """
    import os, urllib.parse, urllib.request, json
    ${PY_BASE_URL_RESOLVER}
    ${PY_AUTH_HEADER}
    qs = urllib.parse.urlencode({"limit": max(1, min(20, int(limit)))})
    url = base + "/api/agent/tools/reflections?" + qs
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": "fetch failed: " + str(e)}
`,
};

/**
 * Tool 4 — propose a capability flag (queue-for-approval write). The
 * agent calls this when it spots a capability in DVX red zone or with
 * falling CVI that crosses a threshold from the economic_rules block.
 * Writes to agent_proposals; an admin must approve before the flag
 * lands on the capability record.
 */
const PROPOSE_CAPABILITY_FLAG: LettaToolDef = {
  name: "propose_capability_flag",
  description: "Queue a proposed flag on a capability (severity: watch | concern | alert) for admin review. Use this when CVI/DVX state crosses a rule from your economic_rules block. Includes your reasoning in agentRationale so the admin can audit it. NEVER writes directly to canonical data — queues for approval.",
  sourceCode: `def propose_capability_flag(capability_id: int, severity: str, reason: str, rationale: str = "") -> dict:
    """Queue a capability flag for admin approval.

    Args:
        capability_id: Numeric id of the capability to flag.
        severity: "watch" (low priority observation), "concern" (medium —
                  schedule re-research), or "alert" (high — surface to ops).
        reason: 1-2 sentence summary of why this capability should be flagged.
        rationale: Optional longer chain-of-thought for the admin reviewer.

    Returns:
        dict {"proposalId": int, "status": "queued"} on success,
        {"error": "..."} on failure.
    """
    import os, json, urllib.request
    ${PY_BASE_URL_RESOLVER}
    ${PY_AUTH_HEADER}
    body = json.dumps({
        "capability_id": int(capability_id),
        "severity": severity,
        "reason": reason,
        "rationale": rationale,
    }).encode()
    url = base + "/api/agent/tools/propose-capability-flag"
    try:
        req = urllib.request.Request(url, data=body, headers={**headers, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": "fetch failed: " + str(e)}
`,
};

/**
 * Tool 5 — propose a change to an economic_rules threshold (queue
 * for admin approval). The agent calls this when it observes that
 * current thresholds are mis-calibrated to live cycle data — e.g.
 * "CVI floor of 400 is too generous, 6/10 cycles in last 30d flagged
 * false positives below it".
 */
const PROPOSE_ECONOMIC_RULE_CHANGE: LettaToolDef = {
  name: "propose_economic_rule_change",
  description: "Queue a proposed change to one of the strategic thresholds in your economic_rules block (CVI floor, DVX ceiling, etc.) for admin review. Reference the rule by key. Include your full rationale — admins audit these carefully.",
  sourceCode: `def propose_economic_rule_change(rule_key: str, new_value: float, rationale: str) -> dict:
    """Queue an economic rule threshold change for admin approval.

    Args:
        rule_key: The rule's key from your economic_rules block
                  (e.g. "cvi_floor", "dvx_ceiling").
        new_value: Proposed new numeric value, matching the rule's unit.
        rationale: REQUIRED. Detailed chain-of-thought explaining why the
                   current value is mis-calibrated and citing the observations
                   that led to this proposal.

    Returns:
        dict {"proposalId": int, "status": "queued"} on success,
        {"error": "..."} on failure (e.g. rule_key doesn't exist).
    """
    import os, json, urllib.request
    ${PY_BASE_URL_RESOLVER}
    ${PY_AUTH_HEADER}
    body = json.dumps({
        "rule_key": rule_key,
        "new_value": new_value,
        "rationale": rationale,
    }).encode()
    url = base + "/api/agent/tools/propose-economic-rule-change"
    try:
        req = urllib.request.Request(url, data=body, headers={**headers, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": "fetch failed: " + str(e)}
`,
};

/**
 * Tool 6 — propose updating the industry_priors block content for a
 * specific industry. The agent calls this when contradictions persist
 * across cycles, suggesting the current seed text for that industry
 * is stale. (Distinct from the inline core_memory_replace feedback
 * loop in graph.ts:memorizeNode — that's the agent's own block edit;
 * this tool routes large rewrites through admin review for visibility.)
 */
const PROPOSE_INDUSTRY_PRIOR_UPDATE: LettaToolDef = {
  name: "propose_industry_prior_update",
  description: "Queue a proposed rewrite of the industry_priors block content for a specific industry. Use this for non-trivial rewrites that admins should audit. Trivial inline edits to the block can be done directly via core_memory_replace.",
  sourceCode: `def propose_industry_prior_update(industry_slug: str, prior_text: str, source_runs: list) -> dict:
    """Queue a substantive rewrite of industry_priors for admin approval.

    Args:
        industry_slug: Industry to update priors for (e.g. "insurance").
        prior_text: The full proposed new prior content for this industry's
                    section of the block. Be concise — priors should be
                    principles, not transcript.
        source_runs: List of integer run ids whose observations support
                     this rewrite. Lets the admin trace the reasoning.

    Returns:
        dict {"proposalId": int, "status": "queued"} on success.
    """
    import os, json, urllib.request
    ${PY_BASE_URL_RESOLVER}
    ${PY_AUTH_HEADER}
    body = json.dumps({
        "industry_slug": industry_slug,
        "prior_text": prior_text,
        "source_runs": source_runs,
    }).encode()
    url = base + "/api/agent/tools/propose-industry-prior-update"
    try:
        req = urllib.request.Request(url, data=body, headers={**headers, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": "fetch failed: " + str(e)}
`,
};

export const LETTA_CUSTOM_TOOLS: LettaToolDef[] = [
  QUERY_CAPABILITY,
  RECALL_MEMORIES,
  RECENT_REFLECTIONS,
  PROPOSE_CAPABILITY_FLAG,
  PROPOSE_ECONOMIC_RULE_CHANGE,
  PROPOSE_INDUSTRY_PRIOR_UPDATE,
];
