import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Save, X, RefreshCw, ChevronLeft, Search, Scale } from "lucide-react";

const API_BASE = "/api";

interface Regulation {
  id: number;
  name: string;
  shortCode: string;
  description: string | null;
  jurisdiction: string;
  effectiveDate: string | null;
  industries: number[];
}

interface Requirement {
  id: number;
  regulationId: number;
  capabilityId: number;
  capabilityName: string | null;
  requiredMaturity: number;
  priority: string;
  article: string | null;
  evidenceNotes: string | null;
  benchmarkScore?: number | null;
}

interface Industry { id: number; name: string }
interface CapabilityRow { id: number; name: string; slug: string; industryId: number }

const PRIORITY_TONE: Record<string, string> = {
  required: "bg-destructive/15 text-destructive border-destructive/40",
  recommended: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  optional: "bg-muted text-muted-foreground border-border",
};

export default function AdminRegulations() {
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReg, setSelectedReg] = useState<Regulation | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, i] = await Promise.all([
        fetch(`${API_BASE}/regulations`, { credentials: "include" }).then(x => x.json()),
        fetch(`${API_BASE}/industries`, { credentials: "include" }).then(x => x.json()),
      ]);
      setRegulations(Array.isArray(r) ? r : []);
      setIndustries(Array.isArray(i) ? i : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (selectedReg) {
    return (
      <RegulationEditor
        regulation={selectedReg}
        industries={industries}
        onBack={() => { setSelectedReg(null); load(); }}
      />
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl tracking-tight flex items-center gap-3">
            <Scale className="w-7 h-7 text-primary" />
            Regulations editor
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            Admin-direct content management for regulations + capability requirements. Edits land in the live tables immediately — no seed scripts, no review queue, no deploy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreateRegulationButton industries={industries} onCreated={load} />
          <Button variant="outline" onClick={load} disabled={loading} className="rounded-none">
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      {loading && regulations.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Loading…</p>
      ) : regulations.length === 0 ? (
        <Card className="rounded-none">
          <CardContent className="p-12 text-center text-sm text-muted-foreground italic">
            No regulations yet. Create one with the button above.
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-serif">{regulations.length} regulations</CardTitle>
            <CardDescription>Click any row to edit name, description, jurisdiction, effective date, industry coverage, and its capability requirements.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Jurisdiction</th>
                  <th className="px-3 py-2 text-left">Effective</th>
                  <th className="px-3 py-2 text-right">Industries</th>
                </tr>
              </thead>
              <tbody>
                {regulations.sort((a, b) => a.shortCode.localeCompare(b.shortCode)).map(r => (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/40 cursor-pointer"
                    onClick={() => setSelectedReg(r)}
                    data-testid={`row-regulation-${r.shortCode}`}
                  >
                    <td className="px-3 py-3 font-mono text-xs">{r.shortCode}</td>
                    <td className="px-3 py-3">{r.name}</td>
                    <td className="px-3 py-3">
                      <Badge variant="outline" className="rounded-none font-mono text-[10px]">{r.jurisdiction}</Badge>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {r.effectiveDate ? new Date(r.effectiveDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{r.industries.length}</td>
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

function CreateRegulationButton({ industries, onCreated }: { industries: Industry[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    shortCode: "", name: "", description: "", jurisdiction: "global", effectiveDate: "",
    industries: [] as number[],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/regulations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          effectiveDate: form.effectiveDate || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Failed (${res.status})`);
        return;
      }
      onCreated();
      setOpen(false);
      setForm({ shortCode: "", name: "", description: "", jurisdiction: "global", effectiveDate: "", industries: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-none" data-testid="button-create-regulation">
          <Plus className="w-4 h-4 mr-1.5" />
          New regulation
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a regulation</DialogTitle>
          <DialogDescription>Lives in the global catalog — visible to all users. Add capability requirements on the detail screen.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reg-code">Short code</Label>
              <Input id="reg-code" value={form.shortCode} onChange={e => setForm({ ...form, shortCode: e.target.value })} placeholder="DORA" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-juris">Jurisdiction</Label>
              <Input id="reg-juris" value={form.jurisdiction} onChange={e => setForm({ ...form, jurisdiction: e.target.value })} placeholder="EU" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-name">Name</Label>
            <Input id="reg-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Digital Operational Resilience Act" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-desc">Description</Label>
            <Textarea id="reg-desc" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-eff">Effective date</Label>
            <Input id="reg-eff" type="date" value={form.effectiveDate} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Applies to industries</Label>
            <div className="flex flex-wrap gap-1.5">
              {industries.map(ind => {
                const on = form.industries.includes(ind.id);
                return (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      industries: on ? f.industries.filter(i => i !== ind.id) : [...f.industries, ind.id],
                    }))}
                    className={`px-2.5 py-1 text-xs rounded-none border transition-colors ${
                      on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"
                    }`}
                  >
                    {ind.name}
                  </button>
                );
              })}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.shortCode || !form.name} className="rounded-none">
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegulationEditor({
  regulation, industries, onBack,
}: { regulation: Regulation; industries: Industry[]; onBack: () => void }) {
  const [reg, setReg] = useState<Regulation>(regulation);
  const [editing, setEditing] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingReg, setSavingReg] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/regulations/${reg.id}`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json() as Regulation & { requirements: Requirement[] };
        setReg(json);
        setRequirements(json.requirements ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [regulation.id]);

  const saveReg = async (patch: Partial<Regulation>) => {
    setSavingReg(true);
    try {
      const res = await fetch(`${API_BASE}/regulations/${reg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const json = await res.json() as Regulation;
        setReg(json);
        setEditing(false);
      }
    } finally {
      setSavingReg(false);
    }
  };

  const deleteReg = async () => {
    if (!window.confirm(`Delete ${reg.shortCode}? This removes ALL ${requirements.length} requirements with it.`)) return;
    const res = await fetch(`${API_BASE}/regulations/${reg.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) onBack();
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" onClick={onBack} className="rounded-none -ml-2">
        <ChevronLeft className="w-4 h-4 mr-1.5" />
        Back to all regulations
      </Button>

      <Card className="rounded-none">
        <CardHeader>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <CardTitle className="text-2xl font-serif flex items-center gap-3">
              {reg.shortCode}
              <Badge variant="outline" className="rounded-none font-mono text-[10px]">{reg.jurisdiction}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              {!editing ? (
                <Button variant="outline" onClick={() => setEditing(true)} className="rounded-none">
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit
                </Button>
              ) : null}
              <Button variant="ghost" onClick={deleteReg} className="rounded-none text-destructive hover:bg-destructive/10">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
            </div>
          </div>
          <CardDescription>{reg.name}</CardDescription>
        </CardHeader>
        <CardContent>
          {editing ? (
            <RegulationEditForm
              reg={reg}
              industries={industries}
              busy={savingReg}
              onCancel={() => setEditing(false)}
              onSave={saveReg}
            />
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Description</div>
                <p className="leading-relaxed">{reg.description ?? <span className="italic text-muted-foreground">No description.</span>}</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Effective date</div>
                  <div className="font-mono text-sm">{reg.effectiveDate ? new Date(reg.effectiveDate).toLocaleDateString() : "—"}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Applies to</div>
                  <div className="flex flex-wrap gap-1.5">
                    {reg.industries.length === 0 ? (
                      <span className="italic text-muted-foreground text-xs">No industries set.</span>
                    ) : (
                      reg.industries.map(id => {
                        const ind = industries.find(i => i.id === id);
                        return <Badge key={id} variant="outline" className="rounded-none">{ind?.name ?? `Industry ${id}`}</Badge>;
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <RequirementsEditor
        regId={reg.id}
        regulationIndustries={reg.industries}
        requirements={requirements}
        loading={loading}
        onChange={load}
      />
    </div>
  );
}

function RegulationEditForm({
  reg, industries, busy, onSave, onCancel,
}: {
  reg: Regulation;
  industries: Industry[];
  busy: boolean;
  onSave: (patch: Partial<Regulation>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(reg.name);
  const [description, setDescription] = useState(reg.description ?? "");
  const [jurisdiction, setJurisdiction] = useState(reg.jurisdiction);
  const [effectiveDate, setEffectiveDate] = useState(
    reg.effectiveDate ? new Date(reg.effectiveDate).toISOString().slice(0, 10) : "",
  );
  const [selectedIndustries, setSelectedIndustries] = useState<number[]>(reg.industries);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Jurisdiction</Label>
          <Input value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
      </div>
      <div className="space-y-1.5">
        <Label>Effective date</Label>
        <Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Applies to</Label>
        <div className="flex flex-wrap gap-1.5">
          {industries.map(ind => {
            const on = selectedIndustries.includes(ind.id);
            return (
              <button
                key={ind.id}
                type="button"
                onClick={() => setSelectedIndustries(prev => on ? prev.filter(i => i !== ind.id) : [...prev, ind.id])}
                className={`px-2.5 py-1 text-xs rounded-none border transition-colors ${
                  on ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"
                }`}
              >
                {ind.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel} className="rounded-none">Cancel</Button>
        <Button
          onClick={() => onSave({
            name,
            description: description || null,
            jurisdiction,
            effectiveDate: effectiveDate || null,
            industries: selectedIndustries,
          })}
          disabled={busy}
          className="rounded-none"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function RequirementsEditor({
  regId, regulationIndustries, requirements, loading, onChange,
}: {
  regId: number;
  regulationIndustries: number[];
  requirements: Requirement[];
  loading: boolean;
  onChange: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Card className="rounded-none">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base font-serif">Capability requirements</CardTitle>
          <CardDescription>{requirements.length} mappings · edits land live immediately</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} className="rounded-none">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add requirement
        </Button>
      </CardHeader>
      <CardContent>
        {creating && (
          <RequirementForm
            regId={regId}
            regulationIndustries={regulationIndustries}
            onClose={() => setCreating(false)}
            onSaved={() => { setCreating(false); onChange(); }}
          />
        )}
        {loading && requirements.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Loading…</p>
        ) : requirements.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-6 text-center">No requirements yet. Add the first one.</p>
        ) : (
          <div className="space-y-2">
            {requirements.map(r => (
              <div key={r.id}>
                {editingId === r.id ? (
                  <RequirementForm
                    regId={regId}
                    regulationIndustries={regulationIndustries}
                    requirement={r}
                    onClose={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); onChange(); }}
                  />
                ) : (
                  <RequirementRow r={r} onEdit={() => setEditingId(r.id)} onChange={onChange} />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RequirementRow({ r, onEdit, onChange }: { r: Requirement; onEdit: () => void; onChange: () => void }) {
  const remove = async () => {
    if (!window.confirm(`Remove this requirement (${r.capabilityName ?? r.capabilityId})?`)) return;
    const res = await fetch(`${API_BASE}/regulations/${r.regulationId}/requirements/${r.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) onChange();
  };
  return (
    <div className="flex items-start justify-between gap-3 p-3 border border-border hover:bg-muted/30">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{r.capabilityName ?? `Capability #${r.capabilityId}`}</span>
          <Badge variant="outline" className={`rounded-none text-[10px] uppercase ${PRIORITY_TONE[r.priority] ?? ""}`}>
            {r.priority}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">required maturity {r.requiredMaturity}</span>
        </div>
        {r.article && <div className="font-mono text-[10px] text-muted-foreground mt-1">{r.article}</div>}
        {r.evidenceNotes && <p className="text-xs text-foreground/80 mt-1.5 italic">{r.evidenceNotes}</p>}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onEdit} className="rounded-none h-7 w-7">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={remove} className="rounded-none h-7 w-7 text-destructive hover:bg-destructive/10">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RequirementForm({
  regId, regulationIndustries, requirement, onClose, onSaved,
}: {
  regId: number;
  regulationIndustries: number[];
  requirement?: Requirement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!requirement;
  const [capId, setCapId] = useState<number | null>(requirement?.capabilityId ?? null);
  const [capName, setCapName] = useState<string>(requirement?.capabilityName ?? "");
  const [requiredMaturity, setRequiredMaturity] = useState(requirement?.requiredMaturity ?? 70);
  const [priority, setPriority] = useState(requirement?.priority ?? "required");
  const [article, setArticle] = useState(requirement?.article ?? "");
  const [evidenceNotes, setEvidenceNotes] = useState(requirement?.evidenceNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!capId) { setError("Pick a capability first."); return; }
    setBusy(true); setError(null);
    try {
      const url = isEdit
        ? `${API_BASE}/regulations/${regId}/requirements/${requirement!.id}`
        : `${API_BASE}/regulations/${regId}/requirements`;
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = { requiredMaturity, priority, article: article || null, evidenceNotes: evidenceNotes || null };
      if (!isEdit) body.capabilityId = capId;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Failed (${res.status})`);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-primary/30 bg-primary/[0.04] p-3 space-y-3 mb-2">
      {!isEdit && (
        <CapabilityPicker
          regulationIndustries={regulationIndustries}
          selectedId={capId}
          selectedName={capName}
          onPick={(id, name) => { setCapId(id); setCapName(name); }}
        />
      )}
      {isEdit && capName && (
        <div className="font-medium text-sm">{capName}</div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Required maturity</Label>
          <Input
            type="number"
            min="0"
            max="100"
            value={requiredMaturity}
            onChange={e => setRequiredMaturity(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Priority</Label>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border bg-background rounded-none"
          >
            <option value="required">required</option>
            <option value="recommended">recommended</option>
            <option value="optional">optional</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Article</Label>
          <Input value={article} onChange={e => setArticle(e.target.value)} placeholder="e.g., 45 CFR 164.312(a)" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Evidence notes</Label>
        <Textarea value={evidenceNotes} onChange={e => setEvidenceNotes(e.target.value)} rows={2} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="rounded-none">
          <X className="w-3.5 h-3.5 mr-1.5" />
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={busy} className="rounded-none">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {busy ? "Saving…" : (isEdit ? "Save" : "Add")}
        </Button>
      </div>
    </div>
  );
}

function CapabilityPicker({
  regulationIndustries, selectedId, selectedName, onPick,
}: {
  regulationIndustries: number[];
  selectedId: number | null;
  selectedName: string;
  onPick: (id: number, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [caps, setCaps] = useState<CapabilityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Pre-load all capabilities for the regulation's industries on first focus.
  useEffect(() => {
    if (!open || caps.length > 0) return;
    setLoading(true);
    const reqs = regulationIndustries.length > 0
      ? regulationIndustries.map(id => fetch(`${API_BASE}/capabilities?industryId=${id}`).then(r => r.ok ? r.json() : []))
      : [fetch(`${API_BASE}/capabilities`).then(r => r.ok ? r.json() : [])];
    Promise.all(reqs)
      .then(arrs => setCaps(arrs.flat() as CapabilityRow[]))
      .catch(() => setCaps([]))
      .finally(() => setLoading(false));
  }, [open, regulationIndustries, caps.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return caps.slice(0, 30);
    return caps.filter(c => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)).slice(0, 30);
  }, [caps, query]);

  return (
    <div className="space-y-1.5">
      <Label>Capability</Label>
      {selectedId && !open ? (
        <div className="flex items-center justify-between p-2 border border-border bg-background">
          <span className="text-sm font-medium">{selectedName}</span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="rounded-none">Change</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setOpen(true)}
              placeholder="Search capabilities by name or slug…"
              className="pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto border border-border">
            {loading ? (
              <p className="text-xs text-muted-foreground italic p-2">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground italic p-2">No matches.</p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onPick(c.id, c.name); setOpen(false); setQuery(""); }}
                  className="w-full text-left px-2.5 py-1.5 text-xs border-b border-border last:border-b-0 hover:bg-muted transition-colors"
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground truncate">{c.slug}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
