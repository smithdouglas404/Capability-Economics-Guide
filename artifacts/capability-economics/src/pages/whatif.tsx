import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Beaker,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Globe,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API_BASE = "/api";

interface Industry { id: number; name: string; slug: string; }
interface Capability { id: number; name: string; industryId: number; }

type Sentiment = "positive" | "negative" | "neutral";

interface WhatIfResult {
  input: {
    eventType: string;
    severity: number;
    sentimentDirection: Sentiment;
    decayDays: number;
    affectedIndustryIds: number[];
    affectedCapabilityIds: number[];
  };
  expandedAffectedCapabilityIds: number[];
  totalCapabilitiesAffected: number;
  capabilities: Array<{
    capabilityId: number;
    capabilityName: string;
    industryId: number;
    industryName: string;
    currentScore: number | null;
    projectedScore: number | null;
    delta: number | null;
    shockPoints: number;
    via: string;
  }>;
  industries: Array<{
    industryId: number;
    industryName: string;
    capabilityCount: number;
    currentMean: number | null;
    projectedMean: number | null;
    delta: number | null;
    gdpShare: number | null;
  }>;
  aggregate: {
    gdpWeightedDelta: number | null;
    biggestPositiveMove: { name: string; delta: number } | null;
    biggestNegativeMove: { name: string; delta: number } | null;
  };
  narrative: string;
}

// Preset shape — populated from /api/whatif/presets at mount time. The
// hardcoded scenarios that used to live here ("Taiwan semiconductor
// restriction", etc.) are gone — those weren't real signals. The presets
// now come from real entries in the macro_events table populated by the
// world-scanner. See docs/Must Fix/PLAN.md item #10.
type WhatIfPreset = { label: string; eventType: string; severity: number; direction: Sentiment; decayDays: number };

function DirIcon({ d }: { d: number | null }) {
  if (d === null || d === 0) return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
  if (d > 0) return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  return <TrendingDown className="w-3.5 h-3.5 text-rose-500" />;
}

export default function WhatIfPage() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);

  const [eventType, setEventType] = useState("regulation");
  const [severity, setSeverity] = useState(6);
  const [direction, setDirection] = useState<Sentiment>("negative");
  const [decayDays, setDecayDays] = useState(90);
  const [selectedIndustries, setSelectedIndustries] = useState<number[]>([]);
  const [capPicker, setCapPicker] = useState("");
  const [selectedCaps, setSelectedCaps] = useState<number[]>([]);

  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [presets, setPresets] = useState<WhatIfPreset[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then((d: Industry[]) => setIndustries(d ?? [])).catch(() => {});
    fetch(`${API_BASE}/capabilities`).then(r => r.json()).then((d: Capability[]) => setCapabilities(d ?? [])).catch(() => {});
    fetch(`${API_BASE}/whatif/presets`)
      .then(r => r.json())
      .then((d: { presets?: WhatIfPreset[] }) => setPresets(Array.isArray(d?.presets) ? d.presets : []))
      .catch(() => setPresets([]));
  }, []);

  function toggleIndustry(id: number) {
    setSelectedIndustries(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function addCap(id: number) {
    if (!selectedCaps.includes(id)) setSelectedCaps([...selectedCaps, id]);
    setCapPicker("");
  }
  function removeCap(id: number) {
    setSelectedCaps(selectedCaps.filter(x => x !== id));
  }

  function applyPreset(p: WhatIfPreset) {
    setEventType(p.eventType);
    setSeverity(p.severity);
    setDirection(p.direction);
    setDecayDays(p.decayDays);
  }

  async function runSim() {
    if (selectedIndustries.length === 0 && selectedCaps.length === 0) {
      setErr("Pick at least one industry or capability to scope the event.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/whatif/macro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          severity,
          sentimentDirection: direction,
          decayDays,
          affectedIndustryIds: selectedIndustries,
          affectedCapabilityIds: selectedCaps,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setResult(await r.json() as WhatIfResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  }

  const capPickerFiltered = capPicker.trim().length === 0
    ? []
    : capabilities.filter(c => c.name.toLowerCase().includes(capPicker.trim().toLowerCase()) && !selectedCaps.includes(c.id)).slice(0, 8);

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <Link href="/simulation" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to simulation
        </Link>
        <div className="flex items-center gap-2">
          <Beaker className="w-5 h-5 text-muted-foreground" />
          <h1 className="font-serif text-3xl tracking-tight">What-if macro simulator</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Define a hypothetical macro event and project how the CVI would respond if it fired right now.
          Read-only — does not insert into macro_events.
        </p>
      </div>

      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-4">
          {presets.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Active macro events</div>
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <Button key={p.label} size="sm" variant="outline" onClick={() => applyPreset(p)} className="rounded-none text-xs h-7">
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="wi-type">Event type</Label>
              <select id="wi-type" value={eventType} onChange={e => setEventType(e.target.value)} className="w-full h-9 px-2 text-sm border border-input bg-background rounded-none">
                <option value="regulation">regulation</option>
                <option value="tech_shift">tech_shift</option>
                <option value="war">war</option>
                <option value="economic">economic</option>
                <option value="disaster">disaster</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <Label htmlFor="wi-sev">Severity (0–10)</Label>
              <Input id="wi-sev" type="number" min={0} max={10} step={0.5} value={severity} onChange={e => setSeverity(Number(e.target.value))} className="rounded-none font-mono" />
            </div>
            <div>
              <Label htmlFor="wi-dir">Direction</Label>
              <select id="wi-dir" value={direction} onChange={e => setDirection(e.target.value as Sentiment)} className="w-full h-9 px-2 text-sm border border-input bg-background rounded-none">
                <option value="negative">negative</option>
                <option value="positive">positive</option>
                <option value="neutral">neutral</option>
              </select>
            </div>
            <div>
              <Label htmlFor="wi-decay">Decay (days)</Label>
              <Input id="wi-decay" type="number" min={1} max={365} value={decayDays} onChange={e => setDecayDays(Number(e.target.value))} className="rounded-none font-mono" />
            </div>
          </div>

          <div>
            <Label className="mb-1 inline-flex items-center gap-2"><Globe className="w-3.5 h-3.5" /> Affected industries</Label>
            <div className="flex flex-wrap gap-2">
              {industries.map(ind => (
                <Badge
                  key={ind.id}
                  variant="outline"
                  onClick={() => toggleIndustry(ind.id)}
                  className={`rounded-none cursor-pointer text-[11px] uppercase tracking-wider ${selectedIndustries.includes(ind.id) ? "bg-primary text-primary-foreground border-primary" : ""}`}
                >
                  {ind.name}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1 inline-flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> Affected capabilities (optional, expands across parent/child)</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedCaps.map(id => {
                const c = capabilities.find(x => x.id === id);
                return (
                  <Badge key={id} variant="outline" className="rounded-none text-[11px] inline-flex items-center gap-1">
                    {c?.name ?? `#${id}`}
                    <button onClick={() => removeCap(id)} className="hover:text-rose-500">×</button>
                  </Badge>
                );
              })}
            </div>
            <div className="relative">
              <Input value={capPicker} onChange={e => setCapPicker(e.target.value)} placeholder="Search capability to add…" className="rounded-none" />
              {capPickerFiltered.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-background border border-border/60 shadow-md">
                  {capPickerFiltered.map(c => (
                    <button key={c.id} onClick={() => addCap(c.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50">
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {selectedIndustries.length} industries + {selectedCaps.length} caps selected
            </span>
            <Button onClick={runSim} disabled={busy} className="rounded-none">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Beaker className="w-4 h-4 mr-2" />}
              Run simulation
            </Button>
          </div>

          {err && (
            <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 text-sm font-mono">{err}</div>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-5 space-y-3">
              <h2 className="font-serif text-xl tracking-tight">Projection</h2>
              <p className="text-sm leading-relaxed">{result.narrative}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">GDP-weighted Δ</div>
                  <div className="font-mono text-2xl tabular-nums">
                    {result.aggregate.gdpWeightedDelta === null ? "—" : `${result.aggregate.gdpWeightedDelta > 0 ? "+" : ""}${result.aggregate.gdpWeightedDelta.toFixed(2)}`}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Caps affected</div>
                  <div className="font-mono text-2xl tabular-nums">{result.totalCapabilitiesAffected}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Biggest +</div>
                  <div className="font-mono text-sm tabular-nums">
                    {result.aggregate.biggestPositiveMove ? `${result.aggregate.biggestPositiveMove.name} (+${result.aggregate.biggestPositiveMove.delta.toFixed(1)})` : "—"}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Biggest −</div>
                  <div className="font-mono text-sm tabular-nums">
                    {result.aggregate.biggestNegativeMove ? `${result.aggregate.biggestNegativeMove.name} (${result.aggregate.biggestNegativeMove.delta.toFixed(1)})` : "—"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {result.industries.length > 0 && (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <th className="px-4 py-3">Industry</th>
                        <th className="px-4 py-3 text-right">Caps</th>
                        <th className="px-4 py-3 text-right">Current mean</th>
                        <th className="px-4 py-3 text-right">Projected mean</th>
                        <th className="px-4 py-3 text-right">Δ</th>
                        <th className="px-4 py-3 text-right">GDP share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.industries.map(r => (
                        <tr key={r.industryId} className="border-t border-border/40">
                          <td className="px-4 py-2 font-medium">{r.industryName}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.capabilityCount}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.currentMean?.toFixed(1) ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.projectedMean?.toFixed(1) ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums inline-flex items-center gap-1 justify-end">
                            <DirIcon d={r.delta} />
                            {r.delta === null ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(2)}`}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.gdpShare === null ? "—" : `${(r.gdpShare * 100).toFixed(1)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.capabilities.length > 0 && (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <th className="px-4 py-3">Capability</th>
                        <th className="px-4 py-3">Industry</th>
                        <th className="px-4 py-3">Via</th>
                        <th className="px-4 py-3 text-right">Current</th>
                        <th className="px-4 py-3 text-right">Projected</th>
                        <th className="px-4 py-3 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.capabilities.slice(0, 50).map(r => (
                        <tr key={r.capabilityId} className="border-t border-border/40">
                          <td className="px-4 py-2">
                            <Link href={`/capability/${r.capabilityId}`} className="hover:underline">{r.capabilityName}</Link>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{r.industryName}</td>
                          <td className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{r.via}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.currentScore === null ? "—" : r.currentScore.toFixed(1)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.projectedScore === null ? "—" : r.projectedScore.toFixed(1)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums inline-flex items-center gap-1 justify-end">
                            <DirIcon d={r.delta} />
                            {r.delta === null ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(2)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.capabilities.length > 50 && (
                  <div className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-t border-border/40">
                    Showing top 50 of {result.capabilities.length}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
