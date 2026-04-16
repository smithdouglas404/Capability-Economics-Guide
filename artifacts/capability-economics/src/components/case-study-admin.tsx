import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Sparkles, Trash2, AlertCircle, RefreshCw } from "lucide-react";

const API_BASE = "/api";

interface CaseStudyRow {
  id: number;
  industryId: number;
  industrySlug: string;
  industryName: string;
  title: string;
  executiveSummary: string;
  generatedAt: string;
  model: string;
}

interface Industry {
  id: number;
  slug: string;
  name: string;
}

export default function CaseStudyAdmin() {
  const [studies, setStudies] = useState<CaseStudyRow[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem("admin_token") ?? "");
  const [pickIndustry, setPickIndustry] = useState<string>("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i] = await Promise.all([
        fetch(`${API_BASE}/case-studies`).then(r => r.json()),
        fetch(`${API_BASE}/industries`).then(r => r.json()),
      ]);
      setStudies(s);
      setIndustries(i);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const generate = async () => {
    if (!pickIndustry) { setError("Pick an industry first."); return; }
    setGenerating(pickIndustry);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/case-studies/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(adminToken ? { "x-admin-token": adminToken } : {}) },
        body: JSON.stringify({ industrySlug: pickIndustry }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Failed (${res.status})`);
      } else {
        fetchAll();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(null);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this case study?")) return;
    await fetch(`${API_BASE}/admin/case-studies/${id}`, {
      method: "DELETE",
      headers: adminToken ? { "x-admin-token": adminToken } : {},
    });
    fetchAll();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" /> Case Study Generator
          <span className="text-sm font-normal text-muted-foreground ml-2">({studies.length} stored)</span>
        </CardTitle>
        <Input
          type="password"
          placeholder="Admin token"
          value={adminToken}
          onChange={e => { setAdminToken(e.target.value); localStorage.setItem("admin_token", e.target.value); }}
          className="w-40 h-8 text-xs"
        />
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-500/10 text-red-700 text-sm rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        <div className="mb-6 p-4 border rounded bg-muted/30 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">Industry</label>
            <select
              className="w-full h-9 px-2 text-sm border bg-background rounded"
              value={pickIndustry}
              onChange={e => setPickIndustry(e.target.value)}
            >
              <option value="">Select an industry...</option>
              {industries.map(i => <option key={i.id} value={i.slug}>{i.name}</option>)}
            </select>
          </div>
          <Button onClick={generate} disabled={!pickIndustry || generating !== null} className="gap-2">
            {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? "Generating..." : "Generate (Perplexity + GLM 5.1)"}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Industry</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Title</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Model</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Generated</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading...</td></tr>
              ) : studies.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No case studies generated yet — pick an industry above and generate one.</td></tr>
              ) : studies.map(s => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 align-top">
                  <td className="px-3 py-2 font-medium">{s.industryName}</td>
                  <td className="px-3 py-2 max-w-md">
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{s.executiveSummary}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{s.model}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(s.generatedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <a href={`/case-study/${s.industrySlug}`} className="text-xs text-primary mr-2 hover:underline">view</a>
                    <Button size="sm" variant="ghost" onClick={() => remove(s.id)} className="h-7 w-7 p-0 text-red-600"><Trash2 className="w-3 h-3" /></Button>
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
