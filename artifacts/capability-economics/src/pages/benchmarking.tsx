import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, TrendingUp, TrendingDown, BarChart3, Upload, RefreshCw } from "lucide-react";

const API_BASE = "/api";

type PeerResult = {
  capabilityId: number;
  capabilityName: string;
  myScore: number | null;
  peerAvg: number;
  peerMedian: number;
  peerP25: number;
  peerP75: number;
  peerCount: number;
  gap: number | null;
};

export default function Benchmarking() {
  const [results, setResults] = useState<PeerResult[]>([]);
  const [peerCount, setPeerCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [optingIn, setOptingIn] = useState(false);
  const [sortBy, setSortBy] = useState<"gap" | "name" | "myScore">("gap");
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/benchmarking/peers?sessionToken=${sessionToken}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setPeerCount(data.peerCount ?? 0);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const optIn = async () => {
    setOptingIn(true);
    try {
      await fetch(`${API_BASE}/benchmarking/opt-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      });
      await load();
    } catch (err) { console.error(err); }
    setOptingIn(false);
  };

  const sorted = [...results].sort((a, b) => {
    if (sortBy === "gap") return (a.gap ?? 0) - (b.gap ?? 0);
    if (sortBy === "myScore") return (b.myScore ?? 0) - (a.myScore ?? 0);
    return a.capabilityName.localeCompare(b.capabilityName);
  });

  const withScores = results.filter((r) => r.myScore !== null);
  const aboveMedian = withScores.filter((r) => (r.gap ?? 0) > 0).length;
  const belowMedian = withScores.filter((r) => (r.gap ?? 0) < 0).length;
  const avgGap = withScores.length ? withScores.reduce((s, r) => s + (r.gap ?? 0), 0) / withScores.length : 0;

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Badge className="mb-2">Network</Badge>
          <h1 className="text-3xl font-serif font-bold">Peer Benchmarking</h1>
          <p className="text-muted-foreground mt-1">Anonymized cross-organization capability benchmarks. See where you stand against {peerCount} peers.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={optIn} disabled={optingIn} variant="default">
            <Upload className="w-4 h-4 mr-2" /> {optingIn ? "Contributing..." : "Contribute My Data"}
          </Button>
          <Button onClick={load} disabled={loading} variant="outline"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Users className="w-6 h-6 mx-auto mb-2 text-primary" />
            <p className="text-2xl font-bold">{peerCount}</p>
            <p className="text-xs text-muted-foreground">Peer Organizations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <TrendingUp className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
            <p className="text-2xl font-bold">{aboveMedian}</p>
            <p className="text-xs text-muted-foreground">Above Median</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <TrendingDown className="w-6 h-6 mx-auto mb-2 text-destructive" />
            <p className="text-2xl font-bold">{belowMedian}</p>
            <p className="text-xs text-muted-foreground">Below Median</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <BarChart3 className="w-6 h-6 mx-auto mb-2 text-amber-500" />
            <p className="text-2xl font-bold">{avgGap >= 0 ? "+" : ""}{avgGap.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Avg Gap to Median</p>
          </CardContent>
        </Card>
      </div>

      {/* Sort Controls */}
      <div className="flex gap-2">
        <span className="text-sm text-muted-foreground self-center">Sort by:</span>
        {(["gap", "myScore", "name"] as const).map((s) => (
          <Button key={s} size="sm" variant={sortBy === s ? "default" : "outline"} onClick={() => setSortBy(s)}>
            {s === "gap" ? "Gap" : s === "myScore" ? "My Score" : "Name"}
          </Button>
        ))}
      </div>

      {/* Peer Comparison Table */}
      <Card>
        <CardHeader><CardTitle>Capability Peer Comparison</CardTitle></CardHeader>
        <CardContent>
          {sorted.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Capability</th>
                    <th className="text-right py-2 px-2">Your Score</th>
                    <th className="text-right py-2 px-2">Peer Median</th>
                    <th className="text-right py-2 px-2">P25</th>
                    <th className="text-right py-2 px-2">P75</th>
                    <th className="text-right py-2 px-2">Gap</th>
                    <th className="text-right py-2 px-2">Peers</th>
                    <th className="py-2 px-2">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const barWidth = 100;
                    const myPct = r.myScore !== null ? (r.myScore / 100) * barWidth : null;
                    const medPct = (r.peerMedian / 100) * barWidth;
                    return (
                      <tr key={r.capabilityId} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2 font-medium">{r.capabilityName}</td>
                        <td className="text-right py-2 px-2">{r.myScore?.toFixed(0) ?? "—"}</td>
                        <td className="text-right py-2 px-2">{r.peerMedian.toFixed(0)}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{r.peerP25.toFixed(0)}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{r.peerP75.toFixed(0)}</td>
                        <td className="text-right py-2 px-2">
                          {r.gap !== null ? (
                            <span className={r.gap >= 0 ? "text-emerald-500 font-medium" : "text-destructive font-medium"}>
                              {r.gap >= 0 ? "+" : ""}{r.gap.toFixed(0)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{r.peerCount}</td>
                        <td className="py-2 px-2">
                          <div className="relative h-4 w-full bg-muted rounded overflow-hidden min-w-[100px]">
                            {/* IQR band */}
                            <div className="absolute h-full bg-primary/20 rounded" style={{ left: `${r.peerP25}%`, width: `${r.peerP75 - r.peerP25}%` }} />
                            {/* Median line */}
                            <div className="absolute h-full w-0.5 bg-primary/60" style={{ left: `${r.peerMedian}%` }} />
                            {/* My score dot */}
                            {myPct !== null && (
                              <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary border-2 border-white" style={{ left: `${r.myScore}%` }} />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              {peerCount === 0
                ? "No peer data yet. Click \"Contribute My Data\" to start the benchmark network."
                : "Set up your organization and assess capabilities to see your position."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
