import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Plus,
  X,
  Search,
  Loader2,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

const API_BASE = "/api";

interface ListedCap {
  id: number;
  name: string;
  slug: string;
}

interface ComparedCap {
  id: number;
  missing: boolean;
  name?: string;
  slug?: string;
  description?: string;
  industry?: { id: number; name: string; slug: string };
  reviewStatus?: string;
  isLeaf?: boolean;
  benchmarkScore?: number;
  consensusScore?: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
  confidence?: number | null;
  velocity?: number | null;
  sourceCount?: number;
  lastQueriedAt?: string | null;
  lifecycleStage?: string;
  patentCount?: number;
  vcCapitalUsd?: number;
  startupCount?: number;
  metrics?: Array<{ name: string; unit: string; benchmarkValue: number | null }>;
}

const SERIES_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9"];

const LIFECYCLE_TONE: Record<string, string> = {
  emerging: "bg-violet-500/15 text-violet-500 border-violet-500/40",
  adopted: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  mature: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  decaying: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  obsolete: "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

function VelocityIcon({ v, className }: { v: number | null | undefined; className?: string }) {
  if (v === null || v === undefined) return <Minus className={className ?? "w-4 h-4 text-muted-foreground"} />;
  if (v > 0.5) return <ArrowUp className={className ?? "w-4 h-4 text-emerald-500"} />;
  if (v < -0.5) return <ArrowDown className={className ?? "w-4 h-4 text-rose-500"} />;
  return <Minus className={className ?? "w-4 h-4 text-muted-foreground"} />;
}

function parseIds(search: string): number[] {
  const params = new URLSearchParams(search);
  return (params.get("ids") ?? "")
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n > 0);
}

export default function ComparePage() {
  const [location, setLocation] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const initialIds = parseIds(search);
  const [ids, setIds] = useState<number[]>(initialIds);
  const [caps, setCaps] = useState<ComparedCap[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allCaps, setAllCaps] = useState<ListedCap[]>([]);
  const [picker, setPicker] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/capabilities`).then(r => r.json()).then((data: ListedCap[]) => setAllCaps(data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (ids.length > 0) params.set("ids", ids.join(","));
    else params.delete("ids");
    const next = `/compare${params.toString() ? `?${params.toString()}` : ""}`;
    if (next !== location + search) setLocation(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => {
    if (ids.length < 2) {
      setCaps(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`${API_BASE}/compare/capabilities?ids=${ids.join(",")}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { entities: ComparedCap[] }) => {
        if (!cancelled) setCaps(d.entities);
      })
      .catch(e => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load comparison");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const radarData = useMemo(() => {
    if (!caps || caps.length === 0) return [];
    // Five axes scaled to 0–100 for visual comparison.
    const axes: Array<{ label: string; pick: (c: ComparedCap) => number | null }> = [
      { label: "CVI score", pick: c => c.consensusScore ?? c.benchmarkScore ?? null },
      { label: "Confidence ×100", pick: c => c.confidence !== null && c.confidence !== undefined ? c.confidence * 100 : null },
      { label: "Velocity (+50)", pick: c => c.velocity !== null && c.velocity !== undefined ? Math.max(0, Math.min(100, c.velocity + 50)) : null },
      { label: "Source count ×10", pick: c => c.sourceCount !== undefined ? Math.min(100, c.sourceCount * 10) : null },
      { label: "Startup count ×5", pick: c => c.startupCount !== undefined ? Math.min(100, c.startupCount * 5) : null },
    ];
    return axes.map(a => {
      const row: Record<string, number | string> = { axis: a.label };
      for (const c of caps) {
        if (c.missing || !c.name) continue;
        const v = a.pick(c);
        row[c.name] = v ?? 0;
      }
      return row;
    });
  }, [caps]);

  function addId(id: number) {
    if (ids.includes(id) || ids.length >= 5) return;
    setIds([...ids, id]);
    setPicker("");
  }
  function removeId(id: number) {
    setIds(ids.filter(i => i !== id));
  }

  const filteredPicker = picker.trim().length === 0
    ? []
    : allCaps.filter(c => c.name.toLowerCase().includes(picker.trim().toLowerCase()) && !ids.includes(c.id)).slice(0, 8);

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to explore
        </Link>
        <h1 className="font-serif text-3xl tracking-tight">Compare capabilities</h1>
        <p className="text-sm text-muted-foreground mt-1">Pick 2–5 capabilities to compare side by side.</p>
      </div>

      <Card className="rounded-none border-border/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {ids.length === 0 && (
              <span className="text-sm text-muted-foreground">No capabilities selected yet — start typing below.</span>
            )}
            {ids.map((id, i) => {
              const cap = (caps ?? []).find(c => c.id === id);
              return (
                <Badge key={id} variant="outline" className="rounded-none font-mono text-[11px] inline-flex items-center gap-2 px-2 py-1">
                  <span className="w-2.5 h-2.5" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {cap?.name ?? `#${id}`}
                  <button onClick={() => removeId(id)} className="hover:text-rose-500">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
          {ids.length < 5 && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={picker}
                onChange={e => setPicker(e.target.value)}
                placeholder="Search a capability to add…"
                className="rounded-none pl-9"
              />
              {filteredPicker.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-background border border-border/60 shadow-md">
                  {filteredPicker.map(c => (
                    <button
                      key={c.id}
                      onClick={() => addId(c.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2"
                    >
                      <Plus className="w-3 h-3 text-muted-foreground" />
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {err && (
        <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm font-mono">{err}</div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading comparison…
        </div>
      )}

      {caps && caps.length >= 2 && !loading && (
        <>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-5">
              <h2 className="font-serif text-xl tracking-tight mb-4">Side-by-side</h2>
              <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${caps.length}, minmax(0, 1fr))` }}>
                {caps.map((c, i) => (
                  <div key={c.id} className="border border-border/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                      <Link href={`/capability/${c.id}`} className="text-sm font-semibold hover:underline truncate">
                        {c.name ?? `#${c.id}`}
                      </Link>
                    </div>
                    {c.missing ? (
                      <p className="text-xs text-muted-foreground italic">Not found</p>
                    ) : (
                      <>
                        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{c.industry?.name}</div>
                        {c.lifecycleStage && (
                          <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${LIFECYCLE_TONE[c.lifecycleStage] ?? "bg-muted text-muted-foreground border-border/60"}`}>
                            {c.lifecycleStage}
                          </Badge>
                        )}
                        <div className="font-mono text-3xl tabular-nums">
                          {c.consensusScore !== null && c.consensusScore !== undefined ? c.consensusScore.toFixed(1) : (c.benchmarkScore ?? 0).toFixed(1)}
                        </div>
                        {c.ciLow !== null && c.ciLow !== undefined && c.ciHigh !== null && c.ciHigh !== undefined && (
                          <div className="font-mono text-[10px] text-muted-foreground tabular-nums">CI [{c.ciLow.toFixed(1)}, {c.ciHigh.toFixed(1)}]</div>
                        )}
                        <div className="flex items-center gap-2 text-xs">
                          <VelocityIcon v={c.velocity} className="w-3.5 h-3.5" />
                          <span className="font-mono tabular-nums">{c.velocity === null || c.velocity === undefined ? "—" : c.velocity.toFixed(2)}</span>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {c.sourceCount ?? 0} src · conf {c.confidence === null || c.confidence === undefined ? "—" : c.confidence.toFixed(2)}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-5">
              <h2 className="font-serif text-xl tracking-tight mb-4">Radar</h2>
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                    {caps.filter(c => !c.missing && c.name).map((c, i) => (
                      <Radar
                        key={c.id}
                        name={c.name!}
                        dataKey={c.name!}
                        stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                        fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                        fillOpacity={0.15}
                      />
                    ))}
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-2">
                Axes normalized to 0–100. Velocity offset +50. Source count ×10. Startup count ×5.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      <th className="px-4 py-3">Metric</th>
                      {caps.map(c => <th key={c.id} className="px-4 py-3">{c.name ?? `#${c.id}`}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "CVI score", pick: (c: ComparedCap) => c.consensusScore?.toFixed(1) ?? c.benchmarkScore?.toFixed(1) ?? "—" },
                      { label: "CI low", pick: (c: ComparedCap) => c.ciLow?.toFixed(1) ?? "—" },
                      { label: "CI high", pick: (c: ComparedCap) => c.ciHigh?.toFixed(1) ?? "—" },
                      { label: "Confidence", pick: (c: ComparedCap) => c.confidence?.toFixed(2) ?? "—" },
                      { label: "Velocity", pick: (c: ComparedCap) => c.velocity?.toFixed(2) ?? "—" },
                      { label: "Sources", pick: (c: ComparedCap) => String(c.sourceCount ?? 0) },
                      { label: "Lifecycle", pick: (c: ComparedCap) => c.lifecycleStage ?? "—" },
                      { label: "Patents", pick: (c: ComparedCap) => String(c.patentCount ?? 0) },
                      { label: "VC capital", pick: (c: ComparedCap) => `$${((c.vcCapitalUsd ?? 0) / 1e9).toFixed(1)}B` },
                      { label: "Startups", pick: (c: ComparedCap) => String(c.startupCount ?? 0) },
                      { label: "Industry", pick: (c: ComparedCap) => c.industry?.name ?? "—" },
                      { label: "Last queried", pick: (c: ComparedCap) => c.lastQueriedAt ? new Date(c.lastQueriedAt).toLocaleDateString() : "—" },
                    ].map(row => (
                      <tr key={row.label} className="border-t border-border/40">
                        <td className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{row.label}</td>
                        {caps.map(c => <td key={c.id} className="px-4 py-2 font-mono tabular-nums">{row.pick(c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
