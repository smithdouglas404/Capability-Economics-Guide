import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GitMerge, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const apiBase = import.meta.env.VITE_API_URL || "";

type Industry = { id: number; name: string };
type TwinResp = {
  industryA: Industry;
  industryB: Industry;
  summary: { sharedCount: number; onlyACount: number; onlyBCount: number; jaccard: number; totalSynergyMm: number; clashCount: number };
  synergies: Array<{ capabilityName: string; a: any; b: any; clash: boolean; clashType: string | null; synergyMm: number }>;
  onlyA: Array<{ id: number; name: string; quadrant: string | null }>;
  onlyB: Array<{ id: number; name: string; quadrant: string | null }>;
};

function fmtMoney(mm: number | null | undefined): string {
  if (mm == null) return "—";
  if (Math.abs(mm) >= 1000) return `$${(mm / 1000).toFixed(1)}B`;
  return `$${mm.toFixed(0)}M`;
}

function QuadrantChip({ q }: { q: string | null | undefined }) {
  if (!q) return <span className="text-xs text-zinc-500">—</span>;
  const color = q === "hot" ? "bg-red-500/15 text-red-600 border-red-500/30"
    : q === "emerging" ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
    : q === "cooling" ? "bg-blue-500/15 text-blue-600 border-blue-500/30"
    : "bg-zinc-500/15 text-zinc-600 border-zinc-500/30";
  return <Badge className={`${color} border capitalize text-xs font-medium`} variant="outline">{q.replace("_", " ")}</Badge>;
}

export default function MaTwins() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");
  const [data, setData] = useState<TwinResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/industries`).then(r => r.json()).then((d: Industry[]) => {
      setIndustries(d);
      if (d.length >= 2) { setAId(String(d[0].id)); setBId(String(d[1].id)); }
    });
  }, []);

  async function run() {
    if (!aId || !bId || aId === bId) { setErr("Pick two different industries"); return; }
    setLoading(true); setErr(null); setData(null);
    try {
      const r = await fetch(`${apiBase}/api/alpha/twin?industryAId=${aId}&industryBId=${bId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "twin failed");
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Flow · Acquisition Twins</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <GitMerge className="w-8 h-8 text-primary" />
          M&amp;A Twins
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Capability-similar acquisition candidates across industries.
        </p>
      </motion.div>

      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs text-zinc-500 mb-1">Acquirer (A)</div>
              <Select value={aId} onValueChange={setAId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs text-zinc-500 mb-1">Target (B)</div>
              <Select value={bId} onValueChange={setBId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={run} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <GitMerge className="h-4 w-4 mr-2" />}Compute Twin</Button>
          </CardContent>
        </Card>
        {err && <div className="text-sm text-red-600">{err}</div>}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Card><CardContent className="p-4"><div className="text-xs text-zinc-500 uppercase">Shared</div><div className="text-xl font-bold mt-1 text-emerald-600">{data.summary.sharedCount}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs text-zinc-500 uppercase">Only in A</div><div className="text-xl font-bold mt-1">{data.summary.onlyACount}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs text-zinc-500 uppercase">Only in B</div><div className="text-xl font-bold mt-1">{data.summary.onlyBCount}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-xs text-zinc-500 uppercase">Synergy</div><div className="text-xl font-bold mt-1 text-emerald-600">{fmtMoney(data.summary.totalSynergyMm)}</div></CardContent></Card>
              <Card className={data.summary.clashCount > 0 ? "border-red-500/40" : ""}><CardContent className="p-4"><div className="text-xs text-zinc-500 uppercase">Clash zones</div><div className="text-xl font-bold mt-1 text-red-600">{data.summary.clashCount}</div></CardContent></Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">Synergy / clash zones (overlap = {(data.summary.jaccard * 100).toFixed(1)}%)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b text-xs uppercase text-zinc-500">
                      <tr><th className="text-left py-2 px-3">Capability</th><th className="py-2 px-2">A quadrant</th><th className="py-2 px-2">B quadrant</th><th className="text-right py-2 px-2">Synergy</th><th className="py-2 px-2">Status</th></tr>
                    </thead>
                    <tbody>
                      {data.synergies.map(s => (
                        <tr key={s.capabilityName} className={`border-b ${s.clash ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                          <td className="py-2 px-3 font-medium">{s.capabilityName}</td>
                          <td className="py-2 px-2"><QuadrantChip q={s.a.quadrant} /></td>
                          <td className="py-2 px-2"><QuadrantChip q={s.b.quadrant} /></td>
                          <td className="py-2 px-2 text-right tabular-nums text-emerald-600">{fmtMoney(s.synergyMm)}</td>
                          <td className="py-2 px-2">{s.clash ? <Badge variant="outline" className="text-red-600 border-red-500/50 text-xs">CLASH: {s.clashType}</Badge> : <Badge variant="outline" className="text-emerald-600 border-emerald-500/50 text-xs">synergy</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card><CardHeader><CardTitle className="text-base">Acquirer-only ({data.industryA.name})</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{data.onlyA.map(c => <Badge key={c.id} variant="secondary" className="text-xs">{c.name}</Badge>)}</div></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Target-only ({data.industryB.name})</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{data.onlyB.map(c => <Badge key={c.id} variant="secondary" className="text-xs">{c.name}</Badge>)}</div></CardContent></Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
