import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Rocket, Plus, ChevronRight, Trash2, ArrowRight, CheckCircle, XCircle, Lightbulb, FlaskConical, Scaling, Crown } from "lucide-react";

const API_BASE = "/api";

const STAGES = [
  { key: "ideation", label: "Ideation", icon: Lightbulb, color: "text-blue-500" },
  { key: "pilot", label: "Pilot", icon: FlaskConical, color: "text-amber-500" },
  { key: "scale", label: "Scale", icon: Scaling, color: "text-primary" },
  { key: "mature", label: "Mature", icon: Crown, color: "text-emerald-500" },
  { key: "killed", label: "Killed", icon: XCircle, color: "text-destructive" },
];

type Project = {
  id: number;
  name: string;
  description: string | null;
  stage: string;
  targetCapabilities: Array<{ capabilityId: number; capabilityName: string; projectedUplift: number; actualUplift: number | null }>;
  investmentUsdK: number | null;
  projectedRoiPct: number | null;
  actualRoiPct: number | null;
  stageHistory: Array<{ stage: string; enteredAt: string; decision: string; notes: string }>;
  owner: string | null;
  createdAt: string;
};

export default function InnovationPipeline() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [advanceNotes, setAdvanceNotes] = useState("");
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/innovation/projects?sessionToken=${sessionToken}`);
      setProjects(await res.json());
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name) return;
    await fetch(`${API_BASE}/innovation/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, name, description }),
    });
    setName(""); setDescription(""); setShowForm(false);
    await load();
  };

  const advance = async (id: number, newStage: string) => {
    await fetch(`${API_BASE}/innovation/projects/${id}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newStage, decision: `Advanced to ${newStage}`, notes: advanceNotes }),
    });
    setAdvanceNotes("");
    await load();
    if (selectedProject?.id === id) {
      const res = await fetch(`${API_BASE}/innovation/projects/${id}`);
      setSelectedProject(await res.json());
    }
  };

  const deleteProject = async (id: number) => {
    await fetch(`${API_BASE}/innovation/projects/${id}`, { method: "DELETE" });
    if (selectedProject?.id === id) setSelectedProject(null);
    await load();
  };

  const byStage = (stage: string) => projects.filter((p) => p.stage === stage);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Innovation</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Innovation Pipeline</h1>
          <p className="text-muted-foreground text-sm mt-1">Track innovation projects from ideation through scale with capability uplift measurement.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}><Plus className="w-4 h-4 mr-2" /> New Project</Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={create}>Create</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Funnel View */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {STAGES.map(({ key, label, icon: Icon, color }) => (
          <Card key={key} className="min-h-[200px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Icon className={`w-4 h-4 ${color}`} />
                {label}
                <Badge variant="outline" className="ml-auto text-xs">{byStage(key).length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {byStage(key).map((p) => (
                <div
                  key={p.id}
                  className={`p-2 rounded border cursor-pointer hover:bg-muted/50 transition-colors ${selectedProject?.id === p.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedProject(p)}
                >
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  {p.investmentUsdK && <p className="text-xs text-muted-foreground">${p.investmentUsdK}K invested</p>}
                </div>
              ))}
              {byStage(key).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Empty</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Project Detail */}
      {selectedProject && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Rocket className="w-5 h-5" /> {selectedProject.name}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge>{selectedProject.stage}</Badge>
                <Button size="sm" variant="ghost" onClick={() => deleteProject(selectedProject.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedProject.description && <p className="text-sm text-muted-foreground">{selectedProject.description}</p>}

            {/* Stage Actions */}
            {selectedProject.stage !== "killed" && selectedProject.stage !== "mature" && (
              <div className="flex items-center gap-2 flex-wrap">
                <Input placeholder="Decision notes..." value={advanceNotes} onChange={(e) => setAdvanceNotes(e.target.value)} className="flex-1 min-w-[200px]" />
                {selectedProject.stage === "ideation" && <Button size="sm" onClick={() => advance(selectedProject.id, "pilot")}>Advance to Pilot <ChevronRight className="w-4 h-4 ml-1" /></Button>}
                {selectedProject.stage === "pilot" && <Button size="sm" onClick={() => advance(selectedProject.id, "scale")}>Advance to Scale <ChevronRight className="w-4 h-4 ml-1" /></Button>}
                {selectedProject.stage === "scale" && <Button size="sm" onClick={() => advance(selectedProject.id, "mature")}>Mark Mature <CheckCircle className="w-4 h-4 ml-1" /></Button>}
                <Button size="sm" variant="destructive" onClick={() => advance(selectedProject.id, "killed")}>Kill <XCircle className="w-4 h-4 ml-1" /></Button>
              </div>
            )}

            {/* ROI Comparison */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border rounded-none p-3 text-center">
                <p className="text-xs text-muted-foreground">Investment</p>
                <p className="text-lg font-bold">{selectedProject.investmentUsdK ? `$${selectedProject.investmentUsdK}K` : "—"}</p>
              </div>
              <div className="border rounded-none p-3 text-center">
                <p className="text-xs text-muted-foreground">Projected ROI</p>
                <p className="text-lg font-bold">{selectedProject.projectedRoiPct != null ? `${selectedProject.projectedRoiPct}%` : "—"}</p>
              </div>
              <div className="border rounded-none p-3 text-center">
                <p className="text-xs text-muted-foreground">Actual ROI</p>
                <p className="text-lg font-bold text-primary">{selectedProject.actualRoiPct != null ? `${selectedProject.actualRoiPct}%` : "—"}</p>
              </div>
              <div className="border rounded-none p-3 text-center">
                <p className="text-xs text-muted-foreground">Stages Passed</p>
                <p className="text-lg font-bold">{selectedProject.stageHistory?.length ?? 0}</p>
              </div>
            </div>

            {/* Stage History Timeline */}
            {selectedProject.stageHistory && selectedProject.stageHistory.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Stage History</h4>
                <div className="space-y-2">
                  {selectedProject.stageHistory.map((h, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <Badge variant="outline" className="text-xs min-w-[70px] justify-center">{h.stage}</Badge>
                      <span className="text-muted-foreground text-xs">{new Date(h.enteredAt).toLocaleDateString()}</span>
                      <span className="text-muted-foreground">{h.decision}</span>
                      {h.notes && <span className="text-xs italic text-muted-foreground">— {h.notes}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
