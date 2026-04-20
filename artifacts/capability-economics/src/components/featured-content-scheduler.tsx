import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Calendar, CheckCircle2, Clock, Loader2, Plus, RefreshCw, Trash2, Zap,
} from "lucide-react";

const API_BASE = "/api";

/**
 * Known slot keys the homepage currently renders. If you add another slot
 * in code, add it here too so admins see a human-readable label and
 * description instead of a bare string.
 */
const SLOT_DEFS: { key: string; label: string; description: string }[] = [
  { key: "homepage_hero", label: "Homepage hero CTA", description: "Primary 'View … Case Study' button in the hero section." },
  { key: "homepage_case_card", label: "Homepage case card", description: "The dark 'Industry Case: …' navigation card at the bottom of the page." },
];

type CaseStudy = { id: number; industrySlug: string; industryName: string; title: string };
type Placement = {
  slot: {
    id: number;
    slotKey: string;
    contentType: string;
    contentId: number;
    startsAt: string | null;
    endsAt: string | null;
    priority: number;
    note: string | null;
    createdAt: string;
    updatedAt: string;
  };
  caseStudyTitle: string | null;
  industrySlug: string | null;
  industryName: string | null;
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");
const toDateTimeLocal = (s: string | null): string => {
  if (!s) return "";
  const d = new Date(s);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function FeaturedContentScheduler() {
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [form, setForm] = useState<Record<string, { contentId: string; startsAt: string; endsAt: string; priority: string; note: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        fetch(`${API_BASE}/admin/featured-content`, { credentials: "include" }).then(r => r.ok ? r.json() : { placements: [] }),
        fetch(`${API_BASE}/case-studies`).then(r => r.ok ? r.json() : []),
      ]);
      setPlacements(p.placements ?? []);
      setCaseStudies(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const placementsBySlot = useMemo(() => {
    const map = new Map<string, Placement[]>();
    for (const p of placements) {
      const arr = map.get(p.slot.slotKey) ?? [];
      arr.push(p);
      map.set(p.slot.slotKey, arr);
    }
    return map;
  }, [placements]);

  const slotState = (p: Placement): { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> } => {
    const now = Date.now();
    const start = p.slot.startsAt ? new Date(p.slot.startsAt).getTime() : -Infinity;
    const end = p.slot.endsAt ? new Date(p.slot.endsAt).getTime() : Infinity;
    if (now < start) return { label: "Scheduled", cls: "bg-blue-500/10 text-blue-700 border border-blue-500/20", Icon: Calendar };
    if (now > end) return { label: "Expired", cls: "bg-slate-500/10 text-slate-600 border border-slate-500/20", Icon: Clock };
    return { label: "Live", cls: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20", Icon: CheckCircle2 };
  };

  const getForm = (slotKey: string) =>
    form[slotKey] ?? { contentId: "", startsAt: "", endsAt: "", priority: "0", note: "" };

  const setFormField = (slotKey: string, field: keyof ReturnType<typeof getForm>, value: string) => {
    setForm(prev => ({ ...prev, [slotKey]: { ...getForm(slotKey), [field]: value } }));
  };

  const schedule = async (slotKey: string) => {
    const f = getForm(slotKey);
    const contentId = Number(f.contentId);
    if (!contentId) { alert("Pick a case study first."); return; }
    setBusy(`create-${slotKey}`);
    try {
      const body: Record<string, unknown> = {
        slotKey,
        contentType: "case_study",
        contentId,
        priority: Number(f.priority) || 0,
      };
      if (f.startsAt) body.startsAt = new Date(f.startsAt).toISOString();
      if (f.endsAt) body.endsAt = new Date(f.endsAt).toISOString();
      if (f.note.trim()) body.note = f.note.trim();

      const res = await fetch(`${API_BASE}/admin/featured-content`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setForm(prev => ({ ...prev, [slotKey]: { contentId: "", startsAt: "", endsAt: "", priority: "0", note: "" } }));
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this placement?")) return;
    setBusy(`delete-${id}`);
    try {
      const res = await fetch(`${API_BASE}/admin/featured-content/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="rounded-none">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-lg flex items-center gap-2"><Zap className="w-5 h-5 text-primary" /> Featured content scheduling</CardTitle>
          <CardDescription>Pick which case study appears in each homepage slot, and when. Higher priority wins when multiple are active.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {SLOT_DEFS.map(slot => {
          const rows = placementsBySlot.get(slot.key) ?? [];
          const f = getForm(slot.key);
          return (
            <div key={slot.key} className="border border-border p-4 space-y-3">
              <div>
                <div className="font-medium">{slot.label}</div>
                <div className="text-xs text-muted-foreground">{slot.description}</div>
              </div>

              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No placements. Falling back to the most recent case study.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/30">
                      <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-2 py-1.5">Status</th>
                        <th className="px-2 py-1.5">Content</th>
                        <th className="px-2 py-1.5">Starts</th>
                        <th className="px-2 py-1.5">Ends</th>
                        <th className="px-2 py-1.5 text-right">Priority</th>
                        <th className="px-2 py-1.5">Note</th>
                        <th className="px-2 py-1.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(p => {
                        const s = slotState(p);
                        return (
                          <tr key={p.slot.id} className="border-b">
                            <td className="px-2 py-2">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${s.cls}`}>
                                <s.Icon className="w-3 h-3" /> {s.label}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-sm">
                              <div className="font-medium">{p.caseStudyTitle ?? `#${p.slot.contentId}`}</div>
                              {p.industryName && <div className="text-xs text-muted-foreground">{p.industryName}</div>}
                            </td>
                            <td className="px-2 py-2 text-xs text-muted-foreground">{fmtDate(p.slot.startsAt)}</td>
                            <td className="px-2 py-2 text-xs text-muted-foreground">{fmtDate(p.slot.endsAt)}</td>
                            <td className="px-2 py-2 text-right font-mono text-xs">{p.slot.priority}</td>
                            <td className="px-2 py-2 text-xs text-muted-foreground">{p.slot.note ?? "—"}</td>
                            <td className="px-2 py-2 text-right">
                              <Button size="sm" variant="ghost" onClick={() => remove(p.slot.id)} disabled={busy === `delete-${p.slot.id}`} className="h-7 text-red-600 hover:bg-red-50">
                                {busy === `delete-${p.slot.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add-new row */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_160px_80px_1fr_auto] gap-2 items-end">
                <div>
                  <Label className="text-xs">Case study</Label>
                  <select
                    className="w-full h-9 border border-border px-2 text-sm bg-background"
                    value={f.contentId}
                    onChange={e => setFormField(slot.key, "contentId", e.target.value)}
                  >
                    <option value="">Pick one...</option>
                    {caseStudies.map(cs => (
                      <option key={cs.id} value={String(cs.id)}>
                        {cs.industryName} — {cs.title.slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Starts (optional)</Label>
                  <Input type="datetime-local" value={f.startsAt} onChange={e => setFormField(slot.key, "startsAt", e.target.value)} className="rounded-none h-9" />
                </div>
                <div>
                  <Label className="text-xs">Ends (optional)</Label>
                  <Input type="datetime-local" value={f.endsAt} onChange={e => setFormField(slot.key, "endsAt", e.target.value)} className="rounded-none h-9" />
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Input type="number" value={f.priority} onChange={e => setFormField(slot.key, "priority", e.target.value)} className="rounded-none h-9 font-mono" />
                </div>
                <div>
                  <Label className="text-xs">Label (optional)</Label>
                  <Input placeholder="e.g. Q4 campaign" value={f.note} onChange={e => setFormField(slot.key, "note", e.target.value)} className="rounded-none h-9" />
                </div>
                <Button size="sm" onClick={() => schedule(slot.key)} disabled={!f.contentId || busy === `create-${slot.key}`} className="rounded-none h-9">
                  {busy === `create-${slot.key}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span className="ml-1">Schedule</span>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Leave <strong>Starts</strong> blank to go live immediately, <strong>Ends</strong> blank to run indefinitely.
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
