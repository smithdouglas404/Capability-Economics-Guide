import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertCircle, CheckCircle2, Clock, Database, LogIn, LogOut, CalendarClock, Save, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
interface EnrichmentConfig {
  enabled: boolean;
  refreshDays: number;
  lastRunAt: string | null;
  lastRunEnqueued: number;
}
interface RedisHealth {
  configured: boolean;
  connected: boolean;
  error?: string;
}

export default function EnrichmentAdmin() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [runs, setRuns] = useState<EnrichmentRun[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [config, setConfig] = useState<EnrichmentConfig | null>(null);
  const [configEnabled, setConfigEnabled] = useState(false);
  const [configDays, setConfigDays] = useState(30);
  const [configSaving, setConfigSaving] = useState(false);
  const [redis, setRedis] = useState<RedisHealth | null>(null);
  const [syncRunning, setSyncRunning] = useState(false);
  const [alphaStatus, setAlphaStatus] = useState<{ capabilities: number; capabilitiesEnriched: number } | null>(null);
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  const fetchAll = useCallback(async () => {
    try {
      const [s, r, cfgRes, redisRes, alphaRes] = await Promise.all([
        fetch(`${API_BASE}/enrichment/status`).then(r => r.json()),
        fetch(`${API_BASE}/enrichment/runs?limit=10`).then(r => r.json()),
        fetch(`${API_BASE}/admin/enrichment/config`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/healthz/redis`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/alpha/status`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setStatus(s);
      setRuns(Array.isArray(r) ? r : []);
      if (cfgRes?.config) {
        setConfig(cfgRes.config);
        setConfigEnabled(cfgRes.config.enabled);
        setConfigDays(cfgRes.config.refreshDays);
      }
      setRedis(redisRes ?? null);
      if (alphaRes) setAlphaStatus({ capabilities: alphaRes.capabilities, capabilitiesEnriched: alphaRes.capabilitiesEnriched });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const runSync = async () => {
    if (!isSignedIn) { setError("Sign in to run enrichment."); return; }
    if (!confirm("Run alpha enrichment synchronously (bypasses the queue)?\n\nThis blocks for 5–15 minutes while Perplexity + GLM process a batch of up to 10 capabilities. Safe to re-run repeatedly to drain all 58.")) return;
    setSyncRunning(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch(`${API_BASE}/alpha/enrich-sync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitCapabilities: 10, limitEdges: 10 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Sync run failed (${res.status})`); return; }
      setLastResult(`Sync enrichment: ${body.capabilitiesEnriched ?? 0} capabilities, ${body.edgesEnriched ?? 0} edges in ${Math.round((body.durationMs ?? 0) / 1000)}s`);
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncRunning(false);
    }
  };

  const saveConfig = async () => {
    if (!isSignedIn) { setError("Sign in to change the schedule."); return; }
    setConfigSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/enrichment/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: configEnabled, refreshDays: configDays }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Save failed (${res.status})`); return; }
      if (body.config) {
        setConfig(body.config);
        setConfigEnabled(body.config.enabled);
        setConfigDays(body.config.refreshDays);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setConfigSaving(false);
    }
  };

  // Poll fast (5s) whenever a run is in flight — either the user just clicked
  // Enrich Now in this tab, OR any recent run has status="running" (catches
  // the case where the user leaves and comes back while a run continues
  // server-side). Otherwise poll at the idle 30s cadence.
  const anyRunActive = runs.some(r => r.status === "running");
  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, (running || anyRunActive) ? 5000 : 30000);
    return () => clearInterval(id);
  }, [fetchAll, running, anyRunActive]);

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

        <div className="flex gap-2 mb-3 flex-wrap">
          <Button onClick={triggerRun} disabled={running || !isSignedIn} title={!isSignedIn ? "Sign in to run enrichment" : undefined} className="gap-2">
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {running ? "Running enrichment..." : "Enrich Now (queued)"}
          </Button>
          <Button onClick={runSync} disabled={syncRunning || !isSignedIn} variant="secondary" title="Bypasses BullMQ — runs alpha enrichment inline in the HTTP request. Blocks 5–15 min per batch." className="gap-2">
            {syncRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {syncRunning ? "Running sync…" : "Run NOW (sync, bypass queue)"}
          </Button>
          <Button variant="outline" onClick={fetchAll} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <a href="/workbench" className="ml-auto text-sm text-primary hover:underline self-center">View Workbench →</a>
        </div>
        {alphaStatus && (
          <div className="mb-6 text-xs text-muted-foreground">
            Alpha pipeline (capability_economics): <span className="font-mono text-foreground">{alphaStatus.capabilitiesEnriched}</span> / {alphaStatus.capabilities} capabilities enriched
          </div>
        )}

        {/* Auto-refresh cadence */}
        <div className="mb-6 border rounded-md p-4 bg-muted/20">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="text-sm font-medium flex items-center gap-2"><CalendarClock className="w-4 h-4" /> Scheduled auto-refresh</div>
              <div className="text-xs text-muted-foreground mt-1">
                When enabled, capabilities whose economics are older than the refresh window get re-enqueued for enrichment automatically (checked hourly).
              </div>
            </div>
            {redis && (
              <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                redis.connected ? "bg-green-500/10 text-green-700" :
                redis.configured ? "bg-amber-500/10 text-amber-700" :
                "bg-red-500/10 text-red-700"
              }`}>
                Redis: {redis.connected ? "connected" : redis.configured ? "configured, not reachable" : "not configured"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="flex items-center gap-3">
              <Switch checked={configEnabled} onCheckedChange={setConfigEnabled} id="cadence-enabled" disabled={!isSignedIn} />
              <Label htmlFor="cadence-enabled" className="cursor-pointer">Auto-refresh enabled</Label>
            </div>
            <div>
              <Label htmlFor="cadence-days" className="text-xs">Refresh every (days)</Label>
              <Input id="cadence-days" type="number" min={1} max={365} value={configDays} onChange={e => setConfigDays(Number(e.target.value) || 30)} disabled={!isSignedIn} />
            </div>
            <Button onClick={saveConfig} disabled={!isSignedIn || configSaving} className="gap-2">
              {configSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </Button>
          </div>
          {config?.lastRunAt && (
            <div className="text-xs text-muted-foreground mt-3">
              Last tick: {new Date(config.lastRunAt).toLocaleString()} · enqueued {config.lastRunEnqueued} capabilit{config.lastRunEnqueued === 1 ? "y" : "ies"}
            </div>
          )}
          {configEnabled && redis && !redis.connected && (
            <div className="text-xs text-amber-700 mt-2">
              Cadence is enabled but Redis isn't reachable — ticks will be skipped until Redis comes online.
            </div>
          )}
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
