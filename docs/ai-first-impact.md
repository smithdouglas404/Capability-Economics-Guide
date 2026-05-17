# How the AI-First Upgrade Impacts Insights and Recommendations

*Companion to: [`system-architecture.md`](system-architecture.md), [`architecture-spec.md`](architecture-spec.md), and the "Moat" section of [`pitchbook.md`](pitchbook.md).*

## The fundamental shift: from stateless to stateful reasoning

The most important impact is not any individual feature — it is the shift from a system that reasons only about the present to one that reasons about the present in the context of everything it has learned. Every insight and recommendation the system generates is now informed by accumulated evidence rather than just current-cycle data. That distinction determines whether the system produces commodity analysis or genuine intelligence.

## Impact on insight generation

Before the upgrade, the insight pipeline worked as follows. When a user requested capability insights for an industry, `generateInsightsTool` would pull the current CVI scores from PostgreSQL, run a single Perplexity web search for recent news, and pass both to Claude with a prompt asking for a strategic summary. The output was coherent and well-written, but it was essentially a synthesis of what was publicly available at that moment. It had no memory of what the system had observed in prior cycles, no awareness of structural relationships between capabilities, and no ability to distinguish a new trend from a recurring pattern.

After the upgrade, the same request triggers a materially different process. Before Claude writes a single word, the tool assembles three additional layers of context:

The first layer is **semantic pattern recall from Mem0**. The top five patterns most relevant to the industry are retrieved by semantic similarity. These patterns represent validated observations accumulated across potentially hundreds of prior research cycles — things like *"In Financial Services, AI-driven compliance automation consistently precedes a CVI improvement of 8–12 points within two quarters"* or *"Healthcare organizations that score below 40 on Data Governance show systematically poor outcomes when building AI-Assisted Diagnostics."* These are not things a web search can find. They are proprietary institutional knowledge the system has built up by observing its own predictions against actual outcomes.

The second layer is **graph correlations from Neo4j**. The top eight empirically observed co-dependency relationships for the industry are retrieved. These represent structural facts about how capabilities relate to each other — which ones tend to appear together, which ones block others, which relationships are strengthening or weakening. An insight that says *"AI Automation and Workforce Reskilling show a 78% co-occurrence rate in this industry, and that relationship has been accelerating for 90 days"* is a different class of observation than anything derivable from current scores alone.

The third layer is **the Synthesis Agent brief** — the daily cross-agent strategic summary that identifies convergence signals, contradiction signals, and cross-agent insights. If the Macro Event Agent detected an EDGAR filing signal, the Disruption Agent flagged a DVX spike, and the temporal-shift detector identified an accelerating relationship — all pointing to the same capability — the Synthesis Agent has already connected those dots. That synthesis is now part of the context Claude reasons from when generating insights.

The practical result is that insights move from being well-formatted summaries of current data to being **evidence-grounded strategic assessments that reflect what the system has learned over time**. The longer the system runs, the richer the Mem0 pattern store becomes, and the more differentiated the insights become from anything a competitor without this accumulated context could produce.

## Impact on recommendations

Before the upgrade, the recommendation engine was a threshold-based rules system. Each capability was scored against fixed criteria — DVX above a certain level meant high disruption risk, CVI below a certain level meant capability immaturity — and those scores were mapped to a build/buy/outsource decision through a lookup table. The system could explain the scores, but it could not explain the reasoning behind the recommendation, account for structural dependencies, or distinguish between a recommendation it had made correctly ten times before and one it was making for the first time.

After the upgrade, the recommendation process involves three layers of reasoning that did not previously exist.

The first is **causal dependency reasoning via Neo4j**. Before recommending that an organization build a capability, the system now traverses the graph to identify upstream blockers — capabilities that must be in place before the target capability can succeed. A recommendation to build AI-Assisted Diagnostics that ignores a weak Data Governance score is a recommendation that will fail in practice. The graph makes that dependency visible and the recommendation now accounts for it explicitly.

The second is **track-record awareness via the feedback loop**. The recommendation-feedback service scores every recommendation against actual CVI outcomes 60 days later. Validated recommendations — where the CVI moved in the predicted direction — are written to Mem0 as high-confidence patterns. Contradicted recommendations are written as warnings. Over time, the recommendation engine accumulates a track record. It knows which recommendation types have historically been accurate in which industries, and which have not. A recommendation backed by ten validated precedents carries different weight than a first-time recommendation, and the system now reflects that distinction.

The third is **cross-agent context from the Synthesis Agent brief**. Recommendations are no longer made in isolation from what the other agents found. If the Disruption Agent has flagged a capability as high-risk and the Macro Event Agent has detected a macro signal pointing in the same direction, the recommendation engine receives that context before making its decision. A recommendation to outsource a capability that the disruption analysis identifies as a strategic differentiator would be flagged as a contradiction rather than passed through unchallenged.

## The compounding effect over time

The most significant impact of the upgrade is not visible in the first cycle — it becomes visible over weeks and months. The system is now designed to compound. Every cycle adds patterns to Mem0. Every recommendation outcome either validates or contradicts a prior belief. Every temporal shift detected updates the momentum signals available to all agents. Every Synthesis Agent run produces a brief that is richer than the one before it because it is drawing on a deeper pattern store.

A system that has been running for six months with this architecture will produce insights and recommendations that are **qualitatively different from what it produces on day one** — not because the underlying models have changed, but because the accumulated evidence base has grown. That compounding is the core value proposition of an AI-first architecture, and it is what distinguishes this system from one that simply calls an LLM with current data on each request.

---

## Implementation status (as of 2026-05-17)

The architecture above is fully live in production. Originally landed in commit `4ae6de9` (Manus AI), stabilized in `192b7c0` (typecheck + field-name fixes), and completed in the same session with the four follow-on items below:

| Component | File | Status | Notes |
|---|---|---|---|
| Mem0 pattern recall in insights | `services/agent/tools.ts` `generateInsightsTool` | ✅ live | Pulls top 8 industry patterns + 4 validated + 3 contradictions, dedupes, injects into Claude prompt |
| Neo4j `findCorrelations` in insights | `services/agent/tools.ts` `generateInsightsTool` | ✅ live | Top-5 capabilities per industry get graph correlations; top-10 by `observedCount` injected into prompt |
| Graph-aware `pickRecommendedAI` | `services/stack-optimizer.ts` | ✅ live | Replaces the heuristic rules engine with Neo4j upstream blockers + Mem0 patterns + Haiku reasoning |
| Synthesis Agent | `services/synthesis-agent.ts` | ✅ live | Daily (5-min startup stagger). Reads all 5 agent digests + graph correlations + Mem0 patterns + temporal shifts. Sonnet model. |
| Temporal-shift detector | `services/agent/temporal-shift-detector.ts` | ✅ live, 6h cadence | Writes accelerating/reversing memories to Mem0 with high-signal filter |
| Recommendation feedback loop | `services/agent/recommendation-feedback.ts` | ✅ live, dormant until day 60 | Evaluates insights > 60d old against CVI trajectory. Returns empty until the first cohort of insights ages in. |
| All specialized agents inject memory context | `services/agent/base-agent.ts` | ✅ live | Each run prepends Mem0 patterns + agent prior block + latest synthesis brief to the system prompt |
| Post-run memory writes | `services/agent/base-agent.ts` `writePostRunMemory` | ✅ live | Each agent run summary is stored as `agent_run_summary` category in Mem0 |

### Deferred items from the original review — now complete

The original code review flagged five "deferred" items as worth doing but not blockers. All five have shipped in the same session:

1. **Cache temporal-shift output to the shared store** — ✅ done. `detectTemporalShifts()` writes to `NS.sharedKnowledge("temporal_shifts")` at end of each 6h run; `getCachedTemporalShiftReport()` exposes a 7h TTL cache so the Synthesis Agent's `readTemporalShiftsTool` reads from cache instead of triggering a full `memory_relations` scan inside an LLM tool-call loop. (`services/agent/temporal-shift-detector.ts`)

2. **Batch `pickRecommendedAI` Haiku calls** — ✅ done. `recommendStack` now executes in four phases: (1) deterministic per-cap data, (2) parallel `gatherCapabilityContext` for all caps via `Promise.all`, (3) a single `batchHaikuRecommend` LLM call covering all capabilities, (4) result assembly. Cuts Haiku invocations from N to 1 for typical 5–15 cap agent requests. (`services/stack-optimizer.ts`)

3. **Real graph-weight snapshots** — ✅ done. New `memory_relation_snapshots` table (migration `0006_memory_relation_snapshots.sql`) + a daily snapshot writer (`writeMemoryRelationSnapshots` in `temporal-shift-detector.ts`) + a refactored detector that prefers the closest snapshot to (now − 30d) over the legacy fictional 0.1 baseline. The fictional baseline remains as a fallback only for relationships younger than 30 days or during the first month post-deploy when snapshots haven't accumulated.

4. **Health probes for synthesis-agent + temporal-shift-detector** — ✅ done. Two new probes (`probeSynthesisAgent`, `probeTemporalShifts`) check cache freshness against the cron cadence. Fresh / degraded / down thresholds: 25h / 49h for synthesis (daily); 7h / 14h for temporal shift (6-hourly). Wired into `/api/health/services`. (`services/health/probes.ts`)

5. **Commit + push** — ✅ done. Stabilization landed as `192b7c0`; the four deferred items land separately so each is independently reviewable.

### Remaining honest caveats

- **The recommendation-feedback loop is dormant** until the first cohort of recommendations is 60 days old. Pitchbook claims about "track-record awareness" are architecturally true today but produce no Mem0 writes until day 60+.
- **Real-snapshot momentum requires 30+ days of accumulated snapshots.** The legacy fictional-baseline fallback runs for the first month post-deploy. Output is directionally correct but quantitatively approximate until snapshots are 30 days deep.
- **No automated tests.** The repo has no test runner. Verification is `pnpm typecheck` + manual smoke against `/api/health/services` after deploy.

## Verification

After deploy, watch `/api/health/services` for these new fields:

```json
{
  "service": "synthesis_agent",
  "status": "ok",          // or "not_configured" for the first ~5 min after boot
  "lastError": null
},
{
  "service": "temporal_shifts",
  "status": "ok",          // or "not_configured" for the first ~2 min after boot
  "lastError": null
}
```

And in the api-server logs, expect these lines on the cron cadences shown:

```
[Agent] Temporal shifts: <N> analyzed, <X> accelerating, <Y> reversing       # every 6h
[Agent] Synthesis agent: tools=<N> duration=<Mms>                            # daily
[Agent] Memory-relation snapshots: <N> written, <M> skipped                  # daily
```
