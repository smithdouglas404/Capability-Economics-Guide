import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertCircle, CheckCircle2, Clock, Database, LogIn, LogOut } from "lucide-react";
import { Show, SignInButton, useUser, useClerk } from "@clerk/react";

const API_BASE = "/api";

interface EnrichmentStatus {
  quadrants: number;
  valueChainStages: number;
  companies: number;
  companyMappings: number;
}
interface EnrichmentRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  quadrantsClassified: number;
  valueChainStagesCreated: number;
  companiesProfiled: number;
  companyMappingsCreated: number;
  durationMs: number | null;
  errors: string[] | null;
  status: string;
}

export default function EnrichmentAdmin() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [runs, setRuns] = useState<EnrichmentRun[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  const fetchAll = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        fetch(`${API_BASE}/enrichment/status`).then(r => r.json()),
        fetch(`${API_BASE}/enrichment/runs?limit=10`).then(r => r.json()),
      ]);
      setStatus(s);
      setRuns(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, running ? 5000 : 30000);
    return () => clearInterval(id);
  }, [fetchAll, running]);

  const triggerRun = async () => {
    if (!isSignedIn) { setError("Sign in to run enrichment."); return; }
    if (!confirm("Run capability enrichment? This calls Perplexity + GLM 5.1 across all industries and may take 5-15 minutes.")) return;
    setRunning(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch(`${API_BASE}/enrichment/run`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Run failed (${res.status})`);
      } else {
        setLastResult(`Completed: ${body.quadrantsClassified ?? 0} quadrants, ${body.valueChainStagesCreated ?? 0} stages, ${body.companiesProfiled ?? 0} companies, ${body.companyMappingsCreated ?? 0} mappings.`);
      }
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const fmtDuration = (ms: number | null) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" /> Capability Enrichment Agent
        </CardTitle>
        <Show when="signed-in">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-700">
              Signed in as <b>{user?.fullName || user?.primaryEmailAddress?.emailAddress || user?.username || user?.id}</b>
            </span>
            <Button variant="ghost" size="sm" onClick={() => signOut()} className="gap-1.5"><LogOut className="w-3.5 h-3.5" /> Sign out</Button>
          </div>
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button size="sm" className="gap-2"><LogIn className="w-3.5 h-3.5" /> Sign in to run</Button>
          </SignInButton>
        </Show>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Triggers the autonomous LangGraph agent to classify capabilities (Hot/Emerging/Cooling/Table-Stakes), map value chain stages with patent/startup/capital metrics, and discover companies — all from real Perplexity research synthesized by GLM 5.1.
        </p>

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-500/10 text-red-700 text-sm rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
        {lastResult && (
          <div className="mb-3 px-3 py-2 bg-green-500/10 text-green-700 text-sm rounded flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> {lastResult}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="border rounded p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Database className="w-3 h-3" /> Quadrants</div>
            <div className="text-2xl font-mono">{status?.quadrants ?? "—"}</div>
          </div>
          <div className="border rounded p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground">Value Chain Stages</div>
            <div className="text-2xl font-mono">{status?.valueChainStages ?? "—"}</div>
          </div>
          <div className="border rounded p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground">Companies</div>
            <div className="text-2xl font-mono">{status?.companies ?? "—"}</div>
          </div>
          <div className="border rounded p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground">Mappings</div>
            <div className="text-2xl font-mono">{status?.companyMappings ?? "—"}</div>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <Button onClick={triggerRun} disabled={running || !isSignedIn} title={!isSignedIn ? "Sign in to run enrichment" : undefined} className="gap-2">
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {running ? "Running enrichment..." : "Enrich Now"}
          </Button>
          <Button variant="outline" onClick={fetchAll} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <a href="/workbench" className="ml-auto text-sm text-primary hover:underline self-center">View Workbench →</a>
        </div>

        <div>
          <div className="text-sm font-medium mb-2 flex items-center gap-2"><Clock className="w-4 h-4" /> Recent runs</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Started</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Quad</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Stages</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Companies</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Mappings</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Duration</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">No runs yet.</td></tr>
                ) : runs.map(r => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-2 py-2 text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="px-2 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        r.status === "completed" ? "bg-green-500/10 text-green-600"
                        : r.status === "running" ? "bg-blue-500/10 text-blue-600"
                        : r.status === "failed" ? "bg-red-500/10 text-red-600"
                        : "bg-amber-500/10 text-amber-600"
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">{r.quadrantsClassified}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs">{r.valueChainStagesCreated}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs">{r.companiesProfiled}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs">{r.companyMappingsCreated}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs">{fmtDuration(r.durationMs)}</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground max-w-[200px] truncate">
                      {r.errors && r.errors.length > 0 ? `${r.errors.length} error(s)` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
