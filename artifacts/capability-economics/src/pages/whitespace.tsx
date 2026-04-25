import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ScanLine, Loader2, TrendingUp, Shield, Cpu } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type WhitespaceRow = {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string | null;
  consensusScore: number;
  velocity: number;
  confidence: number;
  moatScore: number;
  aiDisruptability: number;
  revenueExposureMm: number | null;
  opportunityScore: number;
};

function scoreClass(n: number, kind: "score" | "vel" | "moat" | "ai"): string {
  if (kind === "vel") return n > 0.3 ? "text-emerald-600" : n > 0 ? "text-amber-600" : "text-muted-foreground";
  if (kind === "moat") return n < 30 ? "text-emerald-600" : n < 60 ? "text-amber-600" : "text-rose-600";
  if (kind === "ai") return n > 60 ? "text-emerald-600" : n > 30 ? "text-amber-600" : "text-muted-foreground";
  return n < 40 ? "text-emerald-600" : n < 70 ? "text-amber-600" : "text-muted-foreground";
}

export default function Whitespace() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<string>("");
  const [velocityMin, setVelocityMin] = useState(0.3);
  const [moatMax, setMoatMax] = useState(60);
  const [disruptabilityMin, setDisruptabilityMin] = useState(40);
  const [rows, setRows] = useState<WhitespaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/industries`)
      .then((r) => r.json())
      .then((d) => {
        const list: Industry[] = d.industries ?? d ?? [];
        setIndustries(list);
        if (list.length && !industryId) setIndustryId(String(list[0].id));
      });
  }, []);

  const scan = async () => {
    setLoading(true);
    setHasRun(true);
    const params = new URLSearchParams();
    if (industryId) params.set("industryId", industryId);
    params.set("velocityMin", String(velocityMin));
    params.set("moatMax", String(moatMax));
    params.set("disruptabilityMin", String(disruptabilityMin));
    try {
      const res = await fetch(`${API_BASE}/whitespace?${params.toString()}`);
      const data = await res.json();
      setRows(data.results ?? []);
    } catch {
      setRows([]);
    }
    setLoading(false);
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Discover · White-Space Scanner</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <ScanLine className="w-8 h-8 text-primary" />
          White-Space Scanner
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Filter the capability universe to find the white space — high velocity, weak existing moats, and ripe for
          AI-native disruption. Lower scores on the right are <em>better</em> opportunities.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardContent className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Industry</p>
              <Select value={industryId} onValueChange={setIndustryId}>
                <SelectTrigger><SelectValue placeholder="All industries" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All industries</SelectItem>
                  {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={scan} disabled={loading} className="w-full md:w-auto">
                {loading ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Scanning…</> : <>Scan white space</>}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" />Min velocity</span>
                <span className="text-sm font-mono">{velocityMin.toFixed(2)}</span>
              </div>
              <Slider value={[velocityMin]} min={0} max={1} step={0.05} onValueChange={(v) => setVelocityMin(v[0] ?? 0)} />
              <p className="text-xs text-muted-foreground mt-1">Higher = only fast-accelerating capabilities</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" />Max moat</span>
                <span className="text-sm font-mono">{moatMax}</span>
              </div>
              <Slider value={[moatMax]} min={0} max={100} step={5} onValueChange={(v) => setMoatMax(v[0] ?? 100)} />
              <p className="text-xs text-muted-foreground mt-1">Lower = weaker incumbent defenses</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" />Min disruptability</span>
                <span className="text-sm font-mono">{disruptabilityMin}</span>
              </div>
              <Slider value={[disruptabilityMin]} min={0} max={100} step={5} onValueChange={(v) => setDisruptabilityMin(v[0] ?? 0)} />
              <p className="text-xs text-muted-foreground mt-1">Higher = more AI-rebuildable from scratch</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!hasRun ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ScanLine className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">Tune the sliders, then scan.</p>
            <p className="text-sm">Capabilities are ranked by an opportunity score combining velocity, low saturation, low moat, and AI disruptability.</p>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin opacity-50" />
            <p className="text-sm">Scanning…</p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <p className="font-serif text-lg mb-1">No matches.</p>
            <p className="text-sm">Loosen the filters and try again.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">#</th>
                  <th className="text-left px-3 py-3 font-medium">Capability</th>
                  <th className="text-left px-3 py-3 font-medium">Industry</th>
                  <th className="text-right px-3 py-3 font-medium">Opportunity</th>
                  <th className="text-right px-3 py-3 font-medium">Velocity</th>
                  <th className="text-right px-3 py-3 font-medium">Saturation</th>
                  <th className="text-right px-3 py-3 font-medium">Moat</th>
                  <th className="text-right px-3 py-3 font-medium">AI Risk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.capabilityId} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{i + 1}</td>
                    <td className="px-3 py-3 font-medium">{r.capabilityName}</td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {r.industryName && <Badge variant="outline" className="text-xs">{r.industryName}</Badge>}
                    </td>
                    <td className="text-right px-3 font-mono font-semibold text-primary">{r.opportunityScore.toFixed(1)}</td>
                    <td className={`text-right px-3 font-mono ${scoreClass(r.velocity, "vel")}`}>
                      {r.velocity > 0 ? "+" : ""}{r.velocity.toFixed(2)}
                    </td>
                    <td className={`text-right px-3 font-mono ${scoreClass(r.consensusScore, "score")}`}>{r.consensusScore.toFixed(0)}</td>
                    <td className={`text-right px-3 font-mono ${scoreClass(r.moatScore, "moat")}`}>{r.moatScore.toFixed(0)}</td>
                    <td className={`text-right px-3 font-mono ${scoreClass(r.aiDisruptability, "ai")}`}>{r.aiDisruptability.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
