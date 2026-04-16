import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Loader2, Zap, TrendingDown, Network, GitCompare, Layers, ShieldAlert, Waves, Users, ArrowRight, RefreshCw, AlertTriangle } from "lucide-react";

const apiBase = import.meta.env.VITE_API_URL || "";

type AlphaStatus = { capabilities: number; capabilitiesEnriched: number; dependencies: number; dependenciesScored: number };

type EvarItem = {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  tamUsdMm: number | null;
  revenueExposureMm: number;
  marginStructurePct: number | null;
  halfLifeMonths: number;
  commoditizationVelocity: number;
  disruptionIntensity: number;
  quadrant: string | null;
  consensusQuadrant: string | null;
  consensusConfidence: number;
  evar12: number;
  evar24: number;
  evar36: number;
  bandPct: number;
  rationale: string | null;
  consensusSummary: string | null;
};
type EvarResponse = { items: EvarItem[]; totals: { totalEvar12: number; totalEvar24: number; totalEvar36: number; count: number } };

type CascadeRoot = { id: number; name: string; industryId: number; dependentCount: number; totalDownstreamImpactMm: number };
type CascadeNode = { id: number; name: string; depth: number; industryId: number };
type CascadeEdge = {
  id: number; fromId: number; toId: number; depth: number;
  disruptionProbability: number | null; timeToImpactMonths: number | null; dollarImpactMm: number | null; rationale: string | null;
};
type CascadeResponse =
  | { roots: CascadeRoot[] }
  | { root: { id: number; name: string }; nodes: CascadeNode[]; edges: CascadeEdge[]; totalExpectedImpactMm: number };

type NarrativeItem = {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  ceQuadrant: string;
  consensusQuadrant: string;
  consensusConfidence: number | null;
  deltaSteps: number;
  direction: "long" | "short";
  consensusSummary: string | null;
  rationale: string | null;
  tamUsdMm: number | null;
  sources: string[] | null;
};

function fmtMoney(mm: number | null | undefined): string {
  if (mm == null) return "—";
  if (Math.abs(mm) >= 1000) return `$${(mm / 1000).toFixed(1)}B`;
  return `$${mm.toFixed(0)}M`;
}

function QuadrantChip({ q }: { q: string | null | undefined }) {
  if (!q) return <span className="text-xs text-zinc-500">—</span>;
  const color = q === "hot" ? "bg-red-500/15 text-red-600 border-red-500/30"
    : q === "emerging" ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
    : q === "cooling" ? "bg-blue-500/15 text-blue-600 border-blue-500/30"
    : "bg-zinc-500/15 text-zinc-600 border-zinc-500/30";
  return <Badge className={`${color} border capitalize text-xs font-medium`} variant="outline">{q.replace("_", " ")}</Badge>;
}

export default function Alpha() {
  const [status, setStatus] = useState<AlphaStatus | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [tab, setTab] = useState("evar");

  async function loadStatus() {
    try {
      const r = await fetch(`${apiBase}/api/alpha/status`);
      if (r.ok) setStatus(await r.json());
    } catch {}
  }
  useEffect(() => { loadStatus(); }, []);

  async function runEnrich(limitCapabilities = 8, limitEdges = 12) {
    setEnriching(true);
    setEnrichMsg("Researching capabilities via Perplexity + synthesizing with GLM…");
    try {
      const r = await fetch(`${apiBase}/api/alpha/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitCapabilities, limitEdges }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "enrich failed");
      setEnrichMsg(`Enriched ${data.capabilitiesEnriched} capabilities, scored ${data.edgesEnriched} edges in ${(data.durationMs / 1000).toFixed(0)}s${data.errors?.length ? ` • ${data.errors.length} errors` : ""}`);
      await loadStatus();
    } catch (e) {
      setEnrichMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEnriching(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 mb-2">
            <Zap className="h-4 w-4" />
            <span className="font-medium tracking-wider uppercase">CE Alpha</span>
          </div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">Capability-level intelligence no one else ships</h1>
          <p className="mt-2 max-w-3xl text-zinc-600 dark:text-zinc-400">
            Seven forward-causal analyses that decompose enterprise value down to the capability — each priced, timed, and tied to a real dependency graph. PitchBook and CBI stop at companies and sectors. We don't.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button onClick={() => runEnrich()} disabled={enriching} size="lg">
            {enriching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run Alpha Enrichment
          </Button>
          {enrichMsg && <p className="text-xs text-zinc-500 max-w-xs text-right">{enrichMsg}</p>}
        </div>
      </div>

      {status && (
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusCard label="Capabilities" value={status.capabilities} />
          <StatusCard label="Economics enriched" value={status.capabilitiesEnriched} accent={status.capabilitiesEnriched > 0} />
          <StatusCard label="Dependency edges" value={status.dependencies} />
          <StatusCard label="Edges scored" value={status.dependenciesScored} accent={status.dependenciesScored > 0} />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid grid-cols-4 md:grid-cols-7 mb-6 h-auto">
          <TabsTrigger value="evar" className="flex flex-col items-center gap-1 py-2"><TrendingDown className="h-4 w-4" /><span className="text-[11px]">EVaR</span></TabsTrigger>
          <TabsTrigger value="cascade" className="flex flex-col items-center gap-1 py-2"><Network className="h-4 w-4" /><span className="text-[11px]">Cascade</span></TabsTrigger>
          <TabsTrigger value="narrative" className="flex flex-col items-center gap-1 py-2"><GitCompare className="h-4 w-4" /><span className="text-[11px]">Narrative Δ</span></TabsTrigger>
          <TabsTrigger value="arbitrage" className="flex flex-col items-center gap-1 py-2"><Layers className="h-4 w-4" /><span className="text-[11px]">Arbitrage</span></TabsTrigger>
          <TabsTrigger value="fragility" className="flex flex-col items-center gap-1 py-2"><ShieldAlert className="h-4 w-4" /><span className="text-[11px]">Fragility</span></TabsTrigger>
          <TabsTrigger value="flows" className="flex flex-col items-center gap-1 py-2"><Waves className="h-4 w-4" /><span className="text-[11px]">Flows</span></TabsTrigger>
          <TabsTrigger value="talent" className="flex flex-col items-center gap-1 py-2"><Users className="h-4 w-4" /><span className="text-[11px]">Talent</span></TabsTrigger>
        </TabsList>

        <TabsContent value="evar"><EvarTab /></TabsContent>
        <TabsContent value="cascade"><CascadeTab /></TabsContent>
        <TabsContent value="narrative"><NarrativeTab /></TabsContent>
        <TabsContent value="arbitrage"><StubTab title="Capability Arbitrage Map" desc="Capabilities where our consensus-adjusted EVaR diverges from market pricing. Comes online after EVaR enrichment completes for all tracked industries." method={[
          "Cross-reference EVaR output with public comparables (SaaS multiples, VC round data).",
          "Flag capabilities where implied valuation ≠ cashflow-at-risk.",
          "Rank long/short pairs by Sharpe-adjusted spread.",
        ]} needsEnrichment /></TabsContent>
        <TabsContent value="fragility"><StubTab title="Capability Fragility Scorecard" desc="A stress-test score per capability combining concentration risk, dependency depth, and supply-chain single-points-of-failure." method={[
          "Compute blast-radius from Cascade DAG (upstream + downstream).",
          "Add supplier concentration (HHI) and geographic concentration.",
          "Produce 0–100 fragility score with 3 worst-case scenarios.",
        ]} needsEnrichment /></TabsContent>
        <TabsContent value="flows"><StubTab title="Capability Flow Sankey" desc="Where capital and demand are flowing between capabilities quarter-over-quarter. Requires Talent + Funding ingest layer." method={[
          "Ingest VC round data tagged by capability (already partly loaded).",
          "Ingest hiring deltas from public jobs boards.",
          "Render Sankey: capital → capability → industry.",
        ]} needsEnrichment /></TabsContent>
        <TabsContent value="talent"><StubTab title="Talent Chain" desc="Which talent clusters feed which capabilities and where the bottlenecks are." method={[
          "Map LinkedIn / GitHub talent density to capabilities.",
          "Compute supply/demand ratio per capability per geography.",
          "Surface bottleneck capabilities where demand > 3× supply.",
        ]} needsEnrichment /></TabsContent>
      </Tabs>
    </div>
  );
}

function StatusCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card className={accent ? "border-emerald-500/40" : ""}>
      <CardContent className="p-4">
        <div className="text-xs text-zinc-500 uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${accent ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-100"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

/* ============================= EVaR ============================= */
function EvarTab() {
  const [data, setData] = useState<EvarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [halfLifeAdj, setHalfLifeAdj] = useState(1);
  const [velocityAdj, setVelocityAdj] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/alpha/evar`);
        if (r.ok) {
          const d = await r.json() as EvarResponse;
          setData(d);
          if (d.items[0]) setSelectedId(d.items[0].capabilityId);
        }
      } finally { setLoading(false); }
    })();
  }, []);

  const selected = useMemo(() => data?.items.find(x => x.capabilityId === selectedId) ?? null, [data, selectedId]);

  const curve = useMemo(() => {
    if (!selected) return [] as { month: number; evar: number; low: number; high: number }[];
    const pts: { month: number; evar: number; low: number; high: number }[] = [];
    const halfLife = Math.max(6, (selected.halfLifeMonths ?? 36) * halfLifeAdj);
    const velocity = Math.min(1, (selected.commoditizationVelocity ?? 0.2) * velocityAdj);
    const revenue = selected.revenueExposureMm;
    const margin = (selected.marginStructurePct ?? 40) / 100;
    const band = selected.bandPct;
    for (let m = 0; m <= 48; m += 3) {
      const halfLifeDecay = 1 - Math.pow(0.5, m / halfLife);
      const marketErosion = 1 - Math.pow(1 - Math.min(0.95, velocity * (0.6 + selected.disruptionIntensity * 0.8)), m / 12);
      const frac = Math.max(halfLifeDecay, marketErosion);
      const evar = revenue * margin * frac;
      pts.push({ month: m, evar, low: evar * (1 - band), high: evar * (1 + band) });
    }
    return pts;
  }, [selected, halfLifeAdj, velocityAdj]);

  if (loading) return <div className="flex items-center gap-2 text-zinc-500 p-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading EVaR…</div>;
  if (!data || data.items.length === 0) {
    return <EmptyPrompt title="No EVaR data yet" msg="Run Alpha Enrichment to compute per-capability revenue-at-risk curves." />;
  }

  const maxEvar = Math.max(...curve.map(p => p.high), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-zinc-500 uppercase">Total EVaR @ 12mo</div>
          <div className="text-xl font-bold mt-1">{fmtMoney(data.totals.totalEvar12)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-zinc-500 uppercase">Total EVaR @ 24mo</div>
          <div className="text-xl font-bold mt-1 text-amber-600">{fmtMoney(data.totals.totalEvar24)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-zinc-500 uppercase">Total EVaR @ 36mo</div>
          <div className="text-xl font-bold mt-1 text-red-600">{fmtMoney(data.totals.totalEvar36)}</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Ranked by 36-month $ at risk</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b">
                  <tr className="text-left text-xs uppercase text-zinc-500">
                    <th className="py-2 px-3">Capability</th>
                    <th className="py-2 px-2">Industry</th>
                    <th className="py-2 px-2 text-right">EVaR 12mo</th>
                    <th className="py-2 px-2 text-right">EVaR 36mo</th>
                    <th className="py-2 px-2">Quadrant</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(it => (
                    <tr key={it.capabilityId}
                        className={`border-b cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 ${selectedId === it.capabilityId ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
                        onClick={() => setSelectedId(it.capabilityId)}>
                      <td className="py-2 px-3 font-medium">{it.capabilityName}</td>
                      <td className="py-2 px-2 text-zinc-500 text-xs">{it.industryName}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtMoney(it.evar12)}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold text-red-600">{fmtMoney(it.evar36)}</td>
                      <td className="py-2 px-2"><QuadrantChip q={it.quadrant} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base truncate">{selected?.capabilityName ?? "Select a capability"}</CardTitle>
            <div className="text-xs text-zinc-500">{selected?.industryName}</div>
          </CardHeader>
          <CardContent>
            {selected ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-zinc-500">Revenue exposure:</span> <span className="font-medium">{fmtMoney(selected.revenueExposureMm)}</span></div>
                  <div><span className="text-zinc-500">Margin:</span> <span className="font-medium">{selected.marginStructurePct?.toFixed(0) ?? "—"}%</span></div>
                  <div><span className="text-zinc-500">Half-life:</span> <span className="font-medium">{Math.round(selected.halfLifeMonths * halfLifeAdj)}mo</span></div>
                  <div><span className="text-zinc-500">Velocity:</span> <span className="font-medium">{((selected.commoditizationVelocity ?? 0) * velocityAdj * 100).toFixed(0)}%/yr</span></div>
                </div>
                <EvarSparkline curve={curve} maxEvar={maxEvar} />
                <div className="mt-4 space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span>Half-life adjustment</span><span className="tabular-nums">{halfLifeAdj.toFixed(2)}×</span></div>
                    <Slider value={[halfLifeAdj]} min={0.5} max={2} step={0.05} onValueChange={(v: number[]) => setHalfLifeAdj(v[0])} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span>Commoditization velocity</span><span className="tabular-nums">{velocityAdj.toFixed(2)}×</span></div>
                    <Slider value={[velocityAdj]} min={0.5} max={2} step={0.05} onValueChange={(v: number[]) => setVelocityAdj(v[0])} />
                  </div>
                </div>
                {selected.rationale && <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400 italic border-l-2 border-amber-500/50 pl-3">{selected.rationale}</p>}
              </>
            ) : <div className="text-zinc-400 text-sm">Pick a row to see its decay curve.</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EvarSparkline({ curve, maxEvar }: { curve: { month: number; evar: number; low: number; high: number }[]; maxEvar: number }) {
  const w = 360, h = 160, pad = 20;
  const xs = (m: number) => pad + (m / 48) * (w - 2 * pad);
  const ys = (v: number) => h - pad - (v / maxEvar) * (h - 2 * pad);
  const bandPath = `M ${curve.map(p => `${xs(p.month)},${ys(p.high)}`).join(" L ")} L ${curve.slice().reverse().map(p => `${xs(p.month)},${ys(p.low)}`).join(" L ")} Z`;
  const linePath = `M ${curve.map(p => `${xs(p.month)},${ys(p.evar)}`).join(" L ")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" />
      <path d={bandPath} className="fill-amber-400/20" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600" />
      {[12, 24, 36].map(m => (
        <g key={m}>
          <line x1={xs(m)} y1={h - pad} x2={xs(m)} y2={pad} stroke="currentColor" strokeDasharray="2 3" className="text-zinc-400/40" />
          <text x={xs(m)} y={h - 4} textAnchor="middle" className="fill-zinc-500 text-[9px]">{m}mo</text>
        </g>
      ))}
    </svg>
  );
}

/* ============================= Cascade DAG ============================= */
function CascadeTab() {
  const [roots, setRoots] = useState<CascadeRoot[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cascade, setCascade] = useState<{ root: { id: number; name: string }; nodes: CascadeNode[]; edges: CascadeEdge[]; totalExpectedImpactMm: number } | null>(null);
  const [horizon, setHorizon] = useState(36);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/alpha/cascade`);
        if (r.ok) {
          const d = await r.json() as CascadeResponse;
          if ("roots" in d) {
            setRoots(d.roots);
            if (d.roots[0]) setSelectedId(d.roots[0].id);
          }
        }
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      const r = await fetch(`${apiBase}/api/alpha/cascade?capabilityId=${selectedId}&depth=3`);
      if (r.ok) {
        const d = await r.json() as CascadeResponse;
        if ("root" in d) setCascade(d);
      }
    })();
  }, [selectedId]);

  if (loading) return <div className="flex items-center gap-2 text-zinc-500 p-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading cascade graph…</div>;
  if (!roots || roots.length === 0) {
    return <EmptyPrompt title="No cascade data yet" msg="Dependency edges need scoring. Run Alpha Enrichment." />;
  }

  const visibleEdges = cascade?.edges.filter(e => (e.timeToImpactMonths ?? 99) <= horizon) ?? [];
  const visibleNodeIds = new Set<number>();
  if (cascade) {
    visibleNodeIds.add(cascade.root.id);
    visibleEdges.forEach(e => { visibleNodeIds.add(e.fromId); visibleNodeIds.add(e.toId); });
  }
  const visibleNodes = cascade?.nodes.filter(n => visibleNodeIds.has(n.id)) ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Blast radius leaders</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[520px] overflow-auto">
            {roots.map(r => (
              <button key={r.id} onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-4 py-2 border-b hover:bg-zinc-50 dark:hover:bg-zinc-900 ${selectedId === r.id ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs tabular-nums text-red-600 font-semibold whitespace-nowrap">{fmtMoney(r.totalDownstreamImpactMm)}</div>
                </div>
                <div className="text-xs text-zinc-500">{r.dependentCount} dependents</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Cascade from {cascade?.root.name ?? "…"}</CardTitle>
              {cascade && <div className="text-xs text-zinc-500 mt-1">Expected downstream impact: <span className="font-semibold text-red-600">{fmtMoney(cascade.totalExpectedImpactMm)}</span></div>}
            </div>
            <div className="w-40">
              <div className="flex justify-between text-xs mb-1"><span>Horizon</span><span className="tabular-nums">{horizon}mo</span></div>
              <Slider value={[horizon]} min={6} max={48} step={3} onValueChange={(v: number[]) => setHorizon(v[0])} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {cascade ? <CascadeGraph nodes={visibleNodes} edges={visibleEdges} rootId={cascade.root.id} /> : <div className="text-zinc-400 text-sm p-8">Select a root capability…</div>}
          {visibleEdges.length > 0 && (
            <div className="mt-4 max-h-48 overflow-auto text-xs space-y-1 border-t pt-2">
              {visibleEdges.slice(0, 10).map(e => {
                const from = visibleNodes.find(n => n.id === e.fromId);
                const to = visibleNodes.find(n => n.id === e.toId);
                return (
                  <div key={e.id} className="flex items-center gap-2 py-1">
                    <span className="font-medium truncate max-w-[120px]">{from?.name}</span>
                    <ArrowRight className="h-3 w-3 text-zinc-400" />
                    <span className="font-medium truncate max-w-[120px]">{to?.name}</span>
                    <span className="text-zinc-500">p={((e.disruptionProbability ?? 0) * 100).toFixed(0)}%</span>
                    <span className="text-zinc-500">{e.timeToImpactMonths}mo</span>
                    <span className="ml-auto tabular-nums font-semibold text-red-600">{fmtMoney(e.dollarImpactMm)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CascadeGraph({ nodes, edges, rootId }: { nodes: CascadeNode[]; edges: CascadeEdge[]; rootId: number }) {
  const w = 600, h = 360;
  const depths = Array.from(new Set(nodes.map(n => n.depth))).sort((a, b) => a - b);
  const byDepth = new Map<number, CascadeNode[]>();
  depths.forEach(d => byDepth.set(d, nodes.filter(n => n.depth === d)));

  const pos = new Map<number, { x: number; y: number }>();
  depths.forEach(d => {
    const ns = byDepth.get(d)!;
    const x = 60 + d * ((w - 120) / Math.max(1, depths.length - 1 || 1));
    ns.forEach((n, i) => {
      const y = 40 + (i + 1) * ((h - 80) / (ns.length + 1));
      pos.set(n.id, { x, y });
    });
  });

  const maxImpact = Math.max(1, ...edges.map(e => e.dollarImpactMm ?? 0));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 380 }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-zinc-400" />
        </marker>
      </defs>
      {edges.map(e => {
        const from = pos.get(e.fromId); const to = pos.get(e.toId);
        if (!from || !to) return null;
        const strokeW = 1 + 3 * ((e.dollarImpactMm ?? 0) / maxImpact);
        const prob = e.disruptionProbability ?? 0.3;
        const color = prob > 0.6 ? "stroke-red-500" : prob > 0.35 ? "stroke-amber-500" : "stroke-zinc-400";
        return (
          <g key={e.id}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={color} strokeWidth={strokeW} strokeOpacity={0.7} markerEnd="url(#arrow)" />
            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4} textAnchor="middle" className="fill-zinc-600 dark:fill-zinc-400 text-[9px]">
              {fmtMoney(e.dollarImpactMm)}
            </text>
          </g>
        );
      })}
      {nodes.map(n => {
        const p = pos.get(n.id)!;
        const isRoot = n.id === rootId;
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={isRoot ? 10 : 6} className={isRoot ? "fill-amber-500 stroke-amber-700" : "fill-zinc-700 stroke-zinc-900 dark:fill-zinc-300 dark:stroke-zinc-100"} strokeWidth="1.5" />
            <text x={p.x} y={p.y - 14} textAnchor="middle" className="fill-zinc-800 dark:fill-zinc-200 text-[10px] font-medium">
              {n.name.length > 22 ? n.name.slice(0, 20) + "…" : n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ============================= Narrative Delta ============================= */
function NarrativeTab() {
  const [items, setItems] = useState<NarrativeItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/alpha/narrative-delta`);
        if (r.ok) { const d = await r.json(); setItems(d.items); }
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-zinc-500 p-8"><Loader2 className="h-4 w-4 animate-spin" /> Scanning for narrative divergence…</div>;
  if (!items || items.length === 0) {
    return <EmptyPrompt title="No disagreements yet" msg="Once enrichment compares our CE quadrant to street consensus, divergences show here as long/short signals." />;
  }

  const longs = items.filter(i => i.direction === "long");
  const shorts = items.filter(i => i.direction === "short");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <NarrativeColumn title="We're bullish, street isn't" subtitle="Long signals" items={longs} color="emerald" />
      <NarrativeColumn title="We're bearish, street isn't" subtitle="Short signals" items={shorts} color="red" />
    </div>
  );
}

function NarrativeColumn({ title, subtitle, items, color }: { title: string; subtitle: string; items: NarrativeItem[]; color: "emerald" | "red" }) {
  const accent = color === "emerald" ? "text-emerald-600 border-emerald-500/40" : "text-red-600 border-red-500/40";
  return (
    <Card className={`border ${accent}`}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="text-xs text-zinc-500 uppercase tracking-wide">{subtitle} • {items.length}</div>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[600px] overflow-auto">
        {items.length === 0 && <div className="text-xs text-zinc-400">No signals.</div>}
        {items.map(it => (
          <div key={it.capabilityId} className="border rounded-md p-3">
            <div className="flex justify-between items-start gap-2 mb-1">
              <div>
                <div className="font-semibold text-sm">{it.capabilityName}</div>
                <div className="text-xs text-zinc-500">{it.industryName}</div>
              </div>
              <div className={`text-xs font-bold ${accent}`}>{Math.abs(it.deltaSteps)}-step Δ</div>
            </div>
            <div className="flex items-center gap-2 text-xs mb-2">
              <span className="text-zinc-500">CE:</span><QuadrantChip q={it.ceQuadrant} />
              <ArrowRight className="h-3 w-3 text-zinc-400" />
              <span className="text-zinc-500">Street:</span><QuadrantChip q={it.consensusQuadrant} />
            </div>
            {it.consensusSummary && <p className="text-xs text-zinc-600 dark:text-zinc-400 italic mb-2">"{it.consensusSummary}"</p>}
            {it.rationale && <p className="text-xs text-zinc-700 dark:text-zinc-300">{it.rationale}</p>}
            {it.sources && it.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {it.sources.slice(0, 3).map((s, i) => {
                  let host = s;
                  try { host = new URL(s).hostname; } catch { host = s.substring(0, 40); }
                  return <a key={i} href={s} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline truncate max-w-[160px]">{host}</a>;
                })}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ============================= Stubs ============================= */
function StubTab({ title, desc, method, needsEnrichment }: { title: string; desc: string; method: string[]; needsEnrichment?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{desc}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Methodology</div>
        <ol className="text-sm space-y-1.5 list-decimal pl-5 text-zinc-700 dark:text-zinc-300">
          {method.map((m, i) => <li key={i}>{m}</li>)}
        </ol>
        {needsEnrichment && (
          <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3" />
            Unlocked after EVaR + Cascade enrichment completes for tracked industries.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyPrompt({ title, msg }: { title: string; msg: string }) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <div className="mx-auto w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center mb-3">
          <Zap className="h-5 w-5 text-amber-600" />
        </div>
        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
        <p className="text-sm text-zinc-500 mt-1">{msg}</p>
      </CardContent>
    </Card>
  );
}
