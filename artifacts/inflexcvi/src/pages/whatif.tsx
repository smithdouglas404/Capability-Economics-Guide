import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Beaker, Loader2, TrendingUp, TrendingDown, Layers, GitBranch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const API_BASE = "/api";

interface Capability { id: number; name: string; industryId: number; benchmarkScore?: number }

interface DependentImpact {
  capabilityId: number;
  capabilityName: string;
  via: string;
  hops: number;
  strengthMultiplier: number;
  currentScore: number;
  projectedScore: number;
  scoreDelta: number;
  evarBeforeMm: number | null;
  evarAfterMm: number | null;
  evarDeltaMm: number | null;
}

interface ImprovementResult {
  capabilityId: number;
  capabilityName: string;
  currentScore: number;
  targetScore: number;
  scoreDelta: number;
  dependents: DependentImpact[];
  orgCviDelta: number;
  totalEvarReductionMm: number;
  narrative: string;
}

export default function WhatIfPage() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [picker, setPicker] = useState("");
  const [capabilityId, setCapabilityId] = useState<number | null>(null);
  const [targetScore, setTargetScore] = useState(80);
  const [result, setResult] = useState<ImprovementResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/capabilities`).then(r => r.json()).then((d: Capability[]) => setCapabilities(d ?? [])).catch(() => {});
  }, []);

  const selectedCap = capabilities.find(c => c.id === capabilityId) ?? null;
  const filtered = picker.trim().length === 0
    ? []
    : capabilities
        .filter(c => c.name.toLowerCase().includes(picker.trim().toLowerCase()))
        .slice(0, 8);

  async function compute() {
    if (!capabilityId) { setErr("Pick a capability first."); return; }
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await fetch(`${API_BASE}/whatif/capability-improvement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId, targetScore }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error ?? `HTTP ${r.status}`); }
      setResult(await r.json() as ImprovementResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Compute failed");
    } finally {
      setBusy(false);
    }
  }

  // Group dependents by hop distance for the impact tree.
  const grouped = result
    ? result.dependents.reduce((acc, d) => {
        (acc[d.hops] ??= []).push(d);
        return acc;
      }, {} as Record<number, DependentImpact[]>)
    : {};

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <Link href="/simulation" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to simulation
        </Link>
        <div className="flex items-center gap-2">
          <Beaker className="w-5 h-5 text-muted-foreground" />
          <h1 className="font-serif text-3xl tracking-tight">What if I improve this capability?</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Pick a capability and a target maturity score. The engine cascades the uplift through
          <code className="font-mono mx-1 text-xs">capability_dependencies</code>
          and reports the propagated score gain, EVaR(12m) reduction, and org-level CVI delta.
        </p>
      </div>

      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-4">
          <div>
            <Label className="inline-flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> Capability</Label>
            {selectedCap ? (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="rounded-none">
                  {selectedCap.name}
                  <button onClick={() => { setCapabilityId(null); setPicker(""); setResult(null); }} className="ml-2 hover:text-rose-500">×</button>
                </Badge>
              </div>
            ) : (
              <div className="relative mt-1">
                <Input value={picker} onChange={e => setPicker(e.target.value)} placeholder="Search capability…" className="rounded-none" />
                {filtered.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-background border border-border/60 shadow-md">
                    {filtered.map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setCapabilityId(c.id); setPicker(""); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        {c.name}
                        {c.benchmarkScore != null && (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">@ {c.benchmarkScore.toFixed(0)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Target score</Label>
              <span className="font-mono text-sm tabular-nums">{targetScore.toFixed(0)} / 100</span>
            </div>
            <Slider value={[targetScore]} min={0} max={100} step={1} onValueChange={([v]) => setTargetScore(v)} />
          </div>

          <div className="flex justify-end">
            <Button onClick={compute} disabled={busy || !capabilityId} className="rounded-none">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Beaker className="w-4 h-4 mr-2" />}
              Compute impact
            </Button>
          </div>

          {err && <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 text-sm font-mono">{err}</div>}
        </CardContent>
      </Card>

      {result && (
        <>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-5 space-y-3">
              <h2 className="font-serif text-xl tracking-tight">Projection</h2>
              <p className="text-sm leading-relaxed">{result.narrative}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Score uplift" value={`+${result.scoreDelta.toFixed(1)}`} />
                <Stat label="Dependents impacted" value={String(result.dependents.length)} />
                <Stat label="Org CVI Δ" value={`+${result.orgCviDelta.toFixed(1)}`} tone={result.orgCviDelta >= 0 ? "good" : "bad"} />
                <Stat label="EVaR reduction (12mo)" value={result.totalEvarReductionMm > 0 ? `$${result.totalEvarReductionMm.toFixed(1)}M` : "—"} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-5 space-y-3">
              <h3 className="font-serif text-lg tracking-tight inline-flex items-center gap-2">
                <GitBranch className="w-4 h-4" /> Impact propagation tree
              </h3>
              {/* Root */}
              <div className="border-l-2 border-primary pl-3 py-1">
                <div className="text-sm font-medium">{result.capabilityName}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {result.currentScore.toFixed(1)} → {result.targetScore.toFixed(1)} (root)
                </div>
              </div>
              {/* Dependents grouped by hops */}
              {Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map(hopKey => (
                <div key={hopKey} className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Hop {hopKey} — {grouped[Number(hopKey)].length} {grouped[Number(hopKey)].length === 1 ? "capability" : "capabilities"}
                  </div>
                  <div className="space-y-1">
                    {grouped[Number(hopKey)].map(d => (
                      <div
                        key={d.capabilityId}
                        className="border-l-2 border-border/60 pl-3 py-1 ml-4 flex items-center justify-between hover:bg-muted/30"
                        style={{ marginLeft: `${Number(hopKey) * 1.25}rem` }}
                      >
                        <div className="flex-1 min-w-0">
                          <Link href={`/capability/${d.capabilityId}`} className="text-sm hover:underline truncate inline-block max-w-md">
                            {d.capabilityName}
                          </Link>
                          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            via {d.via} · strength {(d.strengthMultiplier * 100).toFixed(0)}%
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <div className="font-mono text-xs tabular-nums">
                            {d.currentScore.toFixed(1)} →
                            <span className="text-emerald-500 ml-1">{d.projectedScore.toFixed(1)}</span>
                            <span className="text-muted-foreground ml-1">(+{d.scoreDelta.toFixed(2)})</span>
                          </div>
                          {d.evarDeltaMm != null && d.evarDeltaMm > 0 && (
                            <Badge variant="outline" className="rounded-none text-[10px] font-mono inline-flex items-center gap-1">
                              <TrendingDown className="w-3 h-3 text-emerald-500" />
                              -${d.evarDeltaMm.toFixed(1)}M
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {result.dependents.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No downstream dependencies in the graph — improving this capability is self-contained.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const cls = tone === "good" ? "text-emerald-500" : tone === "bad" ? "text-rose-500" : "";
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`font-mono text-2xl tabular-nums inline-flex items-center gap-1 ${cls}`}>
        {tone === "good" && <TrendingUp className="w-4 h-4" />}
        {tone === "bad" && <TrendingDown className="w-4 h-4" />}
        {value}
      </div>
    </div>
  );
}
