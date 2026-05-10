import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { FlaskConical, TrendingUp, TrendingDown, Shield, AlertTriangle, ArrowRight, Trash2, Plus, Play } from "lucide-react";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

type Capability = { id: number; name: string; benchmarkScore: number; industryId: number };
type Scenario = {
  id: number;
  name: string;
  baselineCei: number;
  projectedCei: number;
  investments: Array<{ capabilityId: number; capabilityName: string; investmentUsdMm: number; targetMaturityDelta: number; timelineMonths: number }>;
  results: {
    ceiDelta: number;
    moatChanges: Array<{ capabilityId: number; name: string; before: number; after: number }>;
    fragilitChanges: Array<{ capabilityId: number; name: string; before: number; after: number }>;
    evarReduction: Array<{ capabilityId: number; name: string; before12mo: number; after12mo: number }>;
    cascadeEffects: Array<{ fromId: number; fromName: string; toId: number; toName: string; impactDelta: number }>;
  };
  createdAt: string;
};

export default function Simulation() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [name, setName] = useState("Investment Scenario");
  const [investments, setInvestments] = useState<Array<{ capabilityId: number; investmentUsdMm: number; targetMaturityDelta: number; timelineMonths: number }>>([]);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  useEffect(() => {
    fetch(`${API_BASE}/capabilities`).then((r) => r.json()).then(setCapabilities).catch(() => {});
    if (sessionToken) {
      fetch(`${API_BASE}/simulation/scenarios?sessionToken=${sessionToken}`).then((r) => r.json()).then(setScenarios).catch(() => {});
    }
  }, []);

  const addInvestment = () => {
    if (!capabilities.length) return;
    setInvestments([...investments, { capabilityId: capabilities[0].id, investmentUsdMm: 1, targetMaturityDelta: 10, timelineMonths: 12 }]);
  };

  const removeInvestment = (idx: number) => setInvestments(investments.filter((_, i) => i !== idx));

  const updateInvestment = (idx: number, field: string, value: any) => {
    const next = [...investments];
    (next[idx] as any)[field] = value;
    setInvestments(next);
  };

  const runSimulation = async () => {
    if (!investments.length) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/simulation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, name, investments }),
      });
      const scenario = await res.json();
      setActiveScenario(scenario);
      setScenarios((prev) => [scenario, ...prev]);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const deleteScenario = async (id: number) => {
    await fetch(`${API_BASE}/simulation/scenarios/${id}`, { method: "DELETE" });
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    if (activeScenario?.id === id) setActiveScenario(null);
  };

  const r = activeScenario?.results;

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <MobileNotice />
      <div>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Innovation</span>
        </div>
        <h1 className="text-3xl font-serif tracking-tight">What-If Simulation Engine</h1>
        <p className="text-muted-foreground text-sm mt-1">Model capability investments and see projected impact on CEI, moat, fragility, and cascade effects.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Panel */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Configure Scenario</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Scenario Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Investments</span>
                <Button size="sm" variant="outline" onClick={addInvestment}><Plus className="w-4 h-4 mr-1" /> Add</Button>
              </div>

              {investments.map((inv, idx) => (
                <div key={idx} className="border rounded-none p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <select
                      className="text-sm border rounded px-2 py-1 flex-1 mr-2 bg-background"
                      value={inv.capabilityId}
                      onChange={(e) => updateInvestment(idx, "capabilityId", Number(e.target.value))}
                    >
                      {capabilities.filter((c) => (c as any).isLeaf !== false).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="ghost" onClick={() => removeInvestment(idx)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Investment: ${inv.investmentUsdMm}M</span>
                    <Slider value={[inv.investmentUsdMm]} min={0.5} max={50} step={0.5} onValueChange={([v]) => updateInvestment(idx, "investmentUsdMm", v)} />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Maturity uplift: +{inv.targetMaturityDelta} pts</span>
                    <Slider value={[inv.targetMaturityDelta]} min={1} max={40} step={1} onValueChange={([v]) => updateInvestment(idx, "targetMaturityDelta", v)} />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Timeline: {inv.timelineMonths} months</span>
                    <Slider value={[inv.timelineMonths]} min={3} max={36} step={3} onValueChange={([v]) => updateInvestment(idx, "timelineMonths", v)} />
                  </div>
                </div>
              ))}
            </div>

            <Button className="w-full" onClick={runSimulation} disabled={loading || !investments.length}>
              <Play className="w-4 h-4 mr-2" /> {loading ? "Simulating..." : "Run Simulation"}
            </Button>
          </CardContent>
        </Card>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-4">
          {activeScenario && r ? (
            <>
              {/* CEI Impact */}
              <Card>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-sm text-muted-foreground">Baseline CEI</p>
                      <p className="text-3xl font-mono font-bold">{activeScenario.baselineCei?.toFixed(1)}</p>
                    </div>
                    <div className="flex items-center justify-center">
                      <ArrowRight className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Projected CEI</p>
                      <p className="text-3xl font-mono font-bold text-primary">{activeScenario.projectedCei?.toFixed(1)}</p>
                    </div>
                  </div>
                  <div className="text-center mt-2">
                    <Badge variant={r.ceiDelta >= 0 ? "default" : "destructive"}>
                      {r.ceiDelta >= 0 ? "+" : ""}{r.ceiDelta.toFixed(1)} CEI points
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Moat Changes */}
              {r.moatChanges.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" /> Moat Impact</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {r.moatChanges.map((m, i) => (
                        <div key={i} className="flex items-center justify-between border-b pb-2">
                          <span className="text-sm font-medium">{m.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">{m.before}</span>
                            <ArrowRight className="w-4 h-4" />
                            <span className="text-sm font-bold text-primary">{m.after}</span>
                            <Badge variant="outline" className="text-xs">+{m.after - m.before}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Fragility Changes */}
              {r.fragilitChanges.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Fragility Impact</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {r.fragilitChanges.map((f, i) => (
                        <div key={i} className="flex items-center justify-between border-b pb-2">
                          <span className="text-sm font-medium">{f.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">{f.before}</span>
                            <ArrowRight className="w-4 h-4" />
                            <span className="text-sm font-bold text-emerald-500">{f.after}</span>
                            <Badge variant="outline" className="text-xs text-emerald-500">{f.after - f.before}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* EVaR Reduction */}
              {r.evarReduction.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><TrendingDown className="w-5 h-5" /> EVaR Reduction (12mo)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {r.evarReduction.map((e, i) => (
                        <div key={i} className="flex items-center justify-between border-b pb-2">
                          <span className="text-sm font-medium">{e.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">${e.before12mo}M</span>
                            <ArrowRight className="w-4 h-4" />
                            <span className="text-sm font-bold">${e.after12mo}M</span>
                            <Badge variant="outline" className="text-xs text-emerald-500">
                              -${(e.before12mo - e.after12mo).toFixed(1)}M
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Cascade Effects */}
              {r.cascadeEffects.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Cascade Effects</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {r.cascadeEffects.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm border-b pb-2">
                          <Badge variant="outline">{c.fromName}</Badge>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                          <Badge variant="outline">{c.toName}</Badge>
                          <span className="ml-auto text-muted-foreground">{c.impactDelta > 0 ? "+" : ""}{c.impactDelta}M impact</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FlaskConical className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>Add investments and run a simulation to see projected impact.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Past Scenarios */}
      {scenarios.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Saved Scenarios</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {scenarios.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b pb-2 cursor-pointer hover:bg-muted/30 px-2 rounded" onClick={() => setActiveScenario(s)}>
                  <div>
                    <span className="font-medium text-sm">{s.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{s.investments.length} investment(s)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.results?.ceiDelta >= 0 ? "default" : "destructive"}>
                      {s.results?.ceiDelta >= 0 ? "+" : ""}{s.results?.ceiDelta?.toFixed(1)} CEI
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteScenario(s.id); }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
