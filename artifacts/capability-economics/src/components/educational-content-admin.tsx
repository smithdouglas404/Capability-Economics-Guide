import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Plus, Edit2, Trash2, Save, X, AlertCircle } from "lucide-react";

const API_BASE = "/api";
const CATEGORIES = ["concept", "methodology", "case-study", "framework", "metric"] as const;

interface EduContent {
  id: number;
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  keyTakeaways: string[];
  sources: { url: string; title: string }[];
  category: string;
  estimatedReadMinutes: number;
  displayOrder: number;
  published: boolean;
  updatedAt: string;
}

interface FormState {
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  keyTakeawaysText: string;
  sourcesText: string;
  category: string;
  estimatedReadMinutes: number;
  displayOrder: number;
  published: boolean;
}

const EMPTY_FORM: FormState = {
  slug: "",
  title: "",
  summary: "",
  bodyMarkdown: "",
  keyTakeawaysText: "",
  sourcesText: "",
  category: "concept",
  estimatedReadMinutes: 5,
  displayOrder: 0,
  published: true,
};

function parseTakeaways(text: string): string[] {
  return text.split("\n").map(s => s.trim()).filter(Boolean);
}

function parseSources(text: string): { url: string; title: string }[] {
  return text.split("\n").map(line => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const idx = trimmed.indexOf("|");
    if (idx === -1) return { url: trimmed, title: trimmed };
    return { url: trimmed.slice(0, idx).trim(), title: trimmed.slice(idx + 1).trim() };
  }).filter((s): s is { url: string; title: string } => s !== null && s.url.length > 0);
}

function formatTakeaways(items: string[]): string {
  return items.join("\n");
}

function formatSources(items: { url: string; title: string }[]): string {
  return items.map(s => `${s.url} | ${s.title}`).join("\n");
}

export default function EducationalContentAdmin() {
  const [items, setItems] = useState<EduContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EduContent | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem("admin_token") ?? "");

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/educational-content`, {
        headers: adminToken ? { "x-admin-token": adminToken } : {},
      });
      if (res.status === 401) {
        setError("Admin token required.");
        setItems([]);
      } else if (res.ok) {
        setItems(await res.json());
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const startCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const startEdit = (item: EduContent) => {
    setCreating(false);
    setEditing(item);
    setForm({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      bodyMarkdown: item.bodyMarkdown,
      keyTakeawaysText: formatTakeaways(item.keyTakeaways),
      sourcesText: formatSources(item.sources),
      category: item.category,
      estimatedReadMinutes: item.estimatedReadMinutes,
      displayOrder: item.displayOrder,
      published: item.published,
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setCreating(false);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const takeaways = parseTakeaways(form.keyTakeawaysText);
    const sources = parseSources(form.sourcesText);
    if (takeaways.length < 3) { setError("At least 3 key takeaways required."); setSaving(false); return; }
    if (sources.length < 1) { setError("At least 1 source required."); setSaving(false); return; }

    const payload = {
      slug: form.slug,
      title: form.title,
      summary: form.summary,
      bodyMarkdown: form.bodyMarkdown,
      keyTakeaways: takeaways,
      sources,
      category: form.category,
      estimatedReadMinutes: form.estimatedReadMinutes,
      displayOrder: form.displayOrder,
      published: form.published,
    };
    try {
      const url = editing
        ? `${API_BASE}/admin/educational-content/${editing.id}`
        : `${API_BASE}/admin/educational-content`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...(adminToken ? { "x-admin-token": adminToken } : {}) },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Save failed (${res.status})`);
      } else {
        cancelEdit();
        fetchItems();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this content item?")) return;
    await fetch(`${API_BASE}/admin/educational-content/${id}`, {
      method: "DELETE",
      headers: adminToken ? { "x-admin-token": adminToken } : {},
    });
    fetchItems();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BookOpen className="w-5 h-5" /> Educational Content CMS
          <span className="text-sm font-normal text-muted-foreground ml-2">({items.length} items)</span>
        </CardTitle>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Admin token"
            value={adminToken}
            onChange={e => { setAdminToken(e.target.value); localStorage.setItem("admin_token", e.target.value); }}
            className="w-40 h-8 text-xs"
          />
          <Button size="sm" onClick={startCreate} disabled={creating || editing !== null} className="gap-1">
            <Plus className="w-3 h-3" /> New
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-500/10 text-red-700 text-sm rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {(creating || editing) && (
          <div className="mb-6 p-4 border-2 border-primary/30 bg-primary/5 rounded space-y-3">
            <div className="font-semibold text-sm">{editing ? `Edit: ${editing.title}` : "Create new content"}</div>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Slug (lowercase-hyphen)" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} />
              <Input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </div>
            <Textarea placeholder="Summary (1-2 sentences)" value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} rows={2} />
            <Textarea placeholder="Body (markdown)" value={form.bodyMarkdown} onChange={e => setForm({ ...form, bodyMarkdown: e.target.value })} rows={6} />
            <div>
              <label className="text-xs text-muted-foreground">Key Takeaways (one per line, 3-7)</label>
              <Textarea value={form.keyTakeawaysText} onChange={e => setForm({ ...form, keyTakeawaysText: e.target.value })} rows={4} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Sources (one per line, format: URL | Title)</label>
              <Textarea value={form.sourcesText} onChange={e => setForm({ ...form, sourcesText: e.target.value })} rows={3} />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <select className="h-9 px-2 text-sm border bg-background rounded" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Input type="number" min={1} max={60} placeholder="Read minutes" value={form.estimatedReadMinutes} onChange={e => setForm({ ...form, estimatedReadMinutes: Number(e.target.value) })} />
              <Input type="number" min={0} max={1000} placeholder="Display order" value={form.displayOrder} onChange={e => setForm({ ...form, displayOrder: Number(e.target.value) })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.published} onChange={e => setForm({ ...form, published: e.target.checked })} />
                Published
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={cancelEdit} className="gap-1"><X className="w-3 h-3" /> Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving} className="gap-1"><Save className="w-3 h-3" /> {saving ? "Saving..." : "Save"}</Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Title</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Category</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Order</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Read</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Published</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No content yet — click "New" to create the first entry.</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{item.slug}</div>
                  </td>
                  <td className="px-3 py-2"><span className="px-2 py-0.5 rounded text-xs bg-muted">{item.category}</span></td>
                  <td className="px-3 py-2 font-mono text-xs">{item.displayOrder}</td>
                  <td className="px-3 py-2 text-xs">{item.estimatedReadMinutes}m</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${item.published ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                      {item.published ? "Live" : "Draft"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(item)} className="h-7 w-7 p-0"><Edit2 className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(item.id)} className="h-7 w-7 p-0 text-red-600"><Trash2 className="w-3 h-3" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
