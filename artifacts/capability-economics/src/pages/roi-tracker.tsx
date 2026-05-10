import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DollarSign, TrendingUp, Plus, Trash2, PieChart, BarChart3 } from "lucide-react";

const API_BASE = "/api";

type RoiRecord = {
  id: number;
  capabilityId: number;
  capabilityName: string;
  quarter: string;
  spendUsdK: number | null;
  revenueImpactUsdK: number | null;
  efficiencyGainPct: number | null;
  maturityBefore: number | null;
  maturityAfter: number | null;
  notes: string | null;
};

type Summary = {
  totalSpendK: number;
  totalRevenueK: number;
  netRoiPct: number;
  avgEfficiencyPct: number;
  quarters: string[];
  capabilities: Array<{
    capabilityId: number;
    capabilityName: string;
    totalSpendK: number;
    totalRevenueK: number;
    roi: number;
    maturityDelta: number;
    records: number;
  }>;
};

type Capability = { id: number; name: string };

export default function RoiTracker() {
  const [records, setRecords] = useState<RoiRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ capabilityId: 0, quarter: "2026-Q2", spendUsdK: "", revenueImpactUsdK: "", efficiencyGainPct: "", maturityBefore: "", maturityAfter: "", notes: "" });
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  const load = async () => {
    try {
      const [rRes, sRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/roi/records?sessionToken=${sessionToken}`),
        fetch(`${API_BASE}/roi/summary?sessionToken=${sessionToken}`),
        fetch(`${API_BASE}/capabilities`),
      ]);
      setRecords(await rRes.json());
      setSummary(await sRes.json());
      const caps = await cRes.json();
      setCapabilities(caps);
      if (caps.length && !form.capabilityId) setForm((f) => ({ ...f, capabilityId: caps[0].id }));
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, []);

  const addRecord = async () => {
    await fetch(`${API_BASE}/roi/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionToken,
        capabilityId: form.capabilityId,
        quarter: form.quarter,
        spendUsdK: form.spendUsdK ? Number(form.spendUsdK) : null,
        revenueImpactUsdK: form.revenueImpactUsdK ? Number(form.revenueImpactUsdK) : null,
        efficiencyGainPct: form.efficiencyGainPct ? Number(form.efficiencyGainPct) : null,
        maturityBefore: form.maturityBefore ? Number(form.maturityBefore) : null,
        maturityAfter: form.maturityAfter ? Number(form.maturityAfter) : null,
        notes: form.notes || null,
      }),
    });
    setShowForm(false);
    setForm((f) => ({ ...f, spendUsdK: "", revenueImpactUsdK: "", efficiencyGainPct: "", maturityBefore: "", maturityAfter: "", notes: "" }));
    await load();
  };

  const deleteRecord = async (id: number) => {
    await fetch(`${API_BASE}/roi/records/${id}`, { method: "DELETE" });
    await load();
  };

  const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}M` : `$${n}K`;

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">ROI</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Capability ROI Attribution</h1>
          <p className="text-muted-foreground text-sm mt-1">Track quarterly spend, revenue impact, and efficiency gains per capability. Compare projected vs actual ROI.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" /> Add Record</Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-sm font-medium">Capability</label>
                <select className="w-full border rounded px-3 py-2 bg-background text-sm" value={form.capabilityId} onChange={(e) => setForm({ ...form, capabilityId: Number(e.target.value) })}>
                  {capabilities.filter((c) => (c as any).isLeaf !== false).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Quarter</label>
                <Input value={form.quarter} onChange={(e) => setForm({ ...form, quarter: e.target.value })} placeholder="2026-Q2" />
              </div>
              <div>
                <label className="text-sm font-medium">Spend ($K)</label>
                <Input type="number" value={form.spendUsdK} onChange={(e) => setForm({ ...form, spendUsdK: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Revenue Impact ($K)</label>
                <Input type="number" value={form.revenueImpactUsdK} onChange={(e) => setForm({ ...form, revenueImpactUsdK: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Efficiency Gain %</label>
                <Input type="number" value={form.efficiencyGainPct} onChange={(e) => setForm({ ...form, efficiencyGainPct: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Maturity Before</label>
                <Input type="number" value={form.maturityBefore} onChange={(e) => setForm({ ...form, maturityBefore: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Maturity After</label>
                <Input type="number" value={form.maturityAfter} onChange={(e) => setForm({ ...form, maturityAfter: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={addRecord}>Save</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <DollarSign className="w-6 h-6 mx-auto mb-2 text-primary" />
              <p className="text-2xl font-bold">{fmtK(summary.totalSpendK)}</p>
              <p className="text-xs text-muted-foreground">Total Investment</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <TrendingUp className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
              <p className="text-2xl font-bold">{fmtK(summary.totalRevenueK)}</p>
              <p className="text-xs text-muted-foreground">Revenue Impact</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <PieChart className="w-6 h-6 mx-auto mb-2 text-amber-500" />
              <p className={`text-2xl font-bold ${summary.netRoiPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{summary.netRoiPct}%</p>
              <p className="text-xs text-muted-foreground">Net ROI</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <BarChart3 className="w-6 h-6 mx-auto mb-2 text-primary" />
              <p className="text-2xl font-bold">{summary.avgEfficiencyPct.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Avg Efficiency Gain</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Per-Capability Breakdown */}
      {summary && summary.capabilities.length > 0 && (
        <Card>
          <CardHeader><CardTitle>ROI by Capability</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {summary.capabilities.sort((a, b) => b.roi - a.roi).map((c) => (
                <div key={c.capabilityId} className="border rounded-none p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{c.capabilityName}</span>
                    <Badge variant={c.roi >= 0 ? "default" : "destructive"}>{c.roi}% ROI</Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Spend: </span><strong>{fmtK(c.totalSpendK)}</strong></div>
                    <div><span className="text-muted-foreground">Revenue: </span><strong>{fmtK(c.totalRevenueK)}</strong></div>
                    <div><span className="text-muted-foreground">Maturity Δ: </span><strong className={c.maturityDelta >= 0 ? "text-emerald-500" : "text-destructive"}>{c.maturityDelta >= 0 ? "+" : ""}{c.maturityDelta}</strong></div>
                    <div><span className="text-muted-foreground">Records: </span><strong>{c.records}</strong></div>
                  </div>
                  {/* ROI bar */}
                  <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.roi >= 0 ? "bg-emerald-500" : "bg-destructive"}`} style={{ width: `${Math.min(100, Math.abs(c.roi))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Records Table */}
      <Card>
        <CardHeader><CardTitle>All Records ({records.length})</CardTitle></CardHeader>
        <CardContent>
          {records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Quarter</th>
                    <th className="text-left py-2">Capability</th>
                    <th className="text-right py-2">Spend</th>
                    <th className="text-right py-2">Revenue</th>
                    <th className="text-right py-2">Efficiency</th>
                    <th className="text-right py-2">Maturity</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2"><Badge variant="outline" className="text-xs">{r.quarter}</Badge></td>
                      <td className="py-2">{r.capabilityName}</td>
                      <td className="text-right py-2">{r.spendUsdK != null ? `$${r.spendUsdK}K` : "—"}</td>
                      <td className="text-right py-2">{r.revenueImpactUsdK != null ? `$${r.revenueImpactUsdK}K` : "—"}</td>
                      <td className="text-right py-2">{r.efficiencyGainPct != null ? `${r.efficiencyGainPct}%` : "—"}</td>
                      <td className="text-right py-2">
                        {r.maturityBefore != null && r.maturityAfter != null
                          ? `${r.maturityBefore} → ${r.maturityAfter}`
                          : "—"}
                      </td>
                      <td className="py-2"><Button size="sm" variant="ghost" onClick={() => deleteRecord(r.id)}><Trash2 className="w-4 h-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No ROI records yet. Add your first quarterly data point.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
