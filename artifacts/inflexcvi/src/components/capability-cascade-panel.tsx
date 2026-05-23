import { useEffect, useMemo, useState } from "react";
import { GitBranch, Loader2, AlertOctagon, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

const API_BASE = "/api";

interface CascadeNode {
  capabilityId: number;
  name: string;
  distance: number;
  evarAtRisk: number | null;
  pathFrom: string[];
}

interface CascadeResponse {
  rootCapabilityId: number;
  rootCapabilityName: string;
  depth: number;
  source: "neo4j" | "postgres";
  totalImpactUsdMm: number;
  nodes: CascadeNode[];
}

interface Props {
  capabilityId: number;
}

const DEPTH_OPTIONS = [1, 2, 3, 4] as const;

function formatUsdMm(mm: number | null): string {
  if (mm === null || mm === 0) return "—";
  if (mm >= 1000) return `$${(mm / 1000).toFixed(1)}B`;
  if (mm >= 1) return `$${mm.toFixed(0)}M`;
  return `$${(mm * 1000).toFixed(0)}K`;
}

function distanceTone(d: number): string {
  if (d === 1) return "bg-rose-500/15 text-rose-500 border-rose-500/40";
  if (d === 2) return "bg-amber-500/15 text-amber-500 border-amber-500/40";
  return "bg-muted text-muted-foreground border-border/60";
}

export function CapabilityCascadePanel({ capabilityId }: Props) {
  const [depth, setDepth] = useState<number>(3);
  const [data, setData] = useState<CascadeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(capabilityId) || capabilityId <= 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/cascade/${capabilityId}?depth=${depth}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CascadeResponse>;
      })
      .then(j => { if (!cancelled) setData(j); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load cascade"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId, depth]);

  // Group nodes by distance so the list renders as nested tiers.
  const grouped = useMemo(() => {
    if (!data) return [];
    const byDist = new Map<number, CascadeNode[]>();
    for (const n of data.nodes) {
      const arr = byDist.get(n.distance) ?? [];
      arr.push(n);
      byDist.set(n.distance, arr);
    }
    return [...byDist.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dist, nodes]) => ({
        dist,
        nodes: nodes.sort((a, b) => (b.evarAtRisk ?? 0) - (a.evarAtRisk ?? 0)),
      }));
  }, [data]);

  return (
    <Card className="rounded-none border-border/60">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-serif text-xl tracking-tight">Downstream impact cascade</h2>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
            if this capability fails
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mr-1">Depth</span>
            {DEPTH_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] border ${depth === d ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Traversing dependency graph…
          </div>
        )}

        {error && <p className="text-sm text-rose-500">{error}</p>}

        {!loading && data && data.nodes.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            No downstream dependencies recorded — nothing in the graph fails if this capability fails.
          </p>
        )}

        {!loading && data && data.nodes.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border border-border/40 bg-muted/20 p-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Affected caps</div>
                <div className="font-mono text-2xl tabular-nums">{data.nodes.length}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Max distance</div>
                <div className="font-mono text-2xl tabular-nums">{Math.max(...data.nodes.map(n => n.distance))}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Total EVaR</div>
                <div className="font-mono text-2xl tabular-nums text-rose-500">{formatUsdMm(data.totalImpactUsdMm || null)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Source</div>
                <div className="font-mono text-sm tabular-nums uppercase">{data.source}</div>
              </div>
            </div>

            <div className="space-y-3">
              {grouped.map(({ dist, nodes }) => (
                <div key={dist}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${distanceTone(dist)}`}>
                      {dist}-hop
                    </Badge>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {nodes.length} capabilit{nodes.length === 1 ? "y" : "ies"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {nodes.map(n => (
                      <li
                        key={n.capabilityId}
                        className="flex items-start gap-2 border-l-2 border-border/60 hover:border-foreground/60 transition-colors py-1.5"
                        style={{ paddingLeft: `${0.75 + (dist - 1) * 1.25}rem` }}
                      >
                        {dist > 1 && <AlertOctagon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/capability/${n.capabilityId}`}
                              className="text-sm font-medium hover:underline truncate"
                            >
                              {n.name}
                            </Link>
                            {n.evarAtRisk !== null && n.evarAtRisk > 0 && (
                              <span className="font-mono text-[11px] tabular-nums text-rose-500">
                                {formatUsdMm(n.evarAtRisk)} at risk
                              </span>
                            )}
                          </div>
                          {n.pathFrom.length > 1 && (
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono mt-0.5 flex-wrap">
                              {n.pathFrom.map((name, i) => (
                                <span key={i} className="inline-flex items-center gap-1">
                                  {i > 0 && <ChevronRight className="w-3 h-3" />}
                                  <span className={i === 0 ? "text-foreground" : ""}>{name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground italic">
              EVaR (Economic Value at Risk) sourced from capability_alpha.revenue_exposure_mm. Total assumes simultaneous failure across the cascade — actual blast radius depends on dependency strength and time-to-recover.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
