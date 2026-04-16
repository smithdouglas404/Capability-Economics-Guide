import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip as RTooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity, Network, GitBranch, ScanSearch, Flame, Sparkles,
  TrendingUp, Snowflake, Layers, Building2, ExternalLink, RefreshCw,
  LayoutGrid, Rows3, PieChart, AlertTriangle, Zap,
} from "lucide-react";

const API_BASE = "/api";

// ============== Types ==============
interface Industry { id: number; slug: string; name: string }
interface CapabilityNode {
  id: number; name: string; industryId: number;
  benchmarkScore: number | null;
  quadrant: string | null;
  economicImpactScore: number | null;
  adoptionMomentumScore: number | null;
  disruptionIntensity: number | null;
}
interface ValueChainStage {
  id: number; industryId: number; stageName: string; stageOrder: number;
  numSectors: number | null; hhiScore: number | null;
  patentCount: number | null; patentTrendPct: number | null;
  startupCount: number | null; startupTrendPct: number | null;
  capitalFlowMm: number | null; capitalTrendPct: number | null;
  disruptionSummary: string;
  shifts: string[] | null;
  risks: string[] | null;
  keyCapabilities: number[] | null;
  keyCompanies: string[] | null;
}
interface Company {
  id: number; name: string; country: string; naicsCode: string | null;
  naicsSector: string | null; industryId: number;
  feviScore: number; cdiScore: number; quadrant: string;
  fundingStage: string | null; description: string;
}
interface CompanyMapping {
  id: number; companyId: number; capabilityId: number; strength: string;
}
interface GraphData {
  industries: Industry[];
  capabilities: CapabilityNode[];
  valueChainStages: ValueChainStage[];
  companies: Company[];
  companyMappings: CompanyMapping[];
}

// ============== Quadrant palette ==============
const QUADRANT_COLORS: Record<string, string> = {
  hot: "#f59e0b",          // amber
  emerging: "#3b82f6",     // blue
  cooling: "#64748b",      // slate
  table_stakes: "#94a3b8", // muted
};
const QUADRANT_LABELS: Record<string, string> = {
  hot: "Hot",
  emerging: "Emerging",
  cooling: "Cooling",
  table_stakes: "Table Stakes",
};
const QUADRANT_ICONS: Record<string, React.ElementType> = {
  hot: Flame, emerging: Sparkles, cooling: Snowflake, table_stakes: Layers,
};

// ============== Data hook ==============
function useGraphData() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/enrichment/graph`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => { if (!cancelled) { setData(json); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);
  return { data, loading, error };
}

// ============== Quadrant xRay ==============
function QuadrantXRay({ data }: { data: GraphData }) {
  const [industryFilter, setIndustryFilter] = useState<number | "all">("all");
  const W = 760, H = 540, M = { l: 60, r: 40, t: 30, b: 50 };
  const innerW = W - M.l - M.r, innerH = H - M.t - M.b;

  const points = useMemo(() => {
    return data.capabilities
      .filter(c => c.quadrant && c.economicImpactScore !== null && c.adoptionMomentumScore !== null)
      .filter(c => industryFilter === "all" || c.industryId === industryFilter)
      .map(c => ({
        ...c,
        x: M.l + (c.economicImpactScore! / 100) * innerW,
        y: M.t + innerH - (c.adoptionMomentumScore! / 100) * innerH,
        r: 6 + (c.disruptionIntensity ?? 0.3) * 22,
        color: QUADRANT_COLORS[c.quadrant!] ?? "#94a3b8",
      }));
  }, [data, industryFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { hot: 0, emerging: 0, cooling: 0, table_stakes: 0 };
    points.forEach(p => { c[p.quadrant!] = (c[p.quadrant!] ?? 0) + 1; });
    return c;
  }, [points]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-serif">Capability Quadrant xRay</h3>
          <p className="text-sm text-muted-foreground">Economic Impact × Adoption Momentum, sized by Disruption Intensity</p>
        </div>
        <select
          className="h-9 px-3 text-sm border bg-background rounded"
          value={industryFilter}
          onChange={e => setIndustryFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All Industries ({data.capabilities.filter(c => c.quadrant).length})</option>
          {data.industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        {(["hot", "emerging", "cooling", "table_stakes"] as const).map(q => {
          const Icon = QUADRANT_ICONS[q];
          return (
            <div key={q} className="border rounded p-3 flex items-center gap-2 bg-card">
              <Icon className="w-4 h-4" style={{ color: QUADRANT_COLORS[q] }} />
              <div>
                <div className="text-xs font-medium" style={{ color: QUADRANT_COLORS[q] }}>{QUADRANT_LABELS[q]}</div>
                <div className="text-lg font-mono">{counts[q] ?? 0}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border rounded bg-card p-2 overflow-x-auto">
        <svg width={W} height={H} className="block mx-auto">
          {/* Quadrant fills */}
          <rect x={M.l} y={M.t} width={innerW / 2} height={innerH / 2} fill="#3b82f6" fillOpacity={0.04} />
          <rect x={M.l + innerW / 2} y={M.t} width={innerW / 2} height={innerH / 2} fill="#f59e0b" fillOpacity={0.06} />
          <rect x={M.l} y={M.t + innerH / 2} width={innerW / 2} height={innerH / 2} fill="#94a3b8" fillOpacity={0.04} />
          <rect x={M.l + innerW / 2} y={M.t + innerH / 2} width={innerW / 2} height={innerH / 2} fill="#64748b" fillOpacity={0.04} />

          {/* Axes */}
          <line x1={M.l} y1={M.t + innerH / 2} x2={M.l + innerW} y2={M.t + innerH / 2} stroke="currentColor" strokeOpacity={0.15} />
          <line x1={M.l + innerW / 2} y1={M.t} x2={M.l + innerW / 2} y2={M.t + innerH} stroke="currentColor" strokeOpacity={0.15} />
          <line x1={M.l} y1={M.t} x2={M.l} y2={M.t + innerH} stroke="currentColor" strokeOpacity={0.4} />
          <line x1={M.l} y1={M.t + innerH} x2={M.l + innerW} y2={M.t + innerH} stroke="currentColor" strokeOpacity={0.4} />

          {/* Quadrant labels */}
          <text x={M.l + 8} y={M.t + 18} fontSize={11} fill="#3b82f6" fontWeight="600">EMERGING</text>
          <text x={M.l + innerW - 70} y={M.t + 18} fontSize={11} fill="#f59e0b" fontWeight="600">HOT</text>
          <text x={M.l + 8} y={M.t + innerH - 8} fontSize={11} fill="#94a3b8" fontWeight="600">TABLE STAKES</text>
          <text x={M.l + innerW - 60} y={M.t + innerH - 8} fontSize={11} fill="#64748b" fontWeight="600">COOLING</text>

          {/* Axis labels */}
          <text x={M.l + innerW / 2} y={H - 12} fontSize={11} textAnchor="middle" fill="currentColor" fillOpacity={0.6}>
            Economic Impact →
          </text>
          <text x={15} y={M.t + innerH / 2} fontSize={11} textAnchor="middle" fill="currentColor" fillOpacity={0.6}
                transform={`rotate(-90 15 ${M.t + innerH / 2})`}>
            Adoption Momentum →
          </text>

          {/* Bubbles */}
          {points.map(p => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={p.r} fill={p.color} fillOpacity={0.55} stroke={p.color} strokeWidth={1.5}>
                <title>{p.name} • {QUADRANT_LABELS[p.quadrant!]} • EI {p.economicImpactScore?.toFixed(0)} • AM {p.adoptionMomentumScore?.toFixed(0)} • DI {p.disruptionIntensity?.toFixed(2)}</title>
              </circle>
              {p.r > 14 && (
                <text x={p.x} y={p.y + 3} fontSize={9} textAnchor="middle" fill="white" fontWeight="600" pointerEvents="none">
                  {p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="text-xs text-muted-foreground mt-2">
        Hover bubbles for capability details. Bubble size = Disruption Intensity (CDI). Source: Perplexity research synthesized by GLM 5.1.
      </div>
    </div>
  );
}

// ============== Bipartite Spider ==============
function BipartiteSpider({ data }: { data: GraphData }) {
  const [industryFilter, setIndustryFilter] = useState<number>(data.industries[0]?.id ?? 0);
  const [strengthFilter, setStrengthFilter] = useState<string>("all");

  const { capNodes, coNodes, edges, capById, coById } = useMemo(() => {
    const caps = data.capabilities.filter(c => c.industryId === industryFilter);
    const capIds = new Set(caps.map(c => c.id));
    const cos = data.companies.filter(co => co.industryId === industryFilter);
    const coIds = new Set(cos.map(co => co.id));
    let edges = data.companyMappings.filter(m => coIds.has(m.companyId) && capIds.has(m.capabilityId));
    if (strengthFilter !== "all") edges = edges.filter(e => e.strength === strengthFilter);
    const capById = new Map(caps.map(c => [c.id, c]));
    const coById = new Map(cos.map(co => [co.id, co]));
    return { capNodes: caps, coNodes: cos, edges, capById, coById };
  }, [data, industryFilter, strengthFilter]);

  const W = 900, H = 620, padY = 60;
  const capX = 220, coX = W - 220;
  const capYStep = (H - padY * 2) / Math.max(1, capNodes.length - 1 || 1);
  const coYStep = (H - padY * 2) / Math.max(1, coNodes.length - 1 || 1);
  const capPos = new Map(capNodes.map((c, i) => [c.id, { x: capX, y: capNodes.length === 1 ? H / 2 : padY + i * capYStep }]));
  const coPos = new Map(coNodes.map((co, i) => [co.id, { x: coX, y: coNodes.length === 1 ? H / 2 : padY + i * coYStep }]));

  const strengthStyle: Record<string, { color: string; opacity: number; width: number }> = {
    core: { color: "#f59e0b", opacity: 0.7, width: 1.6 },
    adjacent: { color: "#3b82f6", opacity: 0.45, width: 1.1 },
    emerging: { color: "#10b981", opacity: 0.55, width: 1.2 },
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-serif">Bipartite Spider — Companies ↔ Capabilities</h3>
          <p className="text-sm text-muted-foreground">{coNodes.length} companies, {capNodes.length} capabilities, {edges.length} edges</p>
        </div>
        <div className="flex gap-2">
          <select className="h-9 px-3 text-sm border bg-background rounded" value={industryFilter} onChange={e => setIndustryFilter(Number(e.target.value))}>
            {data.industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <select className="h-9 px-3 text-sm border bg-background rounded" value={strengthFilter} onChange={e => setStrengthFilter(e.target.value)}>
            <option value="all">All edges</option>
            <option value="core">Core only</option>
            <option value="adjacent">Adjacent only</option>
            <option value="emerging">Emerging only</option>
          </select>
        </div>
      </div>

      <div className="border rounded bg-card overflow-x-auto">
        <svg width={W} height={H} className="block">
          {/* Edges */}
          {edges.map(e => {
            const a = capPos.get(e.capabilityId), b = coPos.get(e.companyId);
            if (!a || !b) return null;
            const s = strengthStyle[e.strength] ?? strengthStyle.core;
            const mid = (a.x + b.x) / 2;
            return (
              <path key={e.id} d={`M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`}
                fill="none" stroke={s.color} strokeOpacity={s.opacity} strokeWidth={s.width} />
            );
          })}
          {/* Capability nodes */}
          {capNodes.map(c => {
            const p = capPos.get(c.id)!;
            const color = c.quadrant ? QUADRANT_COLORS[c.quadrant] : "#94a3b8";
            return (
              <g key={`cap-${c.id}`}>
                <circle cx={p.x} cy={p.y} r={7} fill={color} stroke="white" strokeWidth={1.5}>
                  <title>{c.name} • {c.quadrant ? QUADRANT_LABELS[c.quadrant] : "unclassified"}</title>
                </circle>
                <text x={p.x - 14} y={p.y + 4} fontSize={10} textAnchor="end" fill="currentColor" fillOpacity={0.85}>
                  {c.name.length > 28 ? c.name.slice(0, 27) + "…" : c.name}
                </text>
              </g>
            );
          })}
          {/* Company nodes */}
          {coNodes.map(co => {
            const p = coPos.get(co.id)!;
            const color = QUADRANT_COLORS[co.quadrant] ?? "#94a3b8";
            const r = 5 + (co.feviScore ?? 0.3) * 8;
            return (
              <g key={`co-${co.id}`}>
                <circle cx={p.x} cy={p.y} r={r} fill={color} fillOpacity={0.7} stroke={color} strokeWidth={1.5}>
                  <title>{co.name} • {co.country} • FEVI {co.feviScore.toFixed(2)} • CDI {co.cdiScore.toFixed(2)} • {co.fundingStage ?? "—"}</title>
                </circle>
                <text x={p.x + 14} y={p.y + 4} fontSize={10} fill="currentColor" fillOpacity={0.85}>
                  {co.name.length > 26 ? co.name.slice(0, 25) + "…" : co.name}
                </text>
              </g>
            );
          })}
          {/* Column headers */}
          <text x={capX} y={28} fontSize={12} textAnchor="middle" fill="currentColor" fillOpacity={0.6} fontWeight="600">CAPABILITIES</text>
          <text x={coX} y={28} fontSize={12} textAnchor="middle" fill="currentColor" fillOpacity={0.6} fontWeight="600">COMPANIES</text>
        </svg>
      </div>
      <div className="text-xs text-muted-foreground mt-2 flex gap-4 flex-wrap">
        <span><span className="inline-block w-3 h-0.5 bg-amber-500 mr-1" />Core</span>
        <span><span className="inline-block w-3 h-0.5 bg-blue-500 mr-1" />Adjacent</span>
        <span><span className="inline-block w-3 h-0.5 bg-emerald-500 mr-1" />Emerging</span>
        <span className="ml-auto">Company size = FEVI score</span>
      </div>
    </div>
  );
}

// ============== Value Chain Swimlane ==============
function ValueChainSwimlane({ data }: { data: GraphData }) {
  const [industryFilter, setIndustryFilter] = useState<number>(data.industries[0]?.id ?? 0);
  const [view, setView] = useState<"cards" | "matrix">("cards");
  const stages = useMemo(() => {
    return data.valueChainStages
      .filter(s => s.industryId === industryFilter)
      .sort((a, b) => a.stageOrder - b.stageOrder);
  }, [data, industryFilter]);

  const capNameById = useMemo(() => new Map(data.capabilities.map(c => [c.id, c.name])), [data.capabilities]);

  function heatColor(pct: number | null): string {
    if (pct === null || pct === undefined) return "rgba(148,163,184,0.15)";
    if (pct >= 50) return "rgba(245, 158, 11, 0.55)";   // hot amber
    if (pct >= 20) return "rgba(245, 158, 11, 0.35)";   // warm
    if (pct >= 5) return "rgba(59, 130, 246, 0.30)";    // cool blue
    if (pct >= -5) return "rgba(148, 163, 184, 0.20)";  // neutral
    return "rgba(100, 116, 139, 0.30)";                 // cooling
  }

  const fmtMm = (v: number | null) => v == null ? "—" : v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`;
  const fmtPct = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-serif">Value Chain Swimlane</h3>
          <p className="text-sm text-muted-foreground">Heat coloring = capital trend (5yr %). {stages.length} stages mapped.</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="inline-flex border rounded overflow-hidden text-xs">
            <button onClick={() => setView("cards")}
              className={`px-3 py-1.5 flex items-center gap-1.5 ${view === "cards" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              <LayoutGrid className="w-3.5 h-3.5" /> Cards
            </button>
            <button onClick={() => setView("matrix")}
              className={`px-3 py-1.5 flex items-center gap-1.5 border-l ${view === "matrix" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              <Rows3 className="w-3.5 h-3.5" /> Matrix
            </button>
          </div>
          <select className="h-9 px-3 text-sm border bg-background rounded" value={industryFilter} onChange={e => setIndustryFilter(Number(e.target.value))}>
            {data.industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {stages.length === 0 ? (
        <div className="border rounded bg-card p-12 text-center text-muted-foreground">
          No value chain stages mapped for this industry yet. Run enrichment from Admin to generate.
        </div>
      ) : view === "matrix" ? (
        <div className="border rounded bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3 py-2.5">#</th>
                <th className="text-left px-3 py-2.5">Stage</th>
                <th className="text-left px-3 py-2.5">Sectors / HHI</th>
                <th className="text-right px-3 py-2.5">Patents (5yr)</th>
                <th className="text-right px-3 py-2.5">Startups (5yr)</th>
                <th className="text-right px-3 py-2.5">Capital (5yr)</th>
                <th className="text-left px-3 py-2.5">Key capabilities</th>
                <th className="text-left px-3 py-2.5">Key companies</th>
              </tr>
            </thead>
            <tbody>
              {stages.map(s => (
                <tr key={s.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">{s.stageOrder}</td>
                  <td className="px-3 py-2.5 font-medium text-foreground">{s.stageName}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">
                    {s.numSectors ?? "—"} {s.hhiScore !== null && <span>· HHI {s.hhiScore.toFixed(2)}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span className="px-1.5 py-0.5 rounded" style={{ background: heatColor(s.patentTrendPct) }}>
                      {s.patentCount?.toLocaleString() ?? "—"} <span className="text-xs text-muted-foreground">{fmtPct(s.patentTrendPct)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span className="px-1.5 py-0.5 rounded" style={{ background: heatColor(s.startupTrendPct) }}>
                      {s.startupCount?.toLocaleString() ?? "—"} <span className="text-xs text-muted-foreground">{fmtPct(s.startupTrendPct)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span className="px-1.5 py-0.5 rounded" style={{ background: heatColor(s.capitalTrendPct) }}>
                      {fmtMm(s.capitalFlowMm)} <span className="text-xs text-muted-foreground">{fmtPct(s.capitalTrendPct)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[240px]">
                      {(s.keyCapabilities ?? []).slice(0, 4).map((cid, i) => {
                        const name = capNameById.get(cid);
                        if (!name) return null;
                        return <span key={i} className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded">{name}</span>;
                      })}
                      {(!s.keyCapabilities || s.keyCapabilities.length === 0) && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[240px]">
                      {(s.keyCompanies ?? []).slice(0, 4).map((co, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">{co}</span>
                      ))}
                      {(!s.keyCompanies || s.keyCompanies.length === 0) && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3">
          {stages.map(s => {
            const capChips = (s.keyCapabilities ?? [])
              .map(cid => capNameById.get(cid))
              .filter((n): n is string => !!n);
            return (
              <div key={s.id} className="border rounded bg-card overflow-hidden">
                <div className="flex">
                  <div className="w-16 flex flex-col items-center justify-center text-muted-foreground border-r"
                    style={{ background: heatColor(s.capitalTrendPct) }}>
                    <div className="text-xs uppercase tracking-wider">Stage</div>
                    <div className="text-2xl font-mono font-semibold">{s.stageOrder}</div>
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <h4 className="text-lg font-serif text-foreground">{s.stageName}</h4>
                      {s.numSectors !== null && (
                        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {s.numSectors} NAICS sectors {s.hhiScore !== null && `· HHI ${s.hhiScore.toFixed(2)}`}
                        </span>
                      )}
                    </div>
                    {s.disruptionSummary && <p className="text-sm text-muted-foreground mb-3">{s.disruptionSummary}</p>}

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-3">
                      <div className="border-l-2 pl-2" style={{ borderColor: heatColor(s.patentTrendPct) }}>
                        <div className="text-xs text-muted-foreground">Patents (5yr)</div>
                        <div className="font-mono">{s.patentCount?.toLocaleString() ?? "—"} <span className="text-xs text-muted-foreground">{fmtPct(s.patentTrendPct)}</span></div>
                      </div>
                      <div className="border-l-2 pl-2" style={{ borderColor: heatColor(s.startupTrendPct) }}>
                        <div className="text-xs text-muted-foreground">Startups (5yr)</div>
                        <div className="font-mono">{s.startupCount?.toLocaleString() ?? "—"} <span className="text-xs text-muted-foreground">{fmtPct(s.startupTrendPct)}</span></div>
                      </div>
                      <div className="border-l-2 pl-2" style={{ borderColor: heatColor(s.capitalTrendPct) }}>
                        <div className="text-xs text-muted-foreground">Capital deployed</div>
                        <div className="font-mono">{fmtMm(s.capitalFlowMm)} <span className="text-xs text-muted-foreground">{fmtPct(s.capitalTrendPct)}</span></div>
                      </div>
                    </div>

                    {(s.shifts?.length || s.risks?.length) ? (
                      <div className="grid md:grid-cols-2 gap-3 mb-3">
                        {s.shifts && s.shifts.length > 0 && (
                          <div className="border-l-2 border-emerald-500/60 pl-3">
                            <div className="text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 mb-1.5">
                              <Zap className="w-3 h-3" /> Structural shifts
                            </div>
                            <ul className="text-sm space-y-1">
                              {s.shifts.slice(0, 5).map((sh, i) => <li key={i} className="text-foreground/85">• {sh}</li>)}
                            </ul>
                          </div>
                        )}
                        {s.risks && s.risks.length > 0 && (
                          <div className="border-l-2 border-rose-500/60 pl-3">
                            <div className="text-xs uppercase tracking-wider text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1 mb-1.5">
                              <AlertTriangle className="w-3 h-3" /> Disruptors & risks
                            </div>
                            <ul className="text-sm space-y-1">
                              {s.risks.slice(0, 5).map((r, i) => <li key={i} className="text-foreground/85">• {r}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {capChips.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Key capabilities</div>
                        <div className="flex flex-wrap gap-1">
                          {capChips.slice(0, 8).map((name, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded">{name}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {s.keyCompanies && s.keyCompanies.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Key companies</div>
                        <div className="flex flex-wrap gap-1">
                          {s.keyCompanies.slice(0, 8).map((co, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{co}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============== Sector × Quadrant Share ==============
function SectorQuadrantShare({ data }: { data: GraphData }) {
  const [industryFilter, setIndustryFilter] = useState<number | "all">("all");
  const [mode, setMode] = useState<"pct" | "count">("pct");

  const rows = useMemo(() => {
    const filtered = data.companies.filter(c =>
      (industryFilter === "all" || c.industryId === industryFilter) && c.naicsSector
    );
    const bySector = new Map<string, Record<string, number>>();
    for (const c of filtered) {
      const sec = c.naicsSector ?? "Unclassified";
      if (!bySector.has(sec)) bySector.set(sec, { hot: 0, emerging: 0, cooling: 0, table_stakes: 0 });
      const b = bySector.get(sec)!;
      if (c.quadrant in b) b[c.quadrant]++;
    }
    const arr = Array.from(bySector.entries()).map(([sector, counts]) => {
      const total = counts.hot + counts.emerging + counts.cooling + counts.table_stakes;
      return { sector, counts, total };
    }).filter(r => r.total > 0);
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [data.companies, industryFilter]);

  const maxTotal = Math.max(1, ...rows.map(r => r.total));
  const QUADS = ["hot", "emerging", "cooling", "table_stakes"] as const;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-serif">Sector × Quadrant Share</h3>
          <p className="text-sm text-muted-foreground">
            Distribution of Hot / Emerging / Cooling / Table-Stakes across NAICS sectors. {rows.length} sectors, {rows.reduce((s, r) => s + r.total, 0)} companies.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="inline-flex border rounded overflow-hidden text-xs">
            <button onClick={() => setMode("pct")}
              className={`px-3 py-1.5 ${mode === "pct" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              % share
            </button>
            <button onClick={() => setMode("count")}
              className={`px-3 py-1.5 border-l ${mode === "count" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              Absolute
            </button>
          </div>
          <select className="h-9 px-3 text-sm border bg-background rounded"
            value={industryFilter}
            onChange={e => setIndustryFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All industries</option>
            {data.industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3 flex-wrap">
        {QUADS.map(q => (
          <span key={q} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: QUADRANT_COLORS[q] }} />
            {QUADRANT_LABELS[q]}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="border rounded bg-card p-12 text-center text-muted-foreground">
          No sector-classified companies yet. Run enrichment to populate NAICS sectors.
        </div>
      ) : (
        <div className="border rounded bg-card divide-y">
          {rows.map(r => {
            const pct: Record<string, number> = {};
            QUADS.forEach(q => { pct[q] = r.total ? (r.counts[q] / r.total) * 100 : 0; });
            const barWidthPct = mode === "count" ? (r.total / maxTotal) * 100 : 100;
            return (
              <div key={r.sector} className="p-3 grid grid-cols-[minmax(180px,260px)_1fr_60px] gap-3 items-center">
                <div className="text-sm font-medium truncate" title={r.sector}>{r.sector}</div>
                <div className="relative h-6 rounded bg-muted/40 overflow-hidden" style={{ width: `${barWidthPct}%`, maxWidth: "100%" }}>
                  <div className="flex h-full">
                    {QUADS.map(q => {
                      const w = pct[q];
                      if (w <= 0) return null;
                      return (
                        <div key={q} className="h-full flex items-center justify-center text-[10px] font-medium text-white"
                          style={{ width: `${w}%`, background: QUADRANT_COLORS[q] }}
                          title={`${QUADRANT_LABELS[q]}: ${r.counts[q]} (${w.toFixed(0)}%)`}>
                          {w >= 12 ? `${w.toFixed(0)}%` : ""}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="text-xs font-mono text-muted-foreground text-right">n={r.total}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-muted-foreground mt-2">
        Each bar shows the quadrant mix of companies within that NAICS sector. A sector dominated by Hot + Emerging signals rapid capability reshuffling; Table-Stakes dominance signals commoditization.
      </div>
    </div>
  );
}

// ============== Company X-Ray ==============
function CompanyXRay({ data }: { data: GraphData }) {
  const [companyId, setCompanyId] = useState<number>(data.companies.sort((a, b) => b.feviScore - a.feviScore)[0]?.id ?? 0);
  const company = data.companies.find(c => c.id === companyId);
  const mappings = useMemo(() => data.companyMappings.filter(m => m.companyId === companyId), [data, companyId]);
  const linkedCaps = useMemo(() => {
    return mappings.map(m => {
      const cap = data.capabilities.find(c => c.id === m.capabilityId);
      return cap ? { ...cap, strength: m.strength } : null;
    }).filter(Boolean) as (CapabilityNode & { strength: string })[];
  }, [data, mappings]);

  const radarData = useMemo(() => {
    return linkedCaps.map(c => ({
      capability: c.name.length > 18 ? c.name.slice(0, 17) + "…" : c.name,
      Economic: c.economicImpactScore ?? 0,
      Adoption: c.adoptionMomentumScore ?? 0,
    }));
  }, [linkedCaps]);

  const quadrantDist = useMemo(() => {
    const d: Record<string, number> = { hot: 0, emerging: 0, cooling: 0, table_stakes: 0 };
    linkedCaps.forEach(c => { if (c.quadrant) d[c.quadrant] = (d[c.quadrant] ?? 0) + 1; });
    return d;
  }, [linkedCaps]);

  const total = Object.values(quadrantDist).reduce((a, b) => a + b, 0) || 1;

  if (!company) return <div className="text-muted-foreground">No companies enriched yet.</div>;

  const investmentImplications = [
    company.feviScore >= 0.7
      ? `Strong forecasted economic value (FEVI ${company.feviScore.toFixed(2)}) — candidate for strategic position sizing.`
      : company.feviScore >= 0.5
      ? `Moderate FEVI (${company.feviScore.toFixed(2)}) — monitor for inflection signals from agent.`
      : `Lower FEVI (${company.feviScore.toFixed(2)}) — speculative or early-stage exposure only.`,
    quadrantDist.hot + quadrantDist.emerging > quadrantDist.cooling + quadrantDist.table_stakes
      ? `Capability mix is forward-leaning — ${quadrantDist.hot + quadrantDist.emerging}/${total} capabilities in Hot or Emerging quadrants.`
      : `Capability mix is mature/commoditizing — ${quadrantDist.cooling + quadrantDist.table_stakes}/${total} in Cooling or Table-Stakes. Differentiation pressure rising.`,
    company.cdiScore >= 0.6
      ? `High Capability Disruption Index (${company.cdiScore.toFixed(2)}) — this firm is reshaping multiple value chain stages.`
      : `CDI ${company.cdiScore.toFixed(2)} — disruption footprint is contained; lower systemic risk to incumbents.`,
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-serif">Company X-Ray</h3>
          <p className="text-sm text-muted-foreground">Capability footprint, scores, and investment implications.</p>
        </div>
        <select className="h-9 px-3 text-sm border bg-background rounded min-w-[260px]" value={companyId} onChange={e => setCompanyId(Number(e.target.value))}>
          {data.companies.sort((a, b) => b.feviScore - a.feviScore).map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.country})</option>
          ))}
        </select>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Header card */}
        <div className="lg:col-span-3 border rounded bg-card p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-2xl font-serif text-foreground flex items-center gap-2">
                <Building2 className="w-6 h-6" /> {company.name}
              </h2>
              <div className="text-sm text-muted-foreground mt-1">
                {company.country} {company.naicsSector && `· ${company.naicsSector}`} {company.fundingStage && `· ${company.fundingStage}`}
              </div>
              <p className="text-sm mt-3 max-w-3xl">{company.description}</p>
            </div>
            <div className="flex gap-3">
              <div className="border rounded p-3 min-w-[110px]">
                <div className="text-xs text-muted-foreground uppercase">FEVI</div>
                <div className="text-2xl font-mono">{company.feviScore.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">Forecasted Economic Value</div>
              </div>
              <div className="border rounded p-3 min-w-[110px]">
                <div className="text-xs text-muted-foreground uppercase">CDI</div>
                <div className="text-2xl font-mono">{company.cdiScore.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">Capability Disruption Index</div>
              </div>
              <div className="border rounded p-3 min-w-[110px]" style={{ background: QUADRANT_COLORS[company.quadrant] + "22" }}>
                <div className="text-xs text-muted-foreground uppercase">Quadrant</div>
                <div className="text-lg font-semibold" style={{ color: QUADRANT_COLORS[company.quadrant] }}>{QUADRANT_LABELS[company.quadrant] ?? company.quadrant}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Radar */}
        <div className="lg:col-span-2 border rounded bg-card p-4">
          <div className="text-sm font-medium mb-2">Capability Radar (Economic Impact vs Adoption Momentum)</div>
          {radarData.length >= 3 ? (
            <ResponsiveContainer width="100%" height={360}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="currentColor" strokeOpacity={0.15} />
                <PolarAngleAxis dataKey="capability" tick={{ fontSize: 10, fill: "currentColor", opacity: 0.7 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: "currentColor", opacity: 0.5 }} />
                <Radar name="Economic Impact" dataKey="Economic" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.4} />
                <Radar name="Adoption Momentum" dataKey="Adoption" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                <RTooltip />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[360px] flex items-center justify-center text-muted-foreground text-sm">
              Need 3+ mapped capabilities to render radar (currently {radarData.length}).
            </div>
          )}
        </div>

        {/* Quadrant distribution */}
        <div className="border rounded bg-card p-4">
          <div className="text-sm font-medium mb-3">Capability Quadrant Mix</div>
          <div className="space-y-3">
            {(["hot", "emerging", "cooling", "table_stakes"] as const).map(q => {
              const n = quadrantDist[q] ?? 0;
              const pct = total ? (n / total) * 100 : 0;
              const Icon = QUADRANT_ICONS[q];
              return (
                <div key={q}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="flex items-center gap-1.5"><Icon className="w-3 h-3" style={{ color: QUADRANT_COLORS[q] }} />{QUADRANT_LABELS[q]}</span>
                    <span className="font-mono">{n} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 bg-muted rounded overflow-hidden">
                    <div className="h-full" style={{ width: `${pct}%`, background: QUADRANT_COLORS[q] }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t">
            <div className="text-sm font-medium mb-2">Mapped capabilities</div>
            <div className="space-y-1 max-h-[140px] overflow-y-auto">
              {linkedCaps.map(c => (
                <div key={c.id} className="text-xs flex justify-between">
                  <span className="truncate">{c.name}</span>
                  <span className="text-muted-foreground ml-2">{c.strength}</span>
                </div>
              ))}
              {linkedCaps.length === 0 && <div className="text-xs text-muted-foreground">No capability mappings.</div>}
            </div>
          </div>
        </div>

        {/* Investment implications */}
        <div className="lg:col-span-3 border rounded bg-card p-5">
          <div className="text-sm font-medium mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Investment Implications</div>
          <ol className="space-y-2 list-decimal list-inside text-sm text-foreground">
            {investmentImplications.map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}

// ============== Workbench shell ==============
const TABS = [
  { id: "quadrant", label: "Quadrant xRay", icon: Activity },
  { id: "spider", label: "Bipartite Spider", icon: Network },
  { id: "valuechain", label: "Value Chain", icon: GitBranch },
  { id: "sectormix", label: "Sector Mix", icon: PieChart },
  { id: "xray", label: "Company X-Ray", icon: ScanSearch },
] as const;

export default function Workbench() {
  const { data, loading, error } = useGraphData();
  const [tab, setTab] = useState<typeof TABS[number]["id"]>("quadrant");

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-6">
          <span className="inline-block px-2 py-0.5 text-xs font-semibold tracking-wider uppercase rounded bg-primary/10 text-primary mb-2">
            CE Workbench
          </span>
          <h1 className="text-4xl font-serif font-medium text-foreground">The Capability Lens</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl">
            Live agentic intelligence synthesized by our LangGraph agent (Perplexity research → GLM 5.1 synthesis → DB).
            All data sourced from autonomous research runs — no seed data, no mock fallbacks.
          </p>
        </div>

        {/* Counters */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="border rounded p-3 bg-card"><div className="text-xs text-muted-foreground">Capabilities classified</div><div className="text-2xl font-mono">{data.capabilities.filter(c => c.quadrant).length}</div></div>
            <div className="border rounded p-3 bg-card"><div className="text-xs text-muted-foreground">Value chain stages</div><div className="text-2xl font-mono">{data.valueChainStages.length}</div></div>
            <div className="border rounded p-3 bg-card"><div className="text-xs text-muted-foreground">Companies profiled</div><div className="text-2xl font-mono">{data.companies.length}</div></div>
            <div className="border rounded p-3 bg-card"><div className="text-xs text-muted-foreground">Capability mappings</div><div className="text-2xl font-mono">{data.companyMappings.length}</div></div>
          </div>
        )}

        {/* Tab strip */}
        <div className="border-b mb-6 flex gap-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
          <a href="/admin" className="ml-auto px-4 py-2.5 text-sm font-medium flex items-center gap-2 text-muted-foreground hover:text-primary">
            Run Enrichment <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {loading && (
          <div className="border rounded bg-card p-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading enrichment graph…
          </div>
        )}
        {error && (
          <div className="border border-red-500/30 bg-red-500/5 rounded p-6 text-red-700">Failed to load graph: {error}</div>
        )}
        {data && !loading && (
          <Card>
            <CardContent className="p-6">
              {tab === "quadrant" && <QuadrantXRay data={data} />}
              {tab === "spider" && <BipartiteSpider data={data} />}
              {tab === "valuechain" && <ValueChainSwimlane data={data} />}
              {tab === "sectormix" && <SectorQuadrantShare data={data} />}
              {tab === "xray" && <CompanyXRay data={data} />}
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
