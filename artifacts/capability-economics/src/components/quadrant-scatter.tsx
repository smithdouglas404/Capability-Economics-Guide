import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Flame, Sparkles, Snowflake, Layers, Filter } from "lucide-react";

// ============== Quadrant palette (matches console.tsx + ForceGraph) ==============
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
  hot: Flame,
  emerging: Sparkles,
  cooling: Snowflake,
  table_stakes: Layers,
};

const QUADRANT_TAGLINES: Record<string, string> = {
  hot: "High impact · Fast adoption — where the puck is",
  emerging: "High impact · Slow adoption — where the puck is going",
  cooling: "Low impact · Fast adoption — already commoditizing",
  table_stakes: "Low impact · Slow adoption — baseline hygiene",
};

// ============== Types ==============
export interface ScatterCapability {
  id: number;
  name: string;
  industryId: number;
  benchmarkScore: number;
  quadrant: string | null;
  economicImpactScore: number | null;
  adoptionMomentumScore: number | null;
  disruptionIntensity: number | null;
}

export interface ScatterIndustry {
  id: number;
  name: string;
  slug: string;
  icon: string;
}

export interface ScatterDependency {
  id: number;
  capabilityId: number;
  dependsOnId: number;
  strength: string;
}

interface EconomicsRow {
  capabilityId: number;
  industryId: number;
  revenueExposureMm: number | null;
  tamUsdMm: number | null;
}

interface QuadrantScatterProps {
  industries: ScatterIndustry[];
  capabilities: ScatterCapability[];
  dependencies: ScatterDependency[];
  onSelectCapability: (id: number) => void;
}

// ============== Quadrant classification helper ==============
// Canonical 4-quadrant grid (independent of any back-end label):
//   x = adoption_momentum, y = economic_impact, midpoint = 50.
function quadrantFromScores(am: number, ei: number): string {
  if (ei >= 50 && am >= 50) return "hot";
  if (ei >= 50 && am < 50) return "emerging";
  if (ei < 50 && am >= 50) return "cooling";
  return "table_stakes";
}

// Sqrt scale for bubble radius (px). Empty/null exposure → small constant.
function radiusForRevenue(revMm: number | null | undefined): number {
  if (revMm == null || revMm <= 0) return 6;
  // sqrt scale, clamped to keep things tasteful
  const r = Math.sqrt(revMm) * 0.9;
  return Math.max(6, Math.min(28, r));
}

function fmt$(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}B`;
  return `$${Math.round(n)}M`;
}

// ============== Custom tooltip ==============
interface TooltipPayloadItem {
  payload: ScatterPoint;
}
function ScatterTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const Icon = QUADRANT_ICONS[p.quadrant] ?? Layers;
  const color = QUADRANT_COLORS[p.quadrant] ?? "#94a3b8";
  return (
    <div className="bg-popover border shadow-xl rounded-md p-3 max-w-xs text-xs">
      <div className="flex items-start gap-2 mb-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color }} />
        <div className="min-w-0">
          <div className="font-semibold text-foreground leading-tight">{p.name}</div>
          <div className="text-muted-foreground">{p.industryName}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <span className="text-muted-foreground">Quadrant</span>
        <span className="font-medium" style={{ color }}>{QUADRANT_LABELS[p.quadrant] ?? p.quadrant}</span>
        <span className="text-muted-foreground">Economic Impact</span>
        <span className="font-mono">{p.y.toFixed(0)}</span>
        <span className="text-muted-foreground">Adoption Momentum</span>
        <span className="font-mono">{p.x.toFixed(0)}</span>
        <span className="text-muted-foreground">Revenue Exposure</span>
        <span className="font-mono">{fmt$(p.revenueExposureMm)}</span>
        {p.topDependencyName && (
          <>
            <span className="text-muted-foreground">Top dependency</span>
            <span className="text-foreground truncate">{p.topDependencyName}</span>
          </>
        )}
      </div>
      <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground italic">
        Click to open detail
      </div>
    </div>
  );
}

// ============== Internal point shape ==============
interface ScatterPoint {
  id: number;
  name: string;
  industryId: number;
  industryName: string;
  quadrant: string;
  x: number; // adoption momentum
  y: number; // economic impact
  z: number; // bubble radius (px) — used by ZAxis range
  revenueExposureMm: number | null;
  topDependencyName: string | null;
}

// ============== Main component ==============
export default function QuadrantScatter({
  industries,
  capabilities,
  dependencies,
  onSelectCapability,
}: QuadrantScatterProps) {
  const [industryFilter, setIndustryFilter] = useState<number | "all">("all");
  const [economics, setEconomics] = useState<Record<number, number | null>>({});
  const [econLoading, setEconLoading] = useState(true);

  // Fetch revenue exposure (capability_economics rows). Cheap single GET.
  useEffect(() => {
    let abort = false;
    setEconLoading(true);
    fetch("/api/alpha/economics")
      .then(r => (r.ok ? r.json() : []))
      .then((rows: EconomicsRow[]) => {
        if (abort) return;
        const map: Record<number, number | null> = {};
        for (const row of rows) {
          // Prefer revenueExposureMm; fall back to tamUsdMm so the chart still
          // sizes pre-enrichment caps in a reasonable way.
          map[row.capabilityId] = row.revenueExposureMm ?? row.tamUsdMm ?? null;
        }
        setEconomics(map);
      })
      .catch(() => {
        if (!abort) setEconomics({});
      })
      .finally(() => {
        if (!abort) setEconLoading(false);
      });
    return () => {
      abort = true;
    };
  }, []);

  // Build a name lookup + a "top dependency" picker per capability.
  const capNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of capabilities) m.set(c.id, c.name);
    return m;
  }, [capabilities]);

  const indNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of industries) m.set(i.id, i.name);
    return m;
  }, [industries]);

  const topDependencyByCapId = useMemo(() => {
    const strengthRank: Record<string, number> = { strong: 3, moderate: 2, weak: 1 };
    const best = new Map<number, { dependsOnId: number; strength: string }>();
    for (const d of dependencies) {
      const cur = best.get(d.capabilityId);
      const dRank = strengthRank[d.strength] ?? 0;
      const cRank = cur ? strengthRank[cur.strength] ?? 0 : -1;
      if (!cur || dRank > cRank) best.set(d.capabilityId, d);
    }
    return best;
  }, [dependencies]);

  // Build the points the chart actually renders.
  const points = useMemo<ScatterPoint[]>(() => {
    return capabilities
      .filter(c => c.economicImpactScore != null && c.adoptionMomentumScore != null)
      .filter(c => industryFilter === "all" || c.industryId === industryFilter)
      .map(c => {
        const am = c.adoptionMomentumScore!;
        const ei = c.economicImpactScore!;
        // Trust persisted quadrant if present; otherwise derive from scores.
        const quadrant = c.quadrant ?? quadrantFromScores(am, ei);
        const revMm = economics[c.id] ?? null;
        const dep = topDependencyByCapId.get(c.id);
        return {
          id: c.id,
          name: c.name,
          industryId: c.industryId,
          industryName: indNameById.get(c.industryId) ?? "",
          quadrant,
          x: am,
          y: ei,
          z: radiusForRevenue(revMm),
          revenueExposureMm: revMm,
          topDependencyName: dep ? capNameById.get(dep.dependsOnId) ?? null : null,
        };
      });
  }, [capabilities, industryFilter, economics, topDependencyByCapId, indNameById, capNameById]);

  // Counts per quadrant (after industry filter) for the legend.
  const counts = useMemo(() => {
    const c: Record<string, number> = { hot: 0, emerging: 0, cooling: 0, table_stakes: 0 };
    for (const p of points) c[p.quadrant] = (c[p.quadrant] ?? 0) + 1;
    return c;
  }, [points]);

  // Group points by quadrant so each <Scatter> series gets its own color/legend.
  const seriesByQuadrant = useMemo(() => {
    const g: Record<string, ScatterPoint[]> = { hot: [], emerging: [], cooling: [], table_stakes: [] };
    for (const p of points) (g[p.quadrant] ??= []).push(p);
    return g;
  }, [points]);

  return (
    <div className="container mx-auto px-4 max-w-6xl py-8 space-y-6">
      {/* Header strip — title + industry filter chips */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-serif text-foreground">Capability Quadrant</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Adoption Momentum × Economic Impact. Bubble size = revenue exposure. Click any
            capability to open its full economic detail.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <button
            onClick={() => setIndustryFilter("all")}
            className={`text-xs rounded-sm border px-2.5 py-1 transition-colors ${
              industryFilter === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            All ({capabilities.filter(c => c.economicImpactScore != null && c.adoptionMomentumScore != null).length})
          </button>
          {industries.map(i => {
            const count = capabilities.filter(
              c => c.industryId === i.id && c.economicImpactScore != null && c.adoptionMomentumScore != null,
            ).length;
            if (count === 0) return null;
            const active = industryFilter === i.id;
            return (
              <button
                key={i.id}
                onClick={() => setIndustryFilter(i.id)}
                className={`text-xs rounded-sm border px-2.5 py-1 transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary/40"
                }`}
              >
                {i.name} <span className="opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend — quadrant cards w/ counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(["hot", "emerging", "cooling", "table_stakes"] as const).map(q => {
          const Icon = QUADRANT_ICONS[q];
          return (
            <div key={q} className="border rounded-sm p-3 flex items-start gap-3 bg-card">
              <div
                className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                style={{ background: QUADRANT_COLORS[q] }}
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold" style={{ color: QUADRANT_COLORS[q] }}>
                    {QUADRANT_LABELS[q]}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">{counts[q] ?? 0}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  {QUADRANT_TAGLINES[q]}
                </p>
              </div>
              <Icon className="w-4 h-4 text-muted-foreground/40 ml-auto mt-0.5 shrink-0" />
            </div>
          );
        })}
      </div>

      {/* The chart card */}
      <Card className="rounded-none">
        <CardContent className="pt-6">
          {econLoading && points.length === 0 ? (
            <div className="h-[480px] flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : points.length === 0 ? (
            <div className="h-[480px] flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-2">
              <p className="font-medium text-foreground">No capabilities in view</p>
              <p className="max-w-md">
                Either no capabilities are classified yet, or the active industry filter excludes them.
                Try clearing the filter or running the enrichment pipeline.
              </p>
              <button
                onClick={() => setIndustryFilter("all")}
                className="mt-2 text-xs underline text-primary"
              >
                Clear filter
              </button>
            </div>
          ) : (
            <div className="w-full h-[480px] md:h-[560px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 24, right: 32, bottom: 56, left: 56 }}>
                  {/* Quadrant background fills (subtle) */}
                  <ReferenceArea
                    x1={50} x2={100} y1={50} y2={100}
                    fill={QUADRANT_COLORS.hot} fillOpacity={0.07}
                    stroke="none" ifOverflow="visible"
                  />
                  <ReferenceArea
                    x1={0} x2={50} y1={50} y2={100}
                    fill={QUADRANT_COLORS.emerging} fillOpacity={0.05}
                    stroke="none" ifOverflow="visible"
                  />
                  <ReferenceArea
                    x1={50} x2={100} y1={0} y2={50}
                    fill={QUADRANT_COLORS.cooling} fillOpacity={0.04}
                    stroke="none" ifOverflow="visible"
                  />
                  <ReferenceArea
                    x1={0} x2={50} y1={0} y2={50}
                    fill={QUADRANT_COLORS.table_stakes} fillOpacity={0.04}
                    stroke="none" ifOverflow="visible"
                  />

                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.15)" />

                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Adoption Momentum"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    label={{
                      value: "Adoption Momentum →",
                      position: "insideBottom",
                      offset: -16,
                      style: { fill: "hsl(var(--muted-foreground))", fontSize: 12 },
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Economic Impact"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    label={{
                      value: "Economic Impact →",
                      angle: -90,
                      position: "insideLeft",
                      offset: 0,
                      style: { fill: "hsl(var(--muted-foreground))", fontSize: 12, textAnchor: "middle" },
                    }}
                  />
                  <ZAxis type="number" dataKey="z" range={[60, 900]} />

                  {/* Mid-axis cross-hairs */}
                  <ReferenceLine x={50} stroke="hsl(var(--muted-foreground)/0.35)" strokeDasharray="2 2" />
                  <ReferenceLine y={50} stroke="hsl(var(--muted-foreground)/0.35)" strokeDasharray="2 2" />

                  <Tooltip
                    cursor={{ strokeDasharray: "3 3", stroke: "hsl(var(--muted-foreground)/0.4)" }}
                    content={<ScatterTooltip />}
                  />

                  {(["table_stakes", "cooling", "emerging", "hot"] as const).map(q => (
                    <Scatter
                      key={q}
                      name={QUADRANT_LABELS[q]}
                      data={seriesByQuadrant[q]}
                      fill={QUADRANT_COLORS[q]}
                      fillOpacity={0.7}
                      stroke={QUADRANT_COLORS[q]}
                      strokeWidth={1.5}
                      onClick={(pt) => {
                        const payload = pt as unknown as ScatterPoint;
                        if (payload?.id) onSelectCapability(payload.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {seriesByQuadrant[q].map(pt => (
                        <Cell key={pt.id} fill={QUADRANT_COLORS[q]} />
                      ))}
                    </Scatter>
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3 text-center">
            Bubble size ∝ √(revenue exposure $M). Hover for detail; click to drill in.
            {econLoading && points.length > 0 && " · Sizing data still loading…"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
