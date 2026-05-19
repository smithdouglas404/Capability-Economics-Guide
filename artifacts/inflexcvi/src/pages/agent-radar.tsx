/**
 * /agent-radar — "3-quarter early detection advantage" bar chart.
 *
 * Spec: deck p9 "Agent Radar — Surfacing signals before they become consensus."
 * Two-series bar chart over Q1-Q7: when the CE engine first detected a
 * signal (rising blue bars starting Q3) vs when market consensus formed
 * (amber bars catching up Q5-Q7).
 *
 * Data source: /api/agent-radar/series — joins cvi_signal_events (when CE
 * detected) with macro_events (proxy for when consensus formed). Falls
 * back to a representative demo dataset so the page renders before the
 * server endpoint exists.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Zap, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { SourceRow } from "@/components/source-badge";

interface SeriesPoint { quarter: string; ceDetected: number; marketConsensus: number; }

/** Demo series mirrors the deck shape — CE bars start visible Q3, market
 *  bars start tracking Q5-Q6, identical max by Q7. Used when the live
 *  endpoint isn't wired yet. */
const DEMO_SERIES: SeriesPoint[] = [
  { quarter: "Q1", ceDetected: 0,  marketConsensus: 0 },
  { quarter: "Q2", ceDetected: 5,  marketConsensus: 0 },
  { quarter: "Q3", ceDetected: 18, marketConsensus: 0 },
  { quarter: "Q4", ceDetected: 32, marketConsensus: 4 },
  { quarter: "Q5", ceDetected: 54, marketConsensus: 14 },
  { quarter: "Q6", ceDetected: 78, marketConsensus: 42 },
  { quarter: "Q7", ceDetected: 92, marketConsensus: 76 },
];

export default function AgentRadarPage() {
  const [series, setSeries] = useState<SeriesPoint[]>(DEMO_SERIES);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent-radar/series").then(r => r.ok ? r.json() : null).then((d: { series?: SeriesPoint[] } | null) => {
      if (!cancelled && d && Array.isArray(d.series) && d.series.length > 0) {
        setSeries(d.series);
        setIsLive(true);
      }
    }).catch(() => { /* keep demo */ });
    return () => { cancelled = true; };
  }, []);

  const max = Math.max(1, ...series.flatMap(p => [p.ceDetected, p.marketConsensus]));

  // Find inflection labels: first quarter CE > 10 (signal detected),
  // first quarter market > 30 (consensus formed). Used for the floating
  // annotations.
  const ceInflectionIdx = series.findIndex(p => p.ceDetected >= 10);
  const marketInflectionIdx = series.findIndex(p => p.marketConsensus >= 30);
  const advantageQuarters = ceInflectionIdx >= 0 && marketInflectionIdx >= 0
    ? marketInflectionIdx - ceInflectionIdx
    : null;

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>

      <PageHeader
        eyebrow="Insights & Alerts"
        title="Agent Radar"
        descriptions={{
          default: "Surfacing capability signals before they become market consensus. The blue bars are when CE first detected a signal; the amber bars are when the broader market caught up.",
          pe: "Diligence advantage in quarters, not quotes. By the time a target shows up on a banker's screen, CE was tracking it ~3 quarters earlier.",
          vc: "Front-running the thesis cycle. The blue lead time is your window to underwrite before the deck circulates.",
          f500: "Strategic foresight as KPI. If your strategy team is reading the market-consensus timing, you're already behind cohort.",
          student: "Time-series proof of an early-detection edge. Same data, two series; the gap between them is the entire pitch.",
          professor: "Live measurement of detection lag. Methodology and the underlying signal-detection cron are documented at /methodology.",
        }}
      />

      {!isLive && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 text-xs text-amber-500">
            Showing representative demo data — the live <code>/api/agent-radar/series</code> endpoint isn't yet wired. Real series will replace this automatically once published.
          </CardContent>
        </Card>
      )}

      <SourceRow sources={["internal", "edgar", "perplexity-seeded"]} label="Powered by" />

      {/* Bar chart */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
            <div className="font-serif text-2xl tracking-tight">Detection vs consensus, by quarter</div>
            {advantageQuarters !== null && advantageQuarters > 0 && (
              <Badge className="border border-accent/40 bg-accent/10 text-accent rounded-md px-3 py-1">
                <Zap className="w-3 h-3 mr-1" /> {advantageQuarters}-quarter early-detection advantage
              </Badge>
            )}
          </div>

          {/* Chart — pure SVG so it scales without recharts. */}
          <div className="relative">
            <svg viewBox="0 0 700 320" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
              {/* Y axis grid */}
              {[0, 25, 50, 75, 100].map(y => {
                const yPos = 280 - (y / 100) * 250;
                return (
                  <g key={y}>
                    <line x1="40" x2="680" y1={yPos} y2={yPos} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 4" />
                    <text x="32" y={yPos + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{y}</text>
                  </g>
                );
              })}

              {/* Bars */}
              {series.map((p, i) => {
                const colW = (640 / series.length); // 700 - 40 - 20 margin
                const xCenter = 40 + i * colW + colW / 2;
                const barW = Math.min(50, colW * 0.35);
                const ceH = (p.ceDetected / max) * 250;
                const mkH = (p.marketConsensus / max) * 250;
                return (
                  <g key={p.quarter}>
                    {/* Market consensus bar (behind, amber) */}
                    <rect
                      x={xCenter - barW + 2}
                      y={280 - mkH}
                      width={barW}
                      height={mkH}
                      className="fill-amber-500"
                      opacity={0.85}
                    />
                    {/* CE detection bar (front, blue) */}
                    <rect
                      x={xCenter - 2}
                      y={280 - ceH}
                      width={barW}
                      height={ceH}
                      className="fill-blue-500"
                      opacity={0.95}
                    />
                    {/* X label */}
                    <text x={xCenter} y={300} textAnchor="middle" className="fill-muted-foreground text-[11px] font-mono">
                      {p.quarter}
                    </text>
                  </g>
                );
              })}

              {/* Floating annotations */}
              {ceInflectionIdx >= 0 && (
                <g>
                  {(() => {
                    const colW = (640 / series.length);
                    const xCenter = 40 + ceInflectionIdx * colW + colW / 2;
                    return (
                      <>
                        <rect x={xCenter - 50} y={130} width={100} height={22} rx={4} className="fill-blue-500/20 stroke-blue-500/40" />
                        <text x={xCenter} y={145} textAnchor="middle" className="fill-blue-500 text-[10px] font-medium">CE detects signal</text>
                      </>
                    );
                  })()}
                </g>
              )}
              {marketInflectionIdx >= 0 && (
                <g>
                  {(() => {
                    const colW = (640 / series.length);
                    const xCenter = 40 + marketInflectionIdx * colW + colW / 2;
                    return (
                      <>
                        <rect x={xCenter - 55} y={60} width={110} height={22} rx={4} className="fill-amber-500/20 stroke-amber-500/40" />
                        <text x={xCenter} y={75} textAnchor="middle" className="fill-amber-500 text-[10px] font-medium">Market consensus</text>
                      </>
                    );
                  })()}
                </g>
              )}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-end gap-4 mt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm bg-blue-500" /> CE Detection
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm bg-amber-500" /> Market Consensus
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Below-the-fold reading */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="font-serif text-3xl text-blue-500 tabular-nums">
              {advantageQuarters !== null ? `${advantageQuarters}Q` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Early-detection lead time over market consensus</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-serif text-3xl text-amber-500 tabular-nums">
              {series[series.length - 1]?.ceDetected ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">CE detection peak (latest quarter)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-serif text-3xl text-muted-foreground tabular-nums inline-flex items-baseline gap-1">
              <TrendingUp className="w-5 h-5" /> {series.length}Q
            </div>
            <div className="text-xs text-muted-foreground mt-1">Window of historical data shown</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
