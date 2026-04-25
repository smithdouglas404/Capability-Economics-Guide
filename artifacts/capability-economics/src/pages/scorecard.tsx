import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Swords, AlertTriangle, Shield, Brain, TrendingDown, RefreshCw } from "lucide-react";

const API_BASE = "/api";

type MatrixRow = {
  capabilityId: number;
  capabilityName: string;
  myScore: number | null;
  benchmark: number;
  gap: number | null;
  moatScore: number | null;
  evar12mo: number | null;
  aiExposure: number | null;
  velocity: number;
  consensusScore: number;
};

type Alert = { type: string; message: string; severity: string; capabilityId: number };

export default function CapabilityScorecard() {
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/war-room/compare?sessionToken=${sessionToken}`);
      const data = await res.json();
      setMatrix(data.matrix ?? []);
      setAlerts(data.alerts ?? []);
      setOrgName(data.orgName ?? "");
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const sortedByGap = [...matrix].filter((m) => m.gap !== null).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Badge className="mb-2">Live</Badge>
          <h1 className="text-3xl font-serif font-bold">Capability Scorecard</h1>
          <p className="text-muted-foreground mt-1">{orgName || "Your organization"} vs. industry benchmarks — gap analysis with moat scores, EVaR, and AI exposure per capability.</p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline"><RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
      </div>

      {/* Alert Banner */}
      {(criticalAlerts.length > 0 || warningAlerts.length > 0) && (
        <div className="space-y-2">
          {criticalAlerts.map((a, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <span className="text-sm">{a.message}</span>
              <Badge variant="destructive" className="ml-auto">Critical</Badge>
            </div>
          ))}
          {warningAlerts.map((a, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <span className="text-sm">{a.message}</span>
              <Badge variant="outline" className="ml-auto text-amber-500">Warning</Badge>
            </div>
          ))}
        </div>
      )}

      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Swords className="w-6 h-6 mx-auto mb-2 text-primary" />
            <p className="text-2xl font-bold">{matrix.length}</p>
            <p className="text-xs text-muted-foreground">Capabilities Tracked</p>
            <p className="text-[10px] text-muted-foreground mt-1">{sortedByGap.length} scored · {matrix.length - sortedByGap.length} unscored</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-destructive" />
            <p className="text-2xl font-bold">{criticalAlerts.length}</p>
            <p className="text-xs text-muted-foreground">Critical Alerts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Shield className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
            <p className="text-2xl font-bold">{matrix.filter((m) => (m.gap ?? 0) > 0).length}</p>
            <p className="text-xs text-muted-foreground">Above Benchmark</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <TrendingDown className="w-6 h-6 mx-auto mb-2 text-amber-500" />
            <p className="text-2xl font-bold">{matrix.filter((m) => (m.gap ?? 0) < -10).length}</p>
            <p className="text-xs text-muted-foreground">Significant Gaps</p>
          </CardContent>
        </Card>
      </div>

      {/* Comparison Matrix */}
      <Card>
        <CardHeader><CardTitle>Capability Comparison Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Capability</th>
                  <th className="text-right py-2 px-2">Your Score</th>
                  <th className="text-right py-2 px-2">Benchmark</th>
                  <th className="text-right py-2 px-2">Gap</th>
                  <th className="text-right py-2 px-2">Moat</th>
                  <th className="text-right py-2 px-2">EVaR 12mo</th>
                  <th className="text-right py-2 px-2">AI Exposure</th>
                  <th className="text-right py-2 px-2">Velocity</th>
                </tr>
              </thead>
              <tbody>
                {sortedByGap.map((row) => (
                  <tr key={row.capabilityId} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{row.capabilityName}</td>
                    <td className="text-right py-2 px-2">{row.myScore?.toFixed(0) ?? "—"}</td>
                    <td className="text-right py-2 px-2">{row.benchmark.toFixed(0)}</td>
                    <td className="text-right py-2 px-2">
                      {row.gap !== null ? (
                        <span className={row.gap >= 0 ? "text-emerald-500" : "text-destructive"}>
                          {row.gap >= 0 ? "+" : ""}{row.gap.toFixed(0)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">
                      {row.moatScore !== null ? (
                        <Badge variant="outline" className={`text-xs ${row.moatScore >= 60 ? "text-emerald-500" : row.moatScore >= 30 ? "text-amber-500" : "text-destructive"}`}>
                          {row.moatScore.toFixed(0)}
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">{row.evar12mo !== null ? `$${row.evar12mo.toFixed(1)}M` : "—"}</td>
                    <td className="text-right py-2 px-2">
                      {row.aiExposure !== null ? (
                        <Badge variant={row.aiExposure > 50 ? "destructive" : "outline"} className="text-xs">
                          {row.aiExposure.toFixed(0)}%
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2">
                      <span className={row.velocity > 0 ? "text-emerald-500" : row.velocity < 0 ? "text-destructive" : "text-muted-foreground"}>
                        {row.velocity > 0 ? "+" : ""}{row.velocity.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!matrix.length && !loading && (
            <p className="text-center text-muted-foreground py-8">Set up your organization first to see competitive comparison.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
