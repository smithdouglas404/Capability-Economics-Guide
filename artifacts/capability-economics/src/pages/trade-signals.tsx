import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Target, Zap, RefreshCw, BarChart3 } from "lucide-react";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

type Signal = {
  id: number;
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  signal: string;
  strength: number;
  ceQuadrant: string;
  streetQuadrant: string;
  spreadPct: number;
  rationale: string;
  resolved: boolean;
  outcome: string | null;
  returnPct: number | null;
  createdAt: string;
};

type Performance = {
  totalSignals: number;
  activeSignals: number;
  resolvedSignals: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgReturnPct: number;
  longCount: number;
  shortCount: number;
};

export default function TradeSignals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch(`${API_BASE}/trade-signals`),
        fetch(`${API_BASE}/trade-signals/performance`),
      ]);
      setSignals(await sRes.json());
      setPerf(await pRes.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      await fetch(`${API_BASE}/trade-signals/generate`, { method: "POST" });
      await load();
    } catch (err) { console.error(err); }
    setGenerating(false);
  };

  const active = signals.filter((s) => !s.resolved);
  const resolved = signals.filter((s) => s.resolved);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <MobileNotice />
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Alpha</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Capability Trade Signals</h1>
          <p className="text-muted-foreground text-sm mt-1">Long/short signals from CE vs. street quadrant divergence with historical performance tracking.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={generate} disabled={generating} variant="default">
            <Zap className="w-4 h-4 mr-2" /> {generating ? "Generating..." : "Generate Signals"}
          </Button>
          <Button onClick={load} disabled={loading} variant="outline"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      {/* Performance Dashboard */}
      {perf && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-bold">{perf.totalSignals}</p>
              <p className="text-xs text-muted-foreground">Total Signals</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-bold text-primary">{perf.activeSignals}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-bold text-emerald-500">{perf.hitRate.toFixed(0)}%</p>
              <p className="text-xs text-muted-foreground">Hit Rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-2xl font-bold">{perf.avgReturnPct.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Avg Return</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="flex justify-center gap-3">
                <div><span className="text-emerald-500 font-bold">{perf.longCount}</span> <span className="text-xs text-muted-foreground">Long</span></div>
                <div><span className="text-destructive font-bold">{perf.shortCount}</span> <span className="text-xs text-muted-foreground">Short</span></div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Distribution</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Signals */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Target className="w-5 h-5" /> Active Signals ({active.length})</CardTitle></CardHeader>
        <CardContent>
          {active.length > 0 ? (
            <div className="space-y-3">
              {active.map((s) => (
                <div key={s.id} className="flex items-start gap-4 border-b pb-3">
                  <div className="shrink-0 mt-1">
                    {s.signal === "long" ? (
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-emerald-500" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center">
                        <TrendingDown className="w-5 h-5 text-destructive" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={s.signal === "long" ? "default" : "destructive"} className="uppercase text-xs">{s.signal}</Badge>
                      <span className="font-medium">{s.capabilityName}</span>
                      <span className="text-xs text-muted-foreground">({s.industryName})</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{s.rationale}</p>
                    <div className="flex gap-3 mt-2 text-xs">
                      <span>Strength: <strong>{s.strength.toFixed(0)}</strong></span>
                      <span>Spread: <strong>{s.spreadPct > 0 ? "+" : ""}{s.spreadPct?.toFixed(1)}%</strong></span>
                      <span>CE: <Badge variant="outline" className="text-xs">{s.ceQuadrant}</Badge></span>
                      <span>Street: <Badge variant="outline" className="text-xs">{s.streetQuadrant}</Badge></span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No active signals. Click "Generate Signals" to scan for opportunities.</p>
          )}
        </CardContent>
      </Card>

      {/* Resolved Signals */}
      {resolved.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Resolved ({resolved.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Signal</th>
                    <th className="text-left py-2">Capability</th>
                    <th className="text-right py-2">Spread</th>
                    <th className="text-right py-2">Outcome</th>
                    <th className="text-right py-2">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((s) => (
                    <tr key={s.id} className="border-b">
                      <td className="py-2"><Badge variant={s.signal === "long" ? "default" : "destructive"} className="text-xs uppercase">{s.signal}</Badge></td>
                      <td className="py-2">{s.capabilityName}</td>
                      <td className="text-right py-2">{s.spreadPct?.toFixed(1)}%</td>
                      <td className="text-right py-2">
                        <Badge variant={s.outcome === "hit" ? "default" : "destructive"} className="text-xs">{s.outcome ?? "?"}</Badge>
                      </td>
                      <td className="text-right py-2">{s.returnPct !== null ? `${s.returnPct > 0 ? "+" : ""}${s.returnPct.toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
