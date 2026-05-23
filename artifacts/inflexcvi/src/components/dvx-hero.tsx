/**
 * DVX Hero — the missing "Disruption Index" surfacing block.
 *
 * Move 5 of the strategic UX overhaul. The DVX (Disruption Velocity Index)
 * is a real, computed index — three weighted factors: velocity divergence
 * 40% + dependency fragility 30% + pattern-match confidence 30%. It lives
 * in lib/db/src/schema/dvx.ts and is served by /api/dvx/overall +
 * /api/dvx/history. But the previous /disruption page only showed the
 * row-level feed, not the index itself.
 *
 * This component is the headline: the overall score (0-100), a 30-day
 * sparkline, and an industry breakdown grid. Drops in at the top of any
 * page that wants to show "disruption right now."
 */
import { useEffect, useState } from "react";
import { Zap, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceRow } from "@/components/source-badge";

interface IndustryBreakdown {
  weight: number;
  velocity: number;
  indexValue: number;
  industryName: string;
  capabilityCount: number;
  topDisruptedCapability?: string;
  topDisruptorInnovation?: string;
}

interface DvxOverall {
  id: number;
  overallIndex: number;
  industryBreakdowns: Record<string, IndustryBreakdown>;
}

interface DvxHistoryPoint {
  snapshotAt: string;
  overallIndex: number;
}

/** Generates a normalized SVG path for a small inline sparkline. */
function sparklinePath(points: DvxHistoryPoint[], width = 200, height = 36): string {
  if (points.length === 0) return "";
  const values = points.map(p => p.overallIndex);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return points.map((p, i) => {
    const x = (i / Math.max(1, points.length - 1)) * width;
    const y = height - ((p.overallIndex - min) / range) * (height - 4) - 2;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

/** Map a 0-100 DVX score to a qualitative bucket + tone color. */
function severityFor(score: number): { label: string; tone: string; emoji: string } {
  if (score >= 70) return { label: "Active disruption", tone: "text-rose-500", emoji: "🔥" };
  if (score >= 40) return { label: "Elevated risk", tone: "text-amber-500", emoji: "⚠" };
  if (score >= 20) return { label: "Watch", tone: "text-blue-500", emoji: "👀" };
  return { label: "Stable", tone: "text-emerald-500", emoji: "✓" };
}

export function DvxHero() {
  const [overall, setOverall] = useState<DvxOverall | null>(null);
  const [history, setHistory] = useState<DvxHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [oResp, hResp] = await Promise.all([
          fetch("/api/dvx/overall"),
          fetch("/api/dvx/history?days=30"),
        ]);
        if (!oResp.ok || !hResp.ok) throw new Error(`DVX HTTP ${oResp.status}/${hResp.status}`);
        const oData = await oResp.json() as DvxOverall;
        const hData = await hResp.json() as { series: DvxHistoryPoint[] };
        if (!cancelled) {
          setOverall(oData);
          setHistory(hData.series ?? []);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <Skeleton className="w-full h-64 rounded-md" />;
  }
  if (err || !overall) {
    return (
      <Card className="border-rose-500/30 bg-rose-500/5">
        <CardContent className="p-4 text-sm text-rose-500">
          Disruption Index failed to load{err ? `: ${err}` : ""}.
        </CardContent>
      </Card>
    );
  }

  const severity = severityFor(overall.overallIndex);
  const breakdowns = Object.entries(overall.industryBreakdowns).map(([id, b]) => ({ id, ...b }));
  // Sort by indexValue descending — the most-disrupted industries first.
  breakdowns.sort((a, b) => b.indexValue - a.indexValue);

  const path = sparklinePath(history);
  const first = history[0]?.overallIndex;
  const last = history.at(-1)?.overallIndex;
  const delta30d = first !== undefined && last !== undefined ? last - first : 0;

  return (
    <Card className="border-rose-500/20">
      <CardContent className="p-6">
        <div className="grid lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
          {/* Index reading */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-rose-500" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-rose-500">Disruption Index (DVX)</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-6xl tabular-nums">{overall.overallIndex.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </div>
            <div className={`text-sm font-medium mt-1 ${severity.tone}`}>
              {severity.emoji} {severity.label}
            </div>

            {/* 30-day sparkline */}
            {history.length > 1 && (
              <div className="mt-4">
                <svg viewBox="0 0 200 36" className="w-full h-9">
                  <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-rose-500/80" />
                </svg>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                  <span>30d ago</span>
                  <span className={delta30d > 0 ? "text-rose-500" : delta30d < 0 ? "text-emerald-500" : ""}>
                    {delta30d > 0 ? "+" : ""}{delta30d.toFixed(2)} pts
                  </span>
                  <span>today</span>
                </div>
              </div>
            )}
          </div>

          {/* Industry breakdown */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">By industry · sorted by disruption level</span>
            </div>
            <div className="mb-3">
              <SourceRow sources={["internal", "world-bank", "edgar", "anthropic"]} label="Powered by" />
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {breakdowns.map(b => {
                const s = severityFor(b.indexValue);
                return (
                  <div key={b.id} className="border border-border/60 rounded-md p-3 hover:border-rose-500/40 transition-colors">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{b.industryName}</span>
                      <span className={`font-mono tabular-nums text-sm font-medium ${s.tone}`}>
                        {b.indexValue.toFixed(1)}
                      </span>
                    </div>
                    {b.topDisruptedCapability && (
                      <div className="text-[11px] text-muted-foreground leading-snug">
                        <span className="text-foreground/70">Most disrupted:</span> {b.topDisruptedCapability}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground-soft">
                      <TrendingUp className="w-2.5 h-2.5" />
                      {b.capabilityCount} caps · {(b.weight * 100).toFixed(1)}% GDP weight
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Compact inline DVX chip — for the home page ticker area, mini cards, etc.
 * Just shows the score + severity, no breakdown.
 */
export function DvxChip({ className }: { className?: string }) {
  const [overall, setOverall] = useState<DvxOverall | null>(null);
  useEffect(() => {
    fetch("/api/dvx/overall")
      .then(r => r.ok ? r.json() : null)
      .then((d: DvxOverall | null) => setOverall(d))
      .catch(() => {});
  }, []);
  if (!overall) return null;
  const s = severityFor(overall.overallIndex);
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 border border-border/60 rounded-md ${className ?? ""}`}>
      <Zap className={`w-3.5 h-3.5 ${s.tone}`} />
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">DVX</span>
      <span className={`font-mono tabular-nums text-sm font-medium ${s.tone}`}>{overall.overallIndex.toFixed(1)}</span>
      <span className="text-xs text-muted-foreground">·</span>
      <span className={`text-xs ${s.tone}`}>{s.label}</span>
    </div>
  );
}
