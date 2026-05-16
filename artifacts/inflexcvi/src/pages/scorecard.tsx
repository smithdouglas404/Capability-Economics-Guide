import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Swords, AlertTriangle, Shield, Brain, TrendingDown, RefreshCw } from "lucide-react";
import { LifecycleChip, LIFECYCLE_STAGES, lifecycleLabel, type LifecycleStage } from "@/components/lifecycle-chip";
import { ScoreWithProvenance } from "@/components/score-with-provenance";

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

  const filteredMatrix = stageFilter === "all" ? matrix : matrix.filter((m) => m.lifecycleStage === stageFilter);
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

      {/* Alert Banner */}
      {(criticalAlerts.length > 0 || warningAlerts.length > 0) && (
        <div className="space-y-2">
          {criticalAlerts.map((a, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-none bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <span className="text-sm">{a.message}</span>
              <Badge variant="destructive" className="ml-auto">Critical</Badge>
            </div>
          ))}
          {warningAlerts.map((a, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-none bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <span className="text-sm">{a.message}</span>
              <Badge variant="outline" className="ml-auto text-amber-500">Warning</Badge>
            </div>
          ))}
        </div>
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
                  <th className="text-right py-2 px-2">EVaR 12mo</th>
                  <th className="text-right py-2 px-2">AI Exposure</th>
                  <th className="text-right py-2 px-2">Velocity</th>
                </tr>
              </thead>
              <tbody>
                {sortedByGap.map((row) => (
                  <tr key={row.capabilityId} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{row.capabilityName}</td>
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
            <p className="text-center text-muted-foreground py-8">
              {matrix.length === 0
                ? "No reference organizations seeded for this industry yet."
                : "Capabilities are tracked for this industry but no maturity scores are available yet."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
