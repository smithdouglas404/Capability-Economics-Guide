import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Sparkles, Trash2, AlertCircle, RefreshCw, Star, CheckCircle2, XCircle } from "lucide-react";

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
  isFeatured?: boolean;
}

interface Industry {
  id: number;
  slug: string;
  name: string;
}

interface Diagnostics {
  totalStudies: number;
  perplexityConfigured: boolean;
  openrouterConfigured: boolean;
  canGenerate: boolean;
}

export default function CaseStudyAdmin() {
  const [studies, setStudies] = useState<CaseStudyRow[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickIndustry, setPickIndustry] = useState<string>("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i, d] = await Promise.all([
        fetch(`${API_BASE}/case-studies`, { credentials: "include" }).then(r => r.json()),
        fetch(`${API_BASE}/industries`, { credentials: "include" }).then(r => r.json()),
        fetch(`${API_BASE}/case-studies/diagnostics`, { credentials: "include" }).then(r => r.json()),
      ]);
      setStudies(Array.isArray(s) ? s : []);
      setIndustries(Array.isArray(i) ? i : []);
      setDiagnostics(d as Diagnostics);
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
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industrySlug: pickIndustry }),
      });
      const raw = await res.text();
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raw); } catch { /* non-JSON */ }
      if (!res.ok) {
        const msg = typeof body.error === "string" ? body.error : raw || `Failed (${res.status})`;
        const details = typeof body.details === "string" ? ` — ${body.details}` : "";
        setError(`${res.status}: ${msg}${details}`);
      } else {
        fetchAll();
      }
    } catch (e) {
      setError(`Network error: ${(e as Error).message}`);
    } finally {
      setGenerating(null);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this case study?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/case-studies/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      fetchAll();
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
    }
  };

  const toggleFeatured = async (id: number, isFeatured: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/admin/case-studies/${id}/feature`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: !isFeatured }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchAll();
    } catch (e) {
      setError(`Feature toggle failed: ${(e as Error).message}`);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" /> Case Study Generator
          <span className="text-sm font-normal text-muted-foreground ml-2">({studies.length} stored)</span>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {/* Configuration diagnostic */}
        {diagnostics && (
          <div className={`mb-4 p-3 rounded text-sm border-l-4 ${
            diagnostics.canGenerate
              ? "bg-emerald-500/5 border-emerald-500 text-emerald-900 dark:text-emerald-200"
              : "bg-amber-500/10 border-amber-500 text-amber-900 dark:text-amber-200"
          }`}>
            <div className="font-medium mb-1">
              {diagnostics.canGenerate ? "Generator ready" : "Generator cannot run"}
            </div>
            <div className="text-xs space-y-0.5">
              <div className="flex items-center gap-1.5">
                {diagnostics.perplexityConfigured ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                <span>PERPLEXITY_API_KEY {diagnostics.perplexityConfigured ? "configured" : "not set"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {diagnostics.openrouterConfigured ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                <span>OPENROUTER_API_KEY {diagnostics.openrouterConfigured ? "configured" : "not set"}</span>
              </div>
              {!diagnostics.canGenerate && (
                <div className="mt-2 text-xs">
                  Add the missing env var(s) in Railway → Variables, redeploy, then reload this page.
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-500/10 text-red-700 text-sm rounded flex items-start gap-2 border-l-4 border-red-500">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium mb-0.5">Error</div>
              <pre className="text-xs whitespace-pre-wrap font-mono break-words">{error}</pre>
            </div>
            <button onClick={() => setError(null)} className="text-xs text-red-900 hover:underline">dismiss</button>
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
          <Button
            onClick={generate}
            disabled={!pickIndustry || generating !== null || !diagnostics?.canGenerate}
            className="gap-2"
            title={!diagnostics?.canGenerate ? "Configure PERPLEXITY_API_KEY and OPENROUTER_API_KEY first" : undefined}
          >
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
                <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground uppercase" title="Pin this case study to the homepage">Homepage</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Model</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Generated</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading...</td></tr>
              ) : studies.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No case studies generated yet — pick an industry above and generate one.</td></tr>
              ) : studies.map(s => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 align-top">
                  <td className="px-3 py-2 font-medium">{s.industryName}</td>
                  <td className="px-3 py-2 max-w-md">
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{s.executiveSummary}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleFeatured(s.id, !!s.isFeatured)}
                      className="h-7 w-7 p-0"
                      title={s.isFeatured ? "Unpin from homepage" : "Pin to homepage (replaces current featured)"}
                    >
                      <Star className={`w-4 h-4 ${s.isFeatured ? "fill-amber-500 text-amber-500" : "text-muted-foreground"}`} />
                    </Button>
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
