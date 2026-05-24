import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Swords, AlertTriangle, Shield, TrendingDown, RefreshCw, X } from "lucide-react";
import { LifecycleChip, LIFECYCLE_STAGES, lifecycleLabel, type LifecycleStage } from "@/components/lifecycle-chip";
import { ScoreWithProvenance } from "@/components/score-with-provenance";
import { PersonaDescription } from "@/components/page-header";
import { StreamingBrief } from "@/components/streaming-brief";
import { SynthesisBriefCard } from "@/components/synthesis-brief-card";
import { ConsensusView } from "@/components/consensus-view";
import { CapabilityCascadeChip } from "@/components/capability-cascade-chip";

const API_BASE = "/api";

type MatrixRow = {
  capabilityId: number;
  capabilityName: string;
  myScore: number | null;
  benchmark: number;
  gap: number | null;
  moatScore: number | null;
  evar12mo: number | null;
  aiExposure: number | null;
  velocity: number;
  consensusScore: number;
  confidence: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  lastUpdatedAt: string | null;
  sourceCount: number;
  citations: string[];
  sourceBreakdown: Array<{ sourceLabel: string; rawScore: number; weight: number; methodology?: string }>;
  lifecycleStage: LifecycleStage;
  /** Change in consensus score vs 90 days ago; null if no history. */
  delta90: number | null;
  /** Cohort-wide consensus movement over the last 90d. Mirrors `delta90`. */
  cohortDelta90: number | null;
  /** myScore - (cohort consensus 90d ago). > cohortDelta90 means accelerating. */
  youDelta90: number | null;
  /**
   * If current velocity continues, months until myScore reaches benchmark.
   * Positive number when closing a negative gap; null when already at/above
   * benchmark or no signal. Pair with `closesNever` for the "—" case.
   */
  monthsToClose: number | null;
  /** True when a real gap exists but velocity ≤ 0 — gap never closes. */
  closesNever: boolean;
};

type Alert = { type: string; message: string; severity: string; capabilityId: number };
type Industry = { id: number; name: string };

export default function CapabilityScorecard() {
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [mode, setMode] = useState<"user" | "industry-average">("user");
  const [aggregatedFromOrgs, setAggregatedFromOrgs] = useState(0);
  const [stageFilter, setStageFilter] = useState<LifecycleStage | "all">("all");
  const [sortBy, setSortBy] = useState<"gap" | "stage">("gap");
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  // Query-param deep-link: ?capabilityIds=1,2,3&source=DORA filters the
  // matrix to a specific subset and shows a "Showing remediation priorities
  // from <source>" banner with a Clear button. Read once on mount, persist
  // until the user clears.
  const [focusedCapabilityIds, setFocusedCapabilityIds] = useState<Set<number> | null>(null);
  const [focusedSource, setFocusedSource] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("capabilityIds");
    if (raw) {
      const ids = raw.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length > 0) setFocusedCapabilityIds(new Set(ids));
    }
    const src = params.get("source");
    if (src) setFocusedSource(src);
  }, []);
  const clearFocus = () => {
    setFocusedCapabilityIds(null);
    setFocusedSource(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("capabilityIds");
      url.searchParams.delete("source");
      window.history.replaceState({}, "", url.toString());
    }
  };

  const load = async (overrideIndustryId?: number | null) => {
    setLoading(true);
    try {
      let url: string;
      if (sessionToken) {
        url = `${API_BASE}/war-room/compare?sessionToken=${sessionToken}`;
      } else {
        const ind = overrideIndustryId ?? industryId;
        if (!ind) { setLoading(false); return; }
        url = `${API_BASE}/war-room/compare?industryId=${ind}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      setMatrix(data.matrix ?? []);
      setAlerts(data.alerts ?? []);
      setOrgName(data.orgName ?? "");
      setMode(data.mode ?? "user");
      setAggregatedFromOrgs(data.aggregatedFromOrgs ?? 0);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  // Anonymous visitors: fetch industry list and default to the first one
  // so the scorecard shows industry-average maturity instead of an empty page.
  useEffect(() => {
    if (sessionToken) { load(); return; }
    fetch(`${API_BASE}/industries`).then((r) => r.json()).then((rows: Industry[]) => {
      setIndustries(rows);
      if (rows.length > 0) {
        setIndustryId(rows[0].id);
        load(rows[0].id);
      }
    }).catch(() => setLoading(false));
  }, []);

  const stageScoped = stageFilter === "all" ? matrix : matrix.filter((m) => m.lifecycleStage === stageFilter);
  const filteredMatrix = focusedCapabilityIds
    ? stageScoped.filter((m) => focusedCapabilityIds.has(m.capabilityId))
    : stageScoped;
  // Stable lifecycle ordering for the optional sort: emerging → adopted → mature → decaying → obsolete.
  const STAGE_ORDER: Record<LifecycleStage, number> = { emerging: 0, adopted: 1, mature: 2, decaying: 3, obsolete: 4 };
  const sortedByGap = [...filteredMatrix]
    .filter((m) => m.gap !== null)
    .sort((a, b) =>
      sortBy === "stage"
        ? STAGE_ORDER[a.lifecycleStage] - STAGE_ORDER[b.lifecycleStage] || (a.gap ?? 0) - (b.gap ?? 0)
        : (a.gap ?? 0) - (b.gap ?? 0)
    );
  const stageCounts = LIFECYCLE_STAGES.reduce<Record<LifecycleStage, number>>((acc, s) => {
    acc[s] = matrix.filter((m) => m.lifecycleStage === s).length;
    return acc;
  }, { emerging: 0, adopted: 0, mature: 0, decaying: 0, obsolete: 0 });
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Live</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Capability Scorecard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {orgName || "Your organization"} vs. industry benchmarks — gap analysis with moat scores, EVaR, and AI exposure per capability.
            {mode === "industry-average" && (
              <span className="block mt-1 text-xs">
                Showing industry-average scores aggregated across {aggregatedFromOrgs} reference {aggregatedFromOrgs === 1 ? "organization" : "organizations"}. Set up your own organization to compare your scores directly.
              </span>
            )}
          </p>
          <PersonaDescription
            descriptions={{
              default: "Each row is a capability with the organization's score, the industry benchmark, the gap, and the EVaR (enterprise value at risk if the gap stays open).",
              pe: "Portfolio-co diligence view. Sort by EVaR descending to see the capabilities most exposed to value loss if uncorrected. Moat score on the right tells you whether the gap is defensible.",
              vc: "Use this on a portfolio company to find the capability gaps a follow-on round could fund. Moat score predicts whether a gap is a defensibility risk or a routine catch-up.",
              f500: "Your gap map. Rows in red are below cohort median; the EVaR column quantifies what's at stake. Pair with /alpha business-case-analyzer for the build/buy decision per row.",
              student: "Concrete worked example of capability benchmarking. Each row links to the capability detail page where you can see how the score and confidence are computed.",
              professor: "Replication-ready scorecard format. The methodology behind EVaR and moat scores is documented at /methodology — assign students to defend a row's gap-closure plan.",
            }}
            className="mt-3"
          />
        </div>
        <div className="flex items-center gap-2">
          {mode === "industry-average" && industries.length > 0 && (
            <select
              value={industryId ?? ""}
              onChange={(e) => { const v = parseInt(e.target.value, 10); setIndustryId(v); load(v); }}
              className="border rounded px-3 py-2 bg-background text-sm"
              data-testid="scorecard-industry-select"
            >
              {industries.map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
            </select>
          )}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as LifecycleStage | "all")}
            className="border rounded px-3 py-2 bg-background text-sm"
            data-testid="scorecard-lifecycle-filter"
            title="Filter capabilities by derived lifecycle stage"
          >
            <option value="all">All lifecycle stages ({matrix.length})</option>
            {LIFECYCLE_STAGES.map((s) => (
              <option key={s} value={s}>{lifecycleLabel(s)} ({stageCounts[s]})</option>
            ))}
          </select>
          <Button onClick={() => load()} disabled={loading} variant="outline"><RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>
      </div>

      {/* Focus banner — deep-linked from /regulations or other pages */}
      {focusedCapabilityIds && (
        <div className="flex items-center justify-between gap-3 p-3 bg-primary/[0.06] border border-primary/30">
          <div className="text-sm">
            Showing remediation priorities for{" "}
            <strong>{focusedSource ?? "the selected source"}</strong> —{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {focusedCapabilityIds.size} {focusedCapabilityIds.size === 1 ? "capability" : "capabilities"}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFocus} className="rounded-none">
            <X className="w-4 h-4 mr-1.5" />
            Clear filter
          </Button>
        </div>
      )}

      {/* Alert Banner */}
      {(criticalAlerts.length > 0 || warningAlerts.length > 0) && (
        <div className="space-y-2">
          {criticalAlerts.map((a, i) => (
            <div key={i} className="rounded-none bg-destructive/10 border border-destructive/30 p-3 space-y-2">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                <span className="text-sm flex-1">{a.message}</span>
                <Badge variant="destructive">Critical</Badge>
              </div>
              {a.capabilityId > 0 && <CapabilityCascadeChip capabilityId={a.capabilityId} />}
            </div>
          ))}
          {warningAlerts.map((a, i) => (
            <div key={i} className="rounded-none bg-amber-500/10 border border-amber-500/30 p-3 space-y-2">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                <span className="text-sm flex-1">{a.message}</span>
                <Badge variant="outline" className="text-amber-500">Warning</Badge>
              </div>
              {a.capabilityId > 0 && <CapabilityCascadeChip capabilityId={a.capabilityId} />}
            </div>
          ))}
        </div>
      )}

      {/* House view — cross-agent synthesis brief grounding remediation priorities */}
      <SynthesisBriefCard compact />

      {/* Move 10c: streaming gap-closure plan based on the user's actual
          scorecard. Pulls the live RED capabilities + EVaR from the server
          and streams a persona-aware build/buy/partner brief. */}
      {industryId !== null && (
        <StreamingBrief
          api="/api/scorecard/stream"
          body={{ industryId, sessionToken }}
          title="Gap-closure plan"
          downloadFilename={`ce-gap-closure-${industryId}`}
          triggerLabel="Generate gap-closure plan"
          showContextField
        />
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Swords className="w-6 h-6 mx-auto mb-2 text-primary" />
            <p className="text-2xl font-bold">{matrix.length}</p>
            <p className="text-xs text-muted-foreground">Capabilities Tracked</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-destructive" />
            <p className="text-2xl font-bold">{criticalAlerts.length}</p>
            <p className="text-xs text-muted-foreground">Critical Alerts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Shield className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
            <p className="text-2xl font-bold">{matrix.filter((m) => (m.gap ?? 0) > 0).length}</p>
            <p className="text-xs text-muted-foreground">Above Benchmark</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <TrendingDown className="w-6 h-6 mx-auto mb-2 text-amber-500" />
            <p className="text-2xl font-bold">{matrix.filter((m) => (m.gap ?? 0) < -10).length}</p>
            <p className="text-xs text-muted-foreground">Significant Gaps</p>
          </CardContent>
        </Card>
      </div>

      {/* Lifecycle stage legend / docs */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="font-serif tracking-tight text-base">Lifecycle stages</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>
            Each capability is tagged with a derived lifecycle stage, computed on every read from its current
            posterior consensus score and EMA velocity (never persisted, never goes stale).{" "}
            <a href="/lifecycle" className="underline hover:text-foreground">Read the full methodology →</a>
          </p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            <div className="flex items-start gap-2"><LifecycleChip stage="emerging" /><span>Score &lt; 40 and velocity ≥ +0.03 — early adopters investing.</span></div>
            <div className="flex items-start gap-2"><LifecycleChip stage="adopted" /><span>Mid-range maturity with positive or neutral momentum.</span></div>
            <div className="flex items-start gap-2"><LifecycleChip stage="mature" /><span>Score ≥ 65 and |velocity| &lt; 0.015 — table stakes.</span></div>
            <div className="flex items-start gap-2"><LifecycleChip stage="decaying" /><span>Velocity ≤ −0.03 at any score — losing relevance.</span></div>
            <div className="flex items-start gap-2"><LifecycleChip stage="obsolete" /><span>Score &lt; 30 and falling — being abandoned.</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Matrix */}
      <Card>
        <CardHeader><CardTitle className="font-serif tracking-tight">Capability Comparison Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm responsive-table">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Capability</th>
                  <th className="text-left py-2 px-2">
                    <button
                      type="button"
                      onClick={() => setSortBy(sortBy === "stage" ? "gap" : "stage")}
                      className={`hover:text-foreground transition-colors ${sortBy === "stage" ? "text-foreground" : ""}`}
                      data-testid="scorecard-sort-stage"
                      title="Click to sort by lifecycle stage"
                    >
                      Stage {sortBy === "stage" ? "▾" : ""}
                    </button>
                  </th>
                  <th className="text-right py-2 px-2">Your Score</th>
                  <th className="text-right py-2 px-2">Benchmark</th>
                  <th className="text-right py-2 px-2">Gap</th>
                  <th className="text-right py-2 px-2">Moat</th>
                  <th className="text-right py-2 px-2" title="Change in consensus score vs 90 days ago">90d Δ</th>
                  <th
                    className="text-right py-2 px-2"
                    title="Forecast: if current 90d velocity continues, when does your score close the gap to benchmark?"
                  >
                    Closes in
                  </th>
                  <th className="text-right py-2 px-2">EVaR 12mo</th>
                  <th className="text-right py-2 px-2">AI Exposure</th>
                  <th className="text-right py-2 px-2">Velocity</th>
                </tr>
              </thead>
              <tbody>
                {sortedByGap.map((row) => (
                  <tr key={row.capabilityId} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">
                      <ConsensusView
                        capabilityId={row.capabilityId}
                        ourScore={row.consensusScore ?? row.benchmark ?? null}
                        precision={0}
                        className="font-medium text-foreground"
                      >
                        {row.capabilityName}
                      </ConsensusView>
                    </td>
                    <td className="py-2 px-2"><LifecycleChip stage={row.lifecycleStage} /></td>
                    <td className="text-right py-2 px-2">
                      {row.myScore !== null ? (
                        <ScoreWithProvenance
                          label={`${row.capabilityName} — Your maturity score`}
                          value={row.myScore}
                          precision={0}
                          model="Self-assessment v1.1"
                          sourceCount={1}
                          side="left"
                        />
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">
                      <ScoreWithProvenance
                        label={`${row.capabilityName} — Industry benchmark`}
                        value={row.benchmark}
                        precision={0}
                        model="Bayesian posterior · v1.1"
                        sourceCount={row.sourceCount}
                        lastUpdatedAt={row.lastUpdatedAt}
                        citations={row.citations}
                        ciLow={row.ciLow}
                        ciHigh={row.ciHigh}
                        sourceBreakdown={row.sourceBreakdown}
                        side="left"
                      />
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.gap !== null ? (
                        <ScoreWithProvenance
                          label={`${row.capabilityName} — Gap vs benchmark`}
                          value={row.gap}
                          precision={0}
                          model="myScore − benchmark"
                          className={row.gap >= 0 ? "text-emerald-500" : "text-destructive"}
                          side="left"
                        >
                          <span>{row.gap >= 0 ? "+" : ""}{row.gap.toFixed(0)}</span>
                        </ScoreWithProvenance>
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.moatScore !== null ? (
                        <ScoreWithProvenance
                          label={`${row.capabilityName} — Moat score`}
                          value={row.moatScore}
                          precision={0}
                          model="Capability defensibility v1.1"
                          sourceCount={row.sourceCount}
                          lastUpdatedAt={row.lastUpdatedAt}
                          citations={row.citations}
                          side="left"
                          className={row.moatScore >= 60 ? "text-emerald-500" : row.moatScore >= 30 ? "text-amber-500" : "text-destructive"}
                        />
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.delta90 !== null ? (
                        <span
                          className={`font-mono tabular-nums text-xs ${
                            row.delta90 >= 5 ? "text-emerald-600 dark:text-emerald-400"
                              : row.delta90 <= -5 ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                          title={`90-day movement in consensus score: ${row.delta90 >= 0 ? "up" : "down"} ${Math.abs(row.delta90).toFixed(1)} points`}
                        >
                          {row.delta90 > 0 ? "+" : ""}{row.delta90.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="text-right py-2 px-2">
                      {(() => {
                        // Already at or above benchmark — nothing to close.
                        if (row.gap === null || row.gap >= 0) {
                          return <span className="text-muted-foreground text-xs">—</span>;
                        }
                        if (row.closesNever) {
                          return (
                            <span
                              className="font-mono tabular-nums text-xs text-destructive"
                              title="Gap is widening or flat at current 90d velocity — projection assumes no acceleration."
                            >
                              never
                            </span>
                          );
                        }
                        if (row.monthsToClose === null) {
                          return <span className="text-muted-foreground text-xs">—</span>;
                        }
                        const m = row.monthsToClose;
                        const eta = new Date(Date.now() + m * 30 * 24 * 60 * 60 * 1000);
                        const etaLabel = eta.toLocaleDateString(undefined, { month: "short", year: "numeric" });
                        // Pick a friendly unit by magnitude so very long projections
                        // don't read as "327mo" — switch to years past 24mo.
                        let display: string;
                        if (m < 1) display = "<1mo";
                        else if (m < 24) display = `${m.toFixed(0)}mo`;
                        else display = `${(m / 12).toFixed(1)}y`;
                        return (
                          <span
                            className={`font-mono tabular-nums text-xs ${m <= 12 ? "text-emerald-600 dark:text-emerald-400" : m <= 36 ? "text-amber-500" : "text-muted-foreground"}`}
                            title={`Projected close: ${etaLabel} (gap ${row.gap.toFixed(1)} pts ÷ 90d velocity ${(row.delta90 ?? 0).toFixed(1)} pts)`}
                          >
                            {display}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.evar12mo !== null ? (
                        <ScoreWithProvenance
                          label={`${row.capabilityName} — EVaR (12 month)`}
                          value={row.evar12mo}
                          precision={1}
                          unit="M"
                          model="Revenue × margin × (1 − 0.5^(12/halfLife))"
                          sourceCount={row.sourceCount}
                          lastUpdatedAt={row.lastUpdatedAt}
                          citations={row.citations}
                          side="left"
                        >
                          <span>${row.evar12mo.toFixed(1)}M</span>
                        </ScoreWithProvenance>
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.aiExposure !== null ? (
                        <ScoreWithProvenance
                          label={`${row.capabilityName} — AI exposure`}
                          value={row.aiExposure}
                          precision={0}
                          unit="%"
                          model="AI disruption model v1.1"
                          sourceCount={row.sourceCount}
                          lastUpdatedAt={row.lastUpdatedAt}
                          citations={row.citations}
                          side="left"
                          className={row.aiExposure > 50 ? "text-destructive" : ""}
                        />
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">
                      <ScoreWithProvenance
                        label={`${row.capabilityName} — Velocity`}
                        value={row.velocity}
                        precision={2}
                        model="Trailing-12mo Δ score / 100"
                        side="left"
                        className={row.velocity > 0 ? "text-emerald-500" : row.velocity < 0 ? "text-destructive" : "text-muted-foreground"}
                      >
                        <span>{row.velocity > 0 ? "+" : ""}{row.velocity.toFixed(2)}</span>
                      </ScoreWithProvenance>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && sortedByGap.length === 0 && (
            <div className="text-center py-12 space-y-4 max-w-md mx-auto">
              <Swords className="w-10 h-10 mx-auto text-muted-foreground/40" />
              <div className="space-y-2">
                <p className="font-serif text-base">
                  {matrix.length === 0
                    ? "This industry doesn't have peer benchmarks yet"
                    : "No maturity scores tracked yet for this industry"}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Upload your organization's capability inventory on <a href="/upload" className="underline">/upload</a> to see your gaps against industry benchmarks. Or pick a different industry above to see one that's already populated.
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                  <a href="/upload" className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-primary bg-primary text-primary-foreground hover:opacity-90">Upload your data</a>
                  <a href="/organization" className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-border hover:bg-muted">Set up your organization</a>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
