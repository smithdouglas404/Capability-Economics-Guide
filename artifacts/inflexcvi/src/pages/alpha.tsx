import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Loader2, Zap, TrendingDown, Network, GitCompare, Layers, ShieldAlert, Waves, Users, ArrowRight, RefreshCw, Shield, FileText, GitMerge, BookOpen, ExternalLink, Info } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SavedViewsMenu } from "@/components/saved-views-menu";
import { useSavedView } from "@/hooks/use-saved-view";
import { PersonaDescription } from "@/components/page-header";

type AlphaViewState = { tab: string };

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
type EvarResponse = { items: EvarItem[]; totals: { totalEvar12: number; totalEvar24: number; totalEvar36: number; count: number }; coverage: { scored: number; totalCapabilities: number } };

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
  if (!q) return <span className="text-xs text-muted-foreground">—</span>;
  const color = q === "hot" ? "bg-red-500/15 text-red-600 border-red-500/30"
    : q === "emerging" ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
    : q === "cooling" ? "bg-blue-500/15 text-blue-600 border-blue-500/30"
    : "bg-muted/40 text-muted-foreground border-border/40";
  return <Badge className={`${color} border capitalize text-xs font-medium`} variant="outline">{q.replace("_", " ")}</Badge>;
}

export default function Alpha() {
  const [status, setStatus] = useState<AlphaStatus | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [tab, setTab] = useState("evar");
  const viewsApi = useSavedView<AlphaViewState>("alpha");
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [defaultApplied, setDefaultApplied] = useState(false);
  useEffect(() => {
    if (defaultApplied || !viewsApi.ready) return;
    if (viewsApi.defaultView) {
      const s = viewsApi.defaultView.stateJson;
      if (typeof s.tab === "string") setTab(s.tab);
      setActiveViewId(viewsApi.defaultView.id);
    }
    setDefaultApplied(true);
  }, [viewsApi.ready, viewsApi.defaultView, defaultApplied]);

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
          <h1 className="font-serif text-3xl tracking-tight text-foreground">Capability-level intelligence no one else ships</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Seven forward-causal analyses that decompose enterprise value down to the capability — each priced, timed, and tied to a real dependency graph. PitchBook and CBI stop at companies and sectors. We don't.
          </p>
          <PersonaDescription
            descriptions={{
              default: "Browse the seven tabs; each answers one question PitchBook can't (capital-flow per capability, business-case ROI, EV/CVI sensitivity, etc.).",
              pe: "Sizing the wedge. Capital-flow per capability tells you where the dollars are landing; business-case-analyzer turns a capability gap into a NPV with an IRR band — the exact number your model needs.",
              vc: "Where to invest next. The EV/CVI sensitivity tab shows which capabilities most move enterprise value when scores tick up — your next investment thesis is one of the top movers.",
              f500: "Strategic capex prioritization. Pick a capability you're behind on, read the business-case for closing it, see capital-flow telling you whether you're catching a wave or chasing one.",
              student: "The seven tabs are seven worked examples of capability-level financial reasoning. The capital-flow chart is the easiest to start with — it's just a sum of cited $ figures grouped by value-chain stage.",
              professor: "Replicable forward-causal analyses with cited methodology. The business-case-analyzer is a ready-to-assign capstone (give students an industry + capability, let them defend an NPV).",
            }}
            className="mt-3"
          />
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2 items-center">
            <SavedViewsMenu
              viewsApi={viewsApi}
              currentState={{ tab }}
              onApply={(s, id) => { if (s && typeof s.tab === "string") setTab(s.tab); setActiveViewId(id); }}
              activeViewId={activeViewId}
            />
            <TraceabilityDialog />
            <Button onClick={() => runEnrich(58, 30)} disabled={enriching} size="lg">
              {enriching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Run Alpha Enrichment
            </Button>
          </div>
          {enrichMsg && <p className="text-xs text-muted-foreground max-w-xs text-right">{enrichMsg}</p>}
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
        <TabsList className="grid grid-cols-5 md:grid-cols-10 mb-6 h-auto">
          <TabsTrigger value="evar" className="flex flex-col items-center gap-1 py-2"><TrendingDown className="h-4 w-4" /><span className="text-[10px]">EVaR</span></TabsTrigger>
          <TabsTrigger value="cascade" className="flex flex-col items-center gap-1 py-2"><Network className="h-4 w-4" /><span className="text-[10px]">Dep. Impact</span></TabsTrigger>
          <TabsTrigger value="narrative" className="flex flex-col items-center gap-1 py-2"><GitCompare className="h-4 w-4" /><span className="text-[10px]">Narrative Gap</span></TabsTrigger>
          <TabsTrigger value="moat" className="flex flex-col items-center gap-1 py-2"><Shield className="h-4 w-4" /><span className="text-[10px]">Moat</span></TabsTrigger>
          <TabsTrigger value="fragility" className="flex flex-col items-center gap-1 py-2"><ShieldAlert className="h-4 w-4" /><span className="text-[10px]">Fragility</span></TabsTrigger>
          <TabsTrigger value="arbitrage" className="flex flex-col items-center gap-1 py-2"><Layers className="h-4 w-4" /><span className="text-[10px]">Arbitrage</span></TabsTrigger>
          <TabsTrigger value="flows" className="flex flex-col items-center gap-1 py-2"><Waves className="h-4 w-4" /><span className="text-[10px]">Capital/Talent</span></TabsTrigger>
          <TabsTrigger value="talent" className="flex flex-col items-center gap-1 py-2"><Users className="h-4 w-4" /><span className="text-[10px]">Talent</span></TabsTrigger>
          <TabsTrigger value="twin" className="flex flex-col items-center gap-1 py-2"><GitMerge className="h-4 w-4" /><span className="text-[10px]">M&A Targets</span></TabsTrigger>
          <TabsTrigger value="thesis" className="flex flex-col items-center gap-1 py-2"><FileText className="h-4 w-4" /><span className="text-[10px]">Thesis</span></TabsTrigger>
        </TabsList>

        <TabsContent value="evar"><EvarTab /></TabsContent>
        <TabsContent value="cascade"><CascadeTab /></TabsContent>
        <TabsContent value="narrative"><NarrativeTab /></TabsContent>
        <TabsContent value="moat"><MoatTab /></TabsContent>
        <TabsContent value="fragility"><FragilityTab /></TabsContent>
        <TabsContent value="arbitrage"><ArbitrageTab /></TabsContent>
        <TabsContent value="flows"><FlowsTab /></TabsContent>
        <TabsContent value="talent"><TalentTab /></TabsContent>
        <TabsContent value="twin"><TwinTab /></TabsContent>
        <TabsContent value="thesis"><ThesisTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================= Traceability ============================= */
function TraceabilityDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg">
          <BookOpen className="h-4 w-4 mr-2" />Traceability
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Methodology & Source Traceability</DialogTitle>
          <DialogDescription>
            Every number on this page comes from one of two sources: (1) the Inflexcvi research pipeline — triangulated across multiple research sources with cited URLs, then synthesized into structured economic figures, OR (2) deterministic math over the values in (1). Capabilities without enrichment are excluded — no defaults are filled in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <Section title="Per-row sourcing">
            Click the <Info className="inline h-3 w-3" /> icon next to any enriched row in Moat, Fragility, or Arbitrage to see the synthesized rationale and the underlying citation URLs for that specific capability.
          </Section>
          <Section title="EVaR — Expected Value at Risk">
            <code className="block bg-muted/50 p-2 rounded text-xs">
              EVaR(t) = revenueExposure × margin × max(halfLifeDecay(t), marketErosion(t))<br/>
              halfLifeDecay(t) = 1 − 0.5^(t / halfLifeMonths)<br/>
              marketErosion(t) = 1 − (1 − velocity × (0.6 + 0.8 × disruptionIntensity))^(t / 12)
            </code>
            Inputs: <code>revenueExposure</code>, <code>margin</code>, <code>halfLifeMonths</code>, <code>commoditizationVelocity</code>, <code>disruptionIntensity</code> — all from Perplexity-cited research, parsed by GLM into a typed JSON object stored in <code>capability_economics</code>.
          </Section>
          <Section title="Moat Score">
            <code className="block bg-muted/50 p-2 rounded text-xs">
              moat = 0.30·halfLifeC + 0.25·depthC + 0.20·economicImpactC + 0.15·stickinessC + 0.10·concentrationC
            </code>
            Components missing in the data are dropped and the remaining weights are renormalized — no zero defaults. Tier: ≥70 fortress, ≥50 defensible, ≥30 contestable, else exposed.
          </Section>
          <Section title="Fragility Score">
            <code className="block bg-muted/50 p-2 rounded text-xs">
              fragility = 0.25·decaySpeed + 0.20·upstreamDepth + 0.15·supplierConc + 0.25·edgeShock + 0.15·disruptionPressure<br/>
              edgeShock = min(100, max(expectedImpact / revenueExposure) × 100)<br/>
              expectedImpact = dollarImpactMm × disruptionProbability   (per upstream edge, GLM-scored)
            </code>
            Edge shock is null when no upstream edge has been GLM-priced for that capability — it does not silently become 0.
          </Section>
          <Section title="Arbitrage — long/short signal">
            <code className="block bg-muted/50 p-2 rounded text-xs">
              ceValue   = revenueExposure × margin × QUADRANT_MULTIPLE[ceQuadrant]<br/>
              consensus = revenueExposure × margin × QUADRANT_MULTIPLE[consensusQuadrant]<br/>
              spread    = ceValue − consensus<br/>
              <br/>
              Multiples (annual margin → enterprise-value-equivalent):<br/>
              {"  hot=15×   emerging=10×   cooling=7×   table_stakes=4×   declining=1×"}<br/>
              <br/>
              direction = spread &gt; 10% &amp; conf ≥ 0.55 → long<br/>
              direction = spread &lt; −10% &amp; conf ≥ 0.55 → short<br/>
              else → neutral (low-confidence street view, no actionable disagreement)
            </code>
            Replaces an earlier arbitrary <code>$8M × FEVI × strength</code> proxy. The new formula compares two quadrant-implied valuations of the same cash-flow stream — when CE and street disagree on quadrant, that disagreement gets dollar-priced.
          </Section>
          <Section title="Capital Flows">
            Sums <code>capital_flow_mm</code> over only the value-chain stages where it is non-null. Stages without a cited capital figure are excluded from totals — never coerced to 0.
          </Section>
          <Section title="Talent Chain">
            Per capability: <code>bottleneckScore = min(100, companies × 4) × (1 − coreCount/companies)</code>. Built from <code>company_capability_mappings</code> — only counts real mappings; capabilities without any mappings simply don't appear.
          </Section>
          <Section title="M&amp;A Twin">
            Capability names matched across two industries via token overlap coefficient ≥ 0.5. Synergy = 10% of the smaller side's revenue exposure — but only when BOTH sides have GLM-enriched revenue figures. Otherwise the row appears with synergy = "—" and a clash flag if the two industries' quadrants for that capability disagree.
          </Section>
          <Section title="Thesis Memo">
            7-section investment memo synthesized by GLM-5.1 (z-ai/glm-5.1 via OpenRouter) from the capability's full Alpha record (economics + quadrant + dependencies + edge scores + cited sources). Markdown rendered as-is, no post-processing.
          </Section>
          <Section title="Data sources">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Perplexity sonar</strong> — grounded research with citation URLs, captured into <code>capability_economics.sources</code> jsonb.</li>
              <li><strong>GLM-5.1 (OpenRouter)</strong> — strict-JSON synthesis of Perplexity prose into typed numeric fields with rationale.</li>
              <li><strong>Internal graph</strong> — <code>capabilities</code>, <code>capability_dependencies</code>, <code>company_capability_mappings</code>, <code>value_chain_stages</code> (seeded from public registries).</li>
            </ul>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}

function SourcesPopover({ rationale, sources }: { rationale?: string | null; sources?: string[] | null }) {
  if (!rationale && !(sources && sources.length)) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground/60 hover:text-amber-600" aria-label="Show sources" onClick={e => e.stopPropagation()}>
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-80 overflow-y-auto text-xs">
        {rationale && (
          <div className="mb-2">
            <div className="font-semibold text-foreground mb-1">GLM rationale</div>
            <p className="text-muted-foreground italic">{rationale}</p>
          </div>
        )}
        {sources && sources.length > 0 && (
          <div>
            <div className="font-semibold text-foreground mb-1">Perplexity sources</div>
            <ul className="space-y-1">
              {sources.slice(0, 12).map((s, i) => (
                <li key={i}>
                  <a href={s} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline inline-flex items-center gap-1 break-all">
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{s.replace(/^https?:\/\//, "")}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CoverageBadge({ scored, total, unit = "capabilities" }: { scored: number; total: number; unit?: string }) {
  const pct = total > 0 ? Math.round((scored / total) * 100) : 0;
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {scored} of {total} {unit} enriched ({pct}%)
    </Badge>
  );
}

function StatusCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card className={accent ? "border-emerald-500/40" : ""}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${accent ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{value}</div>
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

  // We only render the EVaR curve when ALL required fields are present on the
  // selected capability. Previously the code defaulted halfLife→36, velocity→
  // 0.2, margin→0.4 — those silent fallbacks made an underspecified row LOOK
  // like real EVaR data (PLAN.md item #6). Now we return null and the render
  // side shows a "data unavailable" message.
  const curve = useMemo(() => {
    if (!selected) return [] as { month: number; evar: number; low: number; high: number }[];
    if (selected.halfLifeMonths == null
        || selected.commoditizationVelocity == null
        || selected.marginStructurePct == null
        || selected.revenueExposureMm == null) {
      return null;
    }
    const pts: { month: number; evar: number; low: number; high: number }[] = [];
    const halfLife = Math.max(6, selected.halfLifeMonths * halfLifeAdj);
    const velocity = Math.min(1, selected.commoditizationVelocity * velocityAdj);
    const revenue = selected.revenueExposureMm;
    const margin = selected.marginStructurePct / 100;
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

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading EVaR…</div>;
  if (!data || data.items.length === 0) {
    return <EmptyPrompt title="No EVaR data yet" msg="Run Alpha Enrichment to compute per-capability revenue-at-risk curves." />;
  }

  // curve === null means the selected capability is missing required fields;
  // we render a "data unavailable" panel instead of an invented chart.
  const maxEvar = curve && curve.length > 0 ? Math.max(...curve.map(p => p.high), 1) : 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CoverageBadge scored={data.coverage.scored} total={data.coverage.totalCapabilities} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Total EVaR @ 12mo</div>
          <div className="text-xl font-bold mt-1">{fmtMoney(data.totals.totalEvar12)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Total EVaR @ 24mo</div>
          <div className="text-xl font-bold mt-1 text-amber-600">{fmtMoney(data.totals.totalEvar24)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase">Total EVaR @ 36mo</div>
          <div className="text-xl font-bold mt-1 text-red-600">{fmtMoney(data.totals.totalEvar36)}</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Ranked by 36-month $ at risk</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[480px] overflow-auto">
              <div className="w-full overflow-x-auto"><table className="w-full text-sm responsive-table">
                <thead className="sticky top-0 bg-muted/30 border-b">
                  <tr className="text-left text-xs uppercase text-muted-foreground">
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
                        className={`border-b cursor-pointer hover:bg-muted/30 ${selectedId === it.capabilityId ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}
                        onClick={() => setSelectedId(it.capabilityId)}>
                      <td className="py-2 px-3 font-medium">{it.capabilityName}</td>
                      <td className="py-2 px-2 text-muted-foreground text-xs">{it.industryName}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtMoney(it.evar12)}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold text-red-600">{fmtMoney(it.evar36)}</td>
                      <td className="py-2 px-2"><QuadrantChip q={it.quadrant} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base truncate">{selected?.capabilityName ?? "Select a capability"}</CardTitle>
            <div className="text-xs text-muted-foreground">{selected?.industryName}</div>
          </CardHeader>
          <CardContent>
            {selected ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Revenue exposure:</span> <span className="font-medium">{selected.revenueExposureMm != null ? fmtMoney(selected.revenueExposureMm) : "—"}</span></div>
                  <div><span className="text-muted-foreground">Margin:</span> <span className="font-medium">{selected.marginStructurePct != null ? `${selected.marginStructurePct.toFixed(0)}%` : "—"}</span></div>
                  <div><span className="text-muted-foreground">Half-life:</span> <span className="font-medium">{selected.halfLifeMonths != null ? `${Math.round(selected.halfLifeMonths * halfLifeAdj)}mo` : "—"}</span></div>
                  <div><span className="text-muted-foreground">Velocity:</span> <span className="font-medium">{selected.commoditizationVelocity != null ? `${(selected.commoditizationVelocity * velocityAdj * 100).toFixed(0)}%/yr` : "—"}</span></div>
                </div>
                {curve === null ? (
                  <div className="border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                    EVaR curve unavailable — this capability is missing one or more of half-life, velocity, margin, or revenue exposure. Re-run Alpha Enrichment to populate them.
                  </div>
                ) : (
                  <EvarSparkline curve={curve} maxEvar={maxEvar} />
                )}
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
                {selected.rationale && <p className="mt-4 text-xs text-muted-foreground italic border-l-2 border-amber-500/50 pl-3">{selected.rationale}</p>}
              </>
            ) : <div className="text-muted-foreground/60 text-sm">Pick a row to see its decay curve.</div>}
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
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" className="text-border" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="currentColor" className="text-border" />
      <path d={bandPath} className="fill-amber-400/20" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600" />
      {[12, 24, 36].map(m => (
        <g key={m}>
          <line x1={xs(m)} y1={h - pad} x2={xs(m)} y2={pad} stroke="currentColor" strokeDasharray="2 3" className="text-muted-foreground/60/40" />
          <text x={xs(m)} y={h - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">{m}mo</text>
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

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading cascade graph…</div>;
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
                className={`w-full text-left px-4 py-2 border-b hover:bg-muted/30 ${selectedId === r.id ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs tabular-nums text-red-600 font-semibold whitespace-nowrap">{fmtMoney(r.totalDownstreamImpactMm)}</div>
                </div>
                <div className="text-xs text-muted-foreground">{r.dependentCount} dependents</div>
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
              {cascade && <div className="text-xs text-muted-foreground mt-1">Expected downstream impact: <span className="font-semibold text-red-600">{fmtMoney(cascade.totalExpectedImpactMm)}</span></div>}
            </div>
            <div className="w-40">
              <div className="flex justify-between text-xs mb-1"><span>Horizon</span><span className="tabular-nums">{horizon}mo</span></div>
              <Slider value={[horizon]} min={6} max={48} step={3} onValueChange={(v: number[]) => setHorizon(v[0])} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {cascade ? <CascadeGraph nodes={visibleNodes} edges={visibleEdges} rootId={cascade.root.id} /> : <div className="text-muted-foreground/60 text-sm p-8">Select a root capability…</div>}
          {visibleEdges.length > 0 && (
            <div className="mt-4 max-h-48 overflow-auto text-xs space-y-1 border-t pt-2">
              {visibleEdges.slice(0, 10).map(e => {
                const from = visibleNodes.find(n => n.id === e.fromId);
                const to = visibleNodes.find(n => n.id === e.toId);
                return (
                  <div key={e.id} className="flex items-center gap-2 py-1">
                    <span className="font-medium truncate max-w-[120px]">{from?.name}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
                    <span className="font-medium truncate max-w-[120px]">{to?.name}</span>
                    <span className="text-muted-foreground">p={((e.disruptionProbability ?? 0) * 100).toFixed(0)}%</span>
                    <span className="text-muted-foreground">{e.timeToImpactMonths}mo</span>
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
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/60" />
        </marker>
      </defs>
      {edges.map(e => {
        const from = pos.get(e.fromId); const to = pos.get(e.toId);
        if (!from || !to) return null;
        const strokeW = 1 + 3 * ((e.dollarImpactMm ?? 0) / maxImpact);
        const prob = e.disruptionProbability ?? 0.3;
        const color = prob > 0.6 ? "stroke-red-500" : prob > 0.35 ? "stroke-amber-500" : "stroke-border";
        return (
          <g key={e.id}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={color} strokeWidth={strokeW} strokeOpacity={0.7} markerEnd="url(#arrow)" />
            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
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
            <circle cx={p.x} cy={p.y} r={isRoot ? 10 : 6} className={isRoot ? "fill-amber-500 stroke-amber-700" : "fill-foreground stroke-background"} strokeWidth="1.5" />
            <text x={p.x} y={p.y - 14} textAnchor="middle" className="fill-foreground text-[10px] font-medium">
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

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Scanning for narrative divergence…</div>;
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
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{subtitle} • {items.length}</div>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[600px] overflow-auto">
        {items.length === 0 && <div className="text-xs text-muted-foreground/60">No signals.</div>}
        {items.map(it => (
          <div key={it.capabilityId} className="border rounded-none p-3">
            <div className="flex justify-between items-start gap-2 mb-1">
              <div>
                <div className="font-semibold text-sm">{it.capabilityName}</div>
                <div className="text-xs text-muted-foreground">{it.industryName}</div>
              </div>
              <div className={`text-xs font-bold ${accent}`}>{Math.abs(it.deltaSteps)}-step Δ</div>
            </div>
            <div className="flex items-center gap-2 text-xs mb-2">
              <span className="text-muted-foreground">CE:</span><QuadrantChip q={it.ceQuadrant} />
              <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-muted-foreground">Street:</span><QuadrantChip q={it.consensusQuadrant} />
            </div>
            {it.consensusSummary && <p className="text-xs text-muted-foreground italic mb-2">"{it.consensusSummary}"</p>}
            {it.rationale && <p className="text-xs text-muted-foreground">{it.rationale}</p>}
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

/* ============================= Empty State ============================= */
function EmptyPrompt({ title, msg }: { title: string; msg: string }) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <div className="mx-auto w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center mb-3">
          <Zap className="h-5 w-5 text-amber-600" />
        </div>
        <div className="font-semibold text-foreground">{title}</div>
        <p className="text-sm text-muted-foreground mt-1">{msg}</p>
      </CardContent>
    </Card>
  );
}

/* ============================= Moat Score Tab ============================= */
type MoatItem = {
  capabilityId: number; capabilityName: string; industryName: string; moatScore: number; tier: string;
  components: {
    halfLifeContribution: number | null; dependencyDepth: number | null;
    economicImpact: number | null; stickiness: number | null; supplierConcentration: number | null;
  };
  halfLifeMonths: number | null; upstreamDeps: number; downstreamDeps: number; hhi: number | null;
  rationale: string | null; sources: string[] | null; enriched: boolean;
};
type MoatResp = { items: MoatItem[]; coverage: { scored: number; totalCapabilities: number } };

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    fortress: "bg-emerald-500/15 text-emerald-700 border-emerald-500/40",
    defensible: "bg-blue-500/15 text-blue-700 border-blue-500/40",
    contestable: "bg-amber-500/15 text-amber-700 border-amber-500/40",
    exposed: "bg-red-500/15 text-red-700 border-red-500/40",
  };
  return map[tier] ?? "";
}

function MoatTab() {
  const [data, setData] = useState<MoatResp | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    try { const r = await fetch(`${apiBase}/api/alpha/moat`); if (r.ok) setData(await r.json()); } finally { setLoading(false); }
  })(); }, []);
  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Computing moat scores…</div>;
  if (!data || data.items.length === 0) return <EmptyPrompt title="No enriched capabilities yet" msg="Run Alpha Enrichment — Moat scores require Perplexity-cited half-life and quadrant data per capability." />;

  const items = data.items;
  const tierCounts = items.reduce((acc, i) => { acc[i.tier] = (acc[i.tier] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["fortress", "defensible", "contestable", "exposed"] as const).map(t => (
          <Card key={t}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">{t}</div>
            <div className={`text-2xl font-bold mt-1 ${tierBadge(t).split(" ").find(x => x.startsWith("text-"))}`}>{tierCounts[t] ?? 0}</div>
          </CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Moat Score = how hard to replicate this capability</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Enriched capabilities only. Capabilities without GLM-cited economics are excluded — never shown with placeholder values.</p>
          </div>
          <CoverageBadge scored={data.coverage.scored} total={data.coverage.totalCapabilities} />
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-auto">
            <div className="w-full overflow-x-auto"><table className="w-full text-sm responsive-table">
              <thead className="sticky top-0 bg-muted/30 border-b">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 px-3">Capability</th>
                  <th className="py-2 px-2">Industry</th>
                  <th className="py-2 px-2 text-right">Score</th>
                  <th className="py-2 px-2">Tier</th>
                  <th className="py-2 px-2 text-right">Half-life</th>
                  <th className="py-2 px-2 text-right">Deps</th>
                  <th className="py-2 px-2">Composition</th>
                  <th className="py-2 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.capabilityId} className="border-b">
                    <td className="py-2 px-3 font-medium">{it.capabilityName}</td>
                    <td className="py-2 px-2 text-muted-foreground text-xs">{it.industryName}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold">{it.moatScore}</td>
                    <td className="py-2 px-2"><Badge variant="outline" className={`${tierBadge(it.tier)} border text-xs capitalize`}>{it.tier}</Badge></td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs">{it.halfLifeMonths != null ? `${Math.round(it.halfLifeMonths)}mo` : "—"}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs">{it.upstreamDeps}↑ {it.downstreamDeps}↓</td>
                    <td className="py-2 px-2 w-48"><MoatBar c={it.components} /></td>
                    <td className="py-2 px-2 text-right"><SourcesPopover rationale={it.rationale} sources={it.sources} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MoatBar({ c }: { c: MoatItem["components"] }) {
  const segs: Array<{ label: string; val: number | null; color: string; w: number }> = [
    { label: "Half-life", val: c.halfLifeContribution, color: "bg-emerald-500", w: 0.30 },
    { label: "Depth", val: c.dependencyDepth, color: "bg-blue-500", w: 0.25 },
    { label: "Impact", val: c.economicImpact, color: "bg-purple-500", w: 0.20 },
    { label: "Sticky", val: c.stickiness, color: "bg-amber-500", w: 0.15 },
    { label: "Conc.", val: c.supplierConcentration, color: "bg-pink-500", w: 0.10 },
  ];
  const present = segs.filter(s => s.val != null) as Array<{ label: string; val: number; color: string; w: number }>;
  const wSum = present.reduce((s, x) => s + x.w, 0) || 1;
  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-muted" title={present.map(s => `${s.label}: ${s.val.toFixed(0)}`).join(" • ")}>
      {present.map((s, i) => <div key={i} className={s.color} style={{ width: `${(s.val * s.w / wSum)}%` }} />)}
    </div>
  );
}

/* ============================= Fragility Tab ============================= */
type FragilityItem = {
  capabilityId: number; capabilityName: string; industryName: string; fragilityScore: number; severity: string;
  components: {
    decaySpeed: number | null; upstreamDepth: number | null; supplierConcentration: number | null;
    edgeShock: number | null; disruptionPressure: number | null;
  };
  topUpstreamRiskMm: number | null; scoredEdgesCount: number; totalUpstreamEdges: number;
  halfLifeMonths: number | null; rationale: string | null; sources: string[] | null; enriched: boolean;
};
type FragilityResp = { items: FragilityItem[]; coverage: { scored: number; totalCapabilities: number } };

function severityColor(s: string) {
  return s === "critical" ? "bg-red-500/15 text-red-700 border-red-500/40"
    : s === "elevated" ? "bg-orange-500/15 text-orange-700 border-orange-500/40"
    : s === "moderate" ? "bg-amber-500/15 text-amber-700 border-amber-500/40"
    : "bg-emerald-500/15 text-emerald-700 border-emerald-500/40";
}

function FragilityTab() {
  const [data, setData] = useState<FragilityResp | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const r = await fetch(`${apiBase}/api/alpha/fragility`); if (r.ok) setData(await r.json()); } finally { setLoading(false); } })(); }, []);
  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Computing fragility…</div>;
  if (!data || data.items.length === 0) return <EmptyPrompt title="No enriched capabilities yet" msg="Run Alpha Enrichment to compute fragility from real half-life + edge-shock data." />;

  const items = data.items;
  const counts = items.reduce((acc, i) => { acc[i.severity] = (acc[i.severity] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["critical", "elevated", "moderate", "stable"] as const).map(s => (
          <Card key={s} className={s === "critical" ? "border-red-500/50" : ""}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground uppercase">{s}</div>
            <div className={`text-2xl font-bold mt-1 ${severityColor(s).split(" ").find(x => x.startsWith("text-"))}`}>{counts[s] ?? 0}</div>
          </CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Capabilities ranked by fragility (higher = more vulnerable)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Components are renormalized over only the inputs that exist — missing data never silently becomes 0.</p>
          </div>
          <CoverageBadge scored={data.coverage.scored} total={data.coverage.totalCapabilities} />
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-auto">
            <div className="w-full overflow-x-auto"><table className="w-full text-sm responsive-table">
              <thead className="sticky top-0 bg-muted/30 border-b">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 px-3">Capability</th>
                  <th className="py-2 px-2">Industry</th>
                  <th className="py-2 px-2 text-right">Score</th>
                  <th className="py-2 px-2">Severity</th>
                  <th className="py-2 px-2 text-right">Top upstream risk</th>
                  <th className="py-2 px-2 text-right">½-life</th>
                  <th className="py-2 px-2">Vector</th>
                  <th className="py-2 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.capabilityId} className="border-b">
                    <td className="py-2 px-3 font-medium">{it.capabilityName}</td>
                    <td className="py-2 px-2 text-muted-foreground text-xs">{it.industryName}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold text-red-600">{it.fragilityScore}</td>
                    <td className="py-2 px-2"><Badge variant="outline" className={`${severityColor(it.severity)} border text-xs capitalize`}>{it.severity}</Badge></td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs" title={`${it.scoredEdgesCount} of ${it.totalUpstreamEdges} upstream edges priced`}>
                      {it.topUpstreamRiskMm != null ? fmtMoney(it.topUpstreamRiskMm) : <span className="text-muted-foreground/60">— ({it.scoredEdgesCount}/{it.totalUpstreamEdges} priced)</span>}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs">{it.halfLifeMonths != null ? `${Math.round(it.halfLifeMonths)}mo` : "—"}</td>
                    <td className="py-2 px-2 w-44">
                      <div className="flex gap-0.5 items-end h-6">
                        {(["decaySpeed", "upstreamDepth", "supplierConcentration", "edgeShock", "disruptionPressure"] as const).map(k => {
                          const v = it.components[k];
                          return v == null
                            ? <div key={k} className="w-full rounded-sm border border-dashed border-border" style={{ height: "100%" }} title={`${k}: not enriched`} />
                            : <div key={k} title={`${k}: ${v}`} className="bg-red-500/60 w-full rounded-sm" style={{ height: `${Math.max(4, v)}%` }} />;
                        })}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right"><SourcesPopover rationale={it.rationale} sources={it.sources} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================= Arbitrage Tab ============================= */
type ArbitrageItem = {
  capabilityId: number; capabilityName: string; industryName: string;
  ceQuadrant: string; ceMultiple: number; consensusQuadrant: string; consensusMultiple: number;
  revenueExposureMm: number; marginPct: number | null;
  consensusValueMm: number; ceValueMm: number; spreadMm: number; spreadPct: number | null;
  direction: "long" | "short" | "neutral"; confidence: number; companies: number;
  rationale: string | null; consensusSummary: string | null; sources: string[] | null;
};
type ArbitrageResp = {
  items: ArbitrageItem[];
  totals: { longExposureMm: number; shortExposureMm: number; neutralCount: number; pairs: number };
  methodology: { formula: string; multiples: Record<string, number>; minConfidenceForSignal: number };
};

type QuadrantMultiples = { hot: number; emerging: number; cooling: number; table_stakes: number; declining: number; methodologyUrl: string };

function ArbitrageTab() {
  const [data, setData] = useState<ArbitrageResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [mults, setMults] = useState<QuadrantMultiples | null>(null);
  useEffect(() => { (async () => { try { const r = await fetch(`${apiBase}/api/alpha/arbitrage`); if (r.ok) setData(await r.json()); } finally { setLoading(false); } })(); }, []);
  useEffect(() => {
    fetch(`${apiBase}/api/alpha/config/quadrant-multiples`)
      .then(r => r.ok ? r.json() : null)
      .then((d: QuadrantMultiples | null) => { if (d) setMults(d); })
      .catch(() => {});
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Mapping arbitrage spreads…</div>;
  if (!data || data.items.length === 0) return <EmptyPrompt title="No arbitrage spreads yet" msg="Run Alpha Enrichment — needs CE quadrant, consensus quadrant, revenue exposure, and margin per capability." />;

  // Multiples description string — sourced from alpha_config when available,
  // falls back to documented defaults. Was hardcoded inline (PLAN.md item #7).
  const multsLine = mults
    ? `Multiples: hot ${mults.hot}×, emerging ${mults.emerging}×, cooling ${mults.cooling}×, table-stakes ${mults.table_stakes}×, declining ${mults.declining}×.`
    : "Multiples: hot 15×, emerging 10×, cooling 7×, table-stakes 4×, declining 1×.";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Long exposure</div><div className="text-xl font-bold mt-1 text-emerald-600">{fmtMoney(data.totals.longExposureMm)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Short exposure</div><div className="text-xl font-bold mt-1 text-red-600">{fmtMoney(data.totals.shortExposureMm)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Neutral (low conf.)</div><div className="text-xl font-bold mt-1 text-muted-foreground">{data.totals.neutralCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Pairs scored</div><div className="text-xl font-bold mt-1">{data.totals.pairs}</div></CardContent></Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CE quadrant valuation vs street consensus valuation</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Spread = (revenue × margin × CE multiple) − (revenue × margin × consensus multiple). {multsLine}
            Direction requires consensus confidence ≥ {data.methodology.minConfidenceForSignal} — otherwise neutral.{" "}
            <a href={mults?.methodologyUrl ?? "/methodology#quadrant-multiples"} className="underline hover:text-foreground">Methodology →</a>
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[560px] overflow-auto">
            <div className="w-full overflow-x-auto"><table className="w-full text-sm responsive-table">
              <thead className="sticky top-0 bg-muted/30 border-b">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 px-3">Capability</th>
                  <th className="py-2 px-2">Industry</th>
                  <th className="py-2 px-2">CE quadrant</th>
                  <th className="py-2 px-2">Street quadrant</th>
                  <th className="py-2 px-2 text-right">CE value</th>
                  <th className="py-2 px-2 text-right">Street value</th>
                  <th className="py-2 px-2 text-right">Spread</th>
                  <th className="py-2 px-2">Direction</th>
                  <th className="py-2 px-2 text-right">Conf.</th>
                  <th className="py-2 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(it => (
                  <tr key={it.capabilityId} className="border-b">
                    <td className="py-2 px-3 font-medium">{it.capabilityName}</td>
                    <td className="py-2 px-2 text-muted-foreground text-xs">{it.industryName}</td>
                    <td className="py-2 px-2"><QuadrantChip q={it.ceQuadrant} /><span className="ml-1 text-[10px] text-muted-foreground">{it.ceMultiple}×</span></td>
                    <td className="py-2 px-2"><QuadrantChip q={it.consensusQuadrant} /><span className="ml-1 text-[10px] text-muted-foreground">{it.consensusMultiple}×</span></td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtMoney(it.ceValueMm)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{fmtMoney(it.consensusValueMm)}</td>
                    <td className={`py-2 px-2 text-right tabular-nums font-bold ${it.spreadMm > 0 ? "text-emerald-600" : it.spreadMm < 0 ? "text-red-600" : ""}`}>
                      {it.spreadMm > 0 ? "+" : ""}{fmtMoney(it.spreadMm)}
                      {it.spreadPct != null && <span className="ml-1 text-[10px] text-muted-foreground">({it.spreadPct > 0 ? "+" : ""}{it.spreadPct}%)</span>}
                    </td>
                    <td className="py-2 px-2"><Badge variant="outline" className={`text-xs capitalize ${it.direction === "long" ? "text-emerald-600 border-emerald-500/40" : it.direction === "short" ? "text-red-600 border-red-500/40" : "text-muted-foreground"}`}>{it.direction}</Badge></td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs">{(it.confidence * 100).toFixed(0)}%</td>
                    <td className="py-2 px-2 text-right"><SourcesPopover rationale={it.rationale} sources={it.sources} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================= Flows Tab ============================= */
type FlowsResp = { stages: Array<{ name: string; totalCapitalMm: number; avgTrend: number; count: number }>; industries: Array<{ id: number; name: string; totalCapitalMm: number; avgTrend: number; count: number }>; links: Array<{ source: string; target: string; valueMm: number; trendPct: number }>; totals: { totalCapitalMm: number; acceleratingMm: number; deceleratingMm: number } };

function FlowsTab() {
  const [data, setData] = useState<FlowsResp | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const r = await fetch(`${apiBase}/api/alpha/flows`); if (r.ok) setData(await r.json()); } finally { setLoading(false); } })(); }, []);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Aggregating capital flows…</div>;
  if (!data || data.stages.length === 0) return <EmptyPrompt title="No capital flow data" msg="Run base enrichment to populate value-chain stages." />;

  const maxStage = Math.max(...data.stages.map(s => s.totalCapitalMm), 1);
  const maxInd = Math.max(...data.industries.map(i => i.totalCapitalMm), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Total tracked capital</div><div className="text-xl font-bold mt-1">{fmtMoney(data.totals.totalCapitalMm)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Accelerating (&gt;10%/yr)</div><div className="text-xl font-bold mt-1 text-emerald-600">{fmtMoney(data.totals.acceleratingMm)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Decelerating (&lt;-5%/yr)</div><div className="text-xl font-bold mt-1 text-red-600">{fmtMoney(data.totals.deceleratingMm)}</div></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Capital by value-chain stage</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.stages.map(s => (
              <div key={s.name}>
                <div className="flex justify-between text-xs mb-1"><span className="font-medium">{s.name}</span><span className="tabular-nums">{fmtMoney(s.totalCapitalMm)} <span className={s.avgTrend > 0 ? "text-emerald-600" : "text-red-600"}>{s.avgTrend > 0 ? "+" : ""}{s.avgTrend}%</span></span></div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${s.avgTrend > 0 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${(s.totalCapitalMm / maxStage) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Capital by industry</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.industries.map(i => (
              <div key={i.id}>
                <div className="flex justify-between text-xs mb-1"><span className="font-medium">{i.name}</span><span className="tabular-nums">{fmtMoney(i.totalCapitalMm)} <span className={i.avgTrend > 0 ? "text-emerald-600" : "text-red-600"}>{i.avgTrend > 0 ? "+" : ""}{i.avgTrend}%</span></span></div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${i.avgTrend > 0 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${(i.totalCapitalMm / maxInd) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Top capital flow links (stage → industry)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-80 overflow-auto">
            <div className="w-full overflow-x-auto"><table className="w-full text-sm responsive-table">
              <thead className="sticky top-0 bg-muted/30 border-b text-xs uppercase text-muted-foreground">
                <tr><th className="text-left py-2 px-3">Stage</th><th className="text-left py-2 px-2">Industry</th><th className="text-right py-2 px-2">Capital</th><th className="text-right py-2 px-2">Trend</th></tr>
              </thead>
              <tbody>
                {data.links.slice(0, 30).map((l, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2 px-3 font-medium">{l.source.replace("stage:", "")}</td>
                    <td className="py-2 px-2 text-muted-foreground">{l.target.replace("industry:", "")}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtMoney(l.valueMm)}</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${l.trendPct > 0 ? "text-emerald-600" : "text-red-600"}`}>{l.trendPct > 0 ? "+" : ""}{l.trendPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================= Talent Tab ============================= */
type TalentItem = { capabilityId: number; capabilityName: string; industryName: string; quadrant: string | null; adoptionMomentum: number | null; companies: number; coreCount: number; partialCount: number; masteryRatio: number; bottleneckScore: number; status: string; sectorMix: Array<{ sector: string; count: number }>; stageMix: Array<{ stage: string; count: number }>; topCompanies: Array<{ name: string; country: string; stage: string | null; strength: string; fevi: number }> };

function TalentTab() {
  const [items, setItems] = useState<TalentItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => { (async () => { try { const r = await fetch(`${apiBase}/api/alpha/talent`); if (r.ok) { const d = await r.json(); setItems(d.items); if (d.items[0]) setSelectedId(d.items[0].capabilityId); } } finally { setLoading(false); } })(); }, []);
  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Mapping talent density…</div>;
  if (!items || items.length === 0) return <EmptyPrompt title="No talent mappings yet" msg="Need company-capability mappings to compute supply/demand." />;

  const selected = items.find(i => i.capabilityId === selectedId);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Bottleneck capabilities</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[560px] overflow-auto">
            {items.map(it => (
              <button key={it.capabilityId} onClick={() => setSelectedId(it.capabilityId)} className={`w-full text-left px-4 py-2 border-b hover:bg-muted/30 ${selectedId === it.capabilityId ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-medium text-sm">{it.capabilityName}</div>
                    <div className="text-xs text-muted-foreground">{it.industryName} • {it.companies} cos · {Math.round(it.masteryRatio * 100)}% mastery</div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] capitalize ${it.status === "bottleneck" ? "border-red-500/50 text-red-600" : it.status === "saturated" ? "border-border text-muted-foreground" : it.status === "competitive" ? "border-amber-500/50 text-amber-600" : "border-blue-500/50 text-blue-600"}`}>{it.status}</Badge>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader><CardTitle className="text-base">{selected?.capabilityName ?? "—"}</CardTitle><div className="text-xs text-muted-foreground">{selected?.industryName}</div></CardHeader>
        <CardContent>
          {selected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div><div className="text-xs text-muted-foreground">Companies</div><div className="text-2xl font-bold">{selected.companies}</div></div>
                <div><div className="text-xs text-muted-foreground">Core mastery</div><div className="text-2xl font-bold text-emerald-600">{selected.coreCount}</div></div>
                <div><div className="text-xs text-muted-foreground">Bottleneck</div><div className="text-2xl font-bold text-red-600">{selected.bottleneckScore}</div></div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">By funding stage</div>
                <div className="flex flex-wrap gap-1">
                  {selected.stageMix.map(s => <Badge key={s.stage} variant="secondary" className="text-xs">{s.stage}: {s.count}</Badge>)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">By sector</div>
                <div className="flex flex-wrap gap-1">
                  {selected.sectorMix.map(s => <Badge key={s.sector} variant="outline" className="text-xs">{s.sector}: {s.count}</Badge>)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Top companies (by FEVI)</div>
                <div className="space-y-1">
                  {selected.topCompanies.map(c => (
                    <div key={c.name} className="flex justify-between border-b py-1.5 text-sm">
                      <div><span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">{c.country} • {c.stage ?? "—"}</span></div>
                      <div className="text-xs"><Badge variant="outline" className="mr-1">{c.strength}</Badge>FEVI {c.fevi.toFixed(1)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : <div className="text-muted-foreground/60 text-sm">Pick a capability…</div>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================= M&A Twin Tab ============================= */
type Industry = { id: number; name: string };
type TwinResp = { industryA: Industry; industryB: Industry; summary: { sharedCount: number; onlyACount: number; onlyBCount: number; jaccard: number; totalSynergyMm: number; clashCount: number }; synergies: Array<{ capabilityName: string; a: any; b: any; clash: boolean; clashType: string | null; synergyMm: number }>; onlyA: Array<{ id: number; name: string; quadrant: string | null }>; onlyB: Array<{ id: number; name: string; quadrant: string | null }> };

function TwinTab() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");
  const [data, setData] = useState<TwinResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/industries`).then(r => r.json()).then((d: Industry[]) => {
      setIndustries(d);
      if (d.length >= 2) { setAId(String(d[0].id)); setBId(String(d[1].id)); }
    });
  }, []);

  async function run() {
    if (!aId || !bId || aId === bId) { setErr("Pick two different industries"); return; }
    setLoading(true); setErr(null); setData(null);
    try {
      const r = await fetch(`${apiBase}/api/alpha/twin?industryAId=${aId}&industryBId=${bId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "twin failed");
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs text-muted-foreground mb-1">Acquirer (A)</div>
            <Select value={aId} onValueChange={setAId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs text-muted-foreground mb-1">Target (B)</div>
            <Select value={bId} onValueChange={setBId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <GitMerge className="h-4 w-4 mr-2" />}Compute Twin</Button>
        </CardContent>
      </Card>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Shared</div><div className="text-xl font-bold mt-1 text-emerald-600">{data.summary.sharedCount}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Only in A</div><div className="text-xl font-bold mt-1">{data.summary.onlyACount}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Only in B</div><div className="text-xl font-bold mt-1">{data.summary.onlyBCount}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Synergy</div><div className="text-xl font-bold mt-1 text-emerald-600">{fmtMoney(data.summary.totalSynergyMm)}</div></CardContent></Card>
            <Card className={data.summary.clashCount > 0 ? "border-red-500/40" : ""}><CardContent className="p-4"><div className="text-xs text-muted-foreground uppercase">Clash zones</div><div className="text-xl font-bold mt-1 text-red-600">{data.summary.clashCount}</div></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Synergy / clash zones (overlap = {(data.summary.jaccard * 100).toFixed(1)}%)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-auto">
                <div className="w-full overflow-x-auto"><table className="w-full text-sm responsive-table">
                  <thead className="sticky top-0 bg-muted/30 border-b text-xs uppercase text-muted-foreground">
                    <tr><th className="text-left py-2 px-3">Capability</th><th className="py-2 px-2">A quadrant</th><th className="py-2 px-2">B quadrant</th><th className="text-right py-2 px-2">Synergy</th><th className="py-2 px-2">Status</th></tr>
                  </thead>
                  <tbody>
                    {data.synergies.map(s => (
                      <tr key={s.capabilityName} className={`border-b ${s.clash ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                        <td className="py-2 px-3 font-medium">{s.capabilityName}</td>
                        <td className="py-2 px-2"><QuadrantChip q={s.a.quadrant} /></td>
                        <td className="py-2 px-2"><QuadrantChip q={s.b.quadrant} /></td>
                        <td className="py-2 px-2 text-right tabular-nums text-emerald-600">{fmtMoney(s.synergyMm)}</td>
                        <td className="py-2 px-2">{s.clash ? <Badge variant="outline" className="text-red-600 border-red-500/50 text-xs">CLASH: {s.clashType}</Badge> : <Badge variant="outline" className="text-emerald-600 border-emerald-500/50 text-xs">synergy</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card><CardHeader><CardTitle className="text-base">Acquirer-only ({data.industryA.name})</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{data.onlyA.map(c => <Badge key={c.id} variant="secondary" className="text-xs">{c.name}</Badge>)}</div></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Target-only ({data.industryB.name})</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{data.onlyB.map(c => <Badge key={c.id} variant="secondary" className="text-xs">{c.name}</Badge>)}</div></CardContent></Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================= Thesis Memo Tab ============================= */
type Capability = { id: number; name: string; industryId: number };
type ThesisResp = { capabilityId: number; capabilityName: string; industryName: string; generatedAt: string; memoMarkdown: string; inputs: any };

function ThesisTab() {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [capId, setCapId] = useState<string>("");
  const [memo, setMemo] = useState<ThesisResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch(`${apiBase}/api/capabilities`).then(r => r.json()).then((d: Capability[]) => { setCaps(d); if (d[0]) setCapId(String(d[0].id)); }); }, []);

  async function generate() {
    if (!capId) return;
    setLoading(true); setErr(null); setMemo(null);
    try {
      const r = await fetch(`${apiBase}/api/alpha/thesis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capabilityId: parseInt(capId) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "thesis failed");
      setMemo(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <div className="text-xs text-muted-foreground mb-1">Capability</div>
            <Select value={capId} onValueChange={setCapId}>
              <SelectTrigger><SelectValue placeholder="Pick capability" /></SelectTrigger>
              <SelectContent>{caps.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={generate} disabled={loading || !capId}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}Generate Memo</Button>
        </CardContent>
      </Card>
      {err && <div className="text-sm text-red-600 px-2">{err}</div>}
      {loading && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />Composing thesis from EVaR + Cascade + Narrative + company data… (~30s)</CardContent></Card>}
      {memo && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{memo.capabilityName}</CardTitle>
                <div className="text-xs text-muted-foreground mt-1">{memo.industryName} • Generated {new Date(memo.generatedAt).toLocaleString()}</div>
              </div>
              <div className="text-xs text-muted-foreground text-right">
                <div>{memo.inputs.upstream}↑ {memo.inputs.downstream}↓ deps</div>
                <div>{memo.inputs.topCompanies?.length ?? 0} companies</div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-h1:text-xl prose-h2:text-base prose-h2:mt-5 prose-h2:mb-2 prose-p:my-2 prose-li:my-0.5 leading-relaxed">
              <ReactMarkdown>{memo.memoMarkdown}</ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
