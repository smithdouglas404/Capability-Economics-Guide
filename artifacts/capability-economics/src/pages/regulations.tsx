import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Scale, Plus, ShieldCheck, ShieldAlert, AlertTriangle, ChevronRight, ArrowLeft } from "lucide-react";

const API_BASE = "/api";

type Regulation = {
  id: number;
  name: string;
  shortCode: string;
  description: string | null;
  jurisdiction: string;
  effectiveDate: string | null;
  industries: number[];
};

type Requirement = {
  capabilityId: number;
  capabilityName: string;
  requiredMaturity: number;
  priority: string;
  article: string | null;
  myScore: number | null;
  compliant: boolean | null;
  gap: number | null;
  benchmarkScore: number | null;
};

type ComplianceResult = {
  regulation: Regulation;
  overallCompliance: number | null;
  total: number;
  assessed: number;
  compliant: number;
  nonCompliant: number;
  results: Requirement[];
};

export default function Regulations() {
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [selectedReg, setSelectedReg] = useState<ComplianceResult | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", shortCode: "", description: "", jurisdiction: "global" });
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/regulations`);
      setRegulations(await res.json());
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, []);

  const createReg = async () => {
    if (!form.name || !form.shortCode) return;
    await fetch(`${API_BASE}/regulations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setShowForm(false);
    setForm({ name: "", shortCode: "", description: "", jurisdiction: "global" });
    await load();
  };

  const checkCompliance = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/regulations/${id}/compliance?sessionToken=${sessionToken}`);
      setSelectedReg(await res.json());
    } catch (err) { console.error(err); }
  };

  const deleteReg = async (id: number) => {
    await fetch(`${API_BASE}/regulations/${id}`, { method: "DELETE" });
    if (selectedReg?.regulation.id === id) setSelectedReg(null);
    await load();
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Badge className="mb-2">Compliance</Badge>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Compliance</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Regulatory Capability Mapping</h1>
          <p className="text-muted-foreground mt-1">Map regulatory requirements to capabilities and check your compliance posture.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" /> Add Regulation</Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="DORA" />
              </div>
              <div>
                <label className="text-sm font-medium">Short Code</label>
                <Input value={form.shortCode} onChange={(e) => setForm({ ...form, shortCode: e.target.value })} placeholder="DORA" />
              </div>
              <div>
                <label className="text-sm font-medium">Jurisdiction</label>
                <Input value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} placeholder="EU" />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={createReg}>Create</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!selectedReg ? (
        <>
          {/* Regulation Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {regulations.map((reg) => (
              <Card key={reg.id} className="cursor-pointer hover:ring-2 ring-primary transition-all" onClick={() => checkCompliance(reg.id)}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Scale className="w-5 h-5 text-primary" />
                      {reg.shortCode}
                    </CardTitle>
                    <Badge variant="outline">{reg.jurisdiction}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="font-medium text-sm">{reg.name}</p>
                  {reg.description && <p className="text-sm text-muted-foreground mt-1">{reg.description}</p>}
                  {reg.effectiveDate && (
                    <p className="text-xs text-muted-foreground mt-2">Effective: {new Date(reg.effectiveDate).toLocaleDateString()}</p>
                  )}
                  <div className="flex items-center gap-1 mt-3 text-primary text-sm">
                    Check Compliance <ChevronRight className="w-4 h-4" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {regulations.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Scale className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No regulations configured. Add DORA, GDPR, SOX, or other frameworks to map capability requirements.</p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          {/* Compliance Detail View */}
          <Button variant="ghost" onClick={() => setSelectedReg(null)}><ArrowLeft className="w-4 h-4 mr-2" /> Back to all regulations</Button>

          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-2xl font-serif tracking-tight">{selectedReg.regulation.shortCode}: {selectedReg.regulation.name}</h2>
            <Badge variant="outline">{selectedReg.regulation.jurisdiction}</Badge>
          </div>

          {/* Compliance Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                {selectedReg.overallCompliance !== null ? (
                  <>
                    <p className={`text-3xl font-bold ${selectedReg.overallCompliance >= 80 ? "text-emerald-500" : selectedReg.overallCompliance >= 50 ? "text-amber-500" : "text-destructive"}`}>
                      {selectedReg.overallCompliance}%
                    </p>
                    <p className="text-xs text-muted-foreground">Overall Compliance</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold text-muted-foreground">—</p>
                    <p className="text-xs text-muted-foreground">Not Assessed</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                <p className="text-2xl font-bold">{selectedReg.compliant}</p>
                <p className="text-xs text-muted-foreground">Compliant</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <ShieldAlert className="w-6 h-6 mx-auto mb-2 text-destructive" />
                <p className="text-2xl font-bold">{selectedReg.nonCompliant}</p>
                <p className="text-xs text-muted-foreground">Non-Compliant</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                <p className="text-2xl font-bold">{selectedReg.total - selectedReg.assessed}</p>
                <p className="text-xs text-muted-foreground">Unassessed</p>
              </CardContent>
            </Card>
          </div>

          {/* Requirements Table */}
          <Card>
            <CardHeader><CardTitle>Capability Requirements</CardTitle></CardHeader>
            <CardContent>
              {selectedReg.results.length > 0 ? (
                <div className="space-y-2">
                  {selectedReg.results.sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).map((r, i) => (
                    <div key={i} className={`flex items-center justify-between p-3 rounded-none border ${
                      r.compliant === true ? "border-emerald-500/30 bg-emerald-500/5" :
                      r.compliant === false ? "border-destructive/30 bg-destructive/5" :
                      ""
                    }`}>
                      <div>
                        <span className="font-medium text-sm">{r.capabilityName}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">{r.priority}</Badge>
                          {r.article && <span className="text-xs text-muted-foreground">{r.article}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Required</p>
                          <p className="font-mono">{r.requiredMaturity}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Your Score</p>
                          <p className="font-mono">{r.myScore?.toFixed(0) ?? "—"}</p>
                        </div>
                        <div className="text-right min-w-[60px]">
                          {r.compliant === true && <Badge className="bg-emerald-500">Compliant</Badge>}
                          {r.compliant === false && <Badge variant="destructive">Gap: {r.gap?.toFixed(0)}</Badge>}
                          {r.compliant === null && <Badge variant="outline">Unassessed</Badge>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">No capability requirements configured for this regulation yet.</p>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button variant="destructive" size="sm" onClick={() => { deleteReg(selectedReg.regulation.id); }}>Delete Regulation</Button>
          </div>
        </>
      )}
    </div>
  );
}
