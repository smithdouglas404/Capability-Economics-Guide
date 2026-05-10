import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, Activity, AlertTriangle, RefreshCw, Cpu, Zap } from "lucide-react";

import { MobileNotice } from "@/components/mobile";
type Summary = {
  windowHours: number;
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; errors: number; quota: number };
  byModel: Array<{ model: string; calls: number; tokens: number; costUsd: number }>;
  byEndpoint: Array<{ endpoint: string; calls: number; tokens: number; costUsd: number }>;
  byProvider: Array<{ provider: string; calls: number; tokens: number; costUsd: number }>;
  monthEstimateUsd: number;
};

type Recent = {
  id: number;
  provider: string;
  model: string;
  endpoint: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: string;
  status: string;
  httpStatus: number | null;
  durationMs: number | null;
  calledAt: string;
};

const WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

const fmtUsd = (n: number) => `$${(n ?? 0).toFixed(n < 1 ? 4 : 2)}`;
const fmtNum = (n: number) => (n ?? 0).toLocaleString();

export default function Usage() {
  const [windowHours, setWindowHours] = useState(24);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetch(`/api/usage/summary?windowHours=${windowHours}`).then((x) => x.json()),
        fetch(`/api/usage/recent?limit=100`).then((x) => x.json()),
      ]);
      setSummary(s);
      setRecent(r.rows ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [windowHours]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, windowHours]);

  const t = summary?.totals;
  const errPct = t && t.calls > 0 ? ((t.errors + t.quota) / t.calls) * 100 : 0;
  const avgCostPerCall = t && t.calls > 0 ? t.costUsd / t.calls : 0;
  const avgTokensPerCall = t && t.calls > 0 ? Math.round(t.totalTokens / t.calls) : 0;

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <MobileNotice />
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Live</span>
            </div>
            <h1 className="font-serif text-4xl tracking-tight">LLM Usage &amp; Spend</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
              Every call to Perplexity, OpenRouter, and other model providers is logged with
              tokens, latency, and cost. Pricing per million tokens is applied per model;
              the projection below extrapolates current burn to a 30-day month.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {WINDOWS.map((w) => (
              <Button
                key={w.label}
                variant={windowHours === w.hours ? "default" : "outline"}
                size="sm"
                onClick={() => setWindowHours(w.hours)}
                data-testid={`window-${w.label}`}
              >
                {w.label}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="refresh-usage">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> auto
            </label>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card data-testid="kpi-cost">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Spend (window)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-serif">{fmtUsd(t?.costUsd ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">last {summary?.windowHours ?? 0}h</div>
            </CardContent>
          </Card>
          <Card data-testid="kpi-month">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> 30-day projection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-serif">{fmtUsd(summary?.monthEstimateUsd ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">at current burn rate</div>
            </CardContent>
          </Card>
          <Card data-testid="kpi-calls">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <Activity className="w-3 h-3" /> Calls
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-serif">{fmtNum(t?.calls ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">avg {fmtUsd(avgCostPerCall)}/call</div>
            </CardContent>
          </Card>
          <Card data-testid="kpi-tokens">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <Cpu className="w-3 h-3" /> Tokens
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-serif">{fmtNum(t?.totalTokens ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">avg {fmtNum(avgTokensPerCall)}/call</div>
            </CardContent>
          </Card>
          <Card data-testid="kpi-errors">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Errors / Quota
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-serif">{fmtNum((t?.errors ?? 0) + (t?.quota ?? 0))}</div>
              <div className="text-xs text-muted-foreground mt-1">{errPct.toFixed(1)}% fail rate{t && t.quota > 0 ? ` · ${t.quota} quota` : ""}</div>
            </CardContent>
          </Card>
        </div>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card data-testid="card-by-endpoint">
            <CardHeader>
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <Zap className="w-4 h-4" /> By Endpoint
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr><th className="text-left py-1">Endpoint</th><th className="text-right">Calls</th><th className="text-right">Cost</th></tr>
                </thead>
                <tbody>
                  {(summary?.byEndpoint ?? []).map((r) => (
                    <tr key={r.endpoint} className="border-b last:border-0">
                      <td className="py-1.5 font-mono text-xs">{r.endpoint}</td>
                      <td className="text-right">{fmtNum(r.calls)}</td>
                      <td className="text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
                    </tr>
                  ))}
                  {(summary?.byEndpoint ?? []).length === 0 && (
                    <tr><td colSpan={3} className="py-3 text-center text-muted-foreground">No calls in window</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card data-testid="card-by-model">
            <CardHeader>
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <Cpu className="w-4 h-4" /> By Model
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr><th className="text-left py-1">Model</th><th className="text-right">Calls</th><th className="text-right">Cost</th></tr>
                </thead>
                <tbody>
                  {(summary?.byModel ?? []).map((r) => (
                    <tr key={r.model} className="border-b last:border-0">
                      <td className="py-1.5 font-mono text-xs">{r.model}</td>
                      <td className="text-right">{fmtNum(r.calls)}</td>
                      <td className="text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
                    </tr>
                  ))}
                  {(summary?.byModel ?? []).length === 0 && (
                    <tr><td colSpan={3} className="py-3 text-center text-muted-foreground">No calls in window</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card data-testid="card-by-provider">
            <CardHeader>
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <Activity className="w-4 h-4" /> By Provider
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr><th className="text-left py-1">Provider</th><th className="text-right">Calls</th><th className="text-right">Cost</th></tr>
                </thead>
                <tbody>
                  {(summary?.byProvider ?? []).map((r) => (
                    <tr key={r.provider} className="border-b last:border-0">
                      <td className="py-1.5 capitalize">{r.provider}</td>
                      <td className="text-right">{fmtNum(r.calls)}</td>
                      <td className="text-right tabular-nums">{fmtUsd(r.costUsd)}</td>
                    </tr>
                  ))}
                  {(summary?.byProvider ?? []).length === 0 && (
                    <tr><td colSpan={3} className="py-3 text-center text-muted-foreground">No calls in window</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        {/* Recent calls */}
        <Card data-testid="card-recent">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Recent Calls (latest 100)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-1">Time</th>
                    <th className="text-left">Endpoint</th>
                    <th className="text-left">Model</th>
                    <th className="text-right">In</th>
                    <th className="text-right">Out</th>
                    <th className="text-right">ms</th>
                    <th className="text-right">Cost</th>
                    <th className="text-left pl-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-1 text-muted-foreground tabular-nums">{new Date(r.calledAt).toLocaleTimeString()}</td>
                      <td className="font-mono">{r.endpoint}</td>
                      <td className="font-mono">{r.model}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.inputTokens)}</td>
                      <td className="text-right tabular-nums">{fmtNum(r.outputTokens)}</td>
                      <td className="text-right tabular-nums">{r.durationMs ?? "—"}</td>
                      <td className="text-right tabular-nums">{fmtUsd(parseFloat(r.costUsd))}</td>
                      <td className="pl-2">
                        <Badge variant={r.status === "ok" ? "secondary" : r.status === "quota" ? "destructive" : "outline"} className="text-[10px]">
                          {r.status}{r.httpStatus ? ` ${r.httpStatus}` : ""}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No calls logged yet — they'll appear here as the platform makes LLM requests.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Pricing is computed per model from a built-in rate card (Perplexity sonar = $1/M in &amp; out, sonar-pro = $3/$15;
          Claude Haiku 4.5 = $1/$5; GLM-5.1 = $0.50/$1.50). Logging is fire-and-forget — it never blocks the calling code path.
        </p>
    </div>
  );
}
