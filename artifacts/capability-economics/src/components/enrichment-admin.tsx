import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertCircle, CheckCircle2, Clock, Database, LogIn, LogOut, CalendarClock, Save, Zap, ShieldAlert, Activity, Server, AlertTriangle } from "lucide-react";
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
interface EnrichmentHealth {
  schema: { ok: boolean | null; missing: string[]; note?: string };
  capabilities: { total: number; withEconomics: number; withoutEconomics: number };
  decompositionParity: { totalTopLevel: number; decomposed: number; missing: number };
  autoEnrich: { config: { enabled: boolean; refreshDays: number; lastRunAt: string | null; lastRunEnqueued: number } | null; configError: string | null };
  queue: { configured: boolean; waiting: number; active: number; delayed: number; failed: number; completed: number; error: string | null };
  recentErrors: Array<{ capabilityId: number; name: string; error: string; updatedAt: string | null }>;
  generatedAt: string;
}
interface IndustryRow {
  industryId: number;
  industrySlug: string;
  industryName: string;
  enabled: boolean;
  refreshDays: number;
  hasOverride: boolean;
  capabilities: { total: number; withEconomics: number };
}
interface IndustriesResponse {
  globalDefault: { enabled: boolean; refreshDays: number };
  industries: IndustryRow[];
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
  const [health, setHealth] = useState<EnrichmentHealth | null>(null);
  const [industries, setIndustries] = useState<IndustriesResponse | null>(null);
  const [savingIndustryId, setSavingIndustryId] = useState<number | null>(null);
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  const fetchAll = useCallback(async () => {
    try {
      const [s, r, cfgRes, redisRes, alphaRes, healthRes, industriesRes] = await Promise.all([
        fetch(`${API_BASE}/enrichment/status`).then(r => r.json()),
        fetch(`${API_BASE}/enrichment/runs?limit=10`).then(r => r.json()),
        fetch(`${API_BASE}/admin/enrichment/config`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/healthz/redis`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/alpha/status`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/admin/enrichment/health`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/admin/enrichment/industries`).then(r => r.ok ? r.json() : null).catch(() => null),
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
      setHealth(healthRes ?? null);
      setIndustries(industriesRes ?? null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Single unified enrichment trigger — runs both pipelines:
  //  1. Workbench data (quadrants/value-chain/companies) via legacy queued trigger
  //  2. Detail-page data (capability_economics) via synchronous alpha
  // The sync alpha processes up to 10 caps per click; click repeatedly to
  // drain the backlog. The Workbench trigger is fire-and-forget (runs in
  // the background, row shows up in Recent Runs below).
  const runEverything = async () => {
    if (!isSignedIn) { setError("Sign in to run enrichment."); return; }
    if (!confirm("Run enrichment now?\n\n• Kicks off Workbench refresh (runs in background, ~10-15 min)\n• Runs next batch of 10 capability detail enrichments inline (5-15 min, this request blocks)\n\nRe-click to process the next batch of 10.")) return;
    setSyncRunning(true);
    setError(null);
    setLastResult(null);
    try {
      // Fire-and-forget the Workbench refresh — we don't wait on it.
      fetch(`${API_BASE}/enrichment/run`, { method: "POST", credentials: "include" }).catch(() => { /* surfaced in Recent Runs */ });
      // Await the sync alpha batch so the user sees real counts return.
      const res = await fetch(`${API_BASE}/alpha/enrich-sync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitCapabilities: 10, limitEdges: 10 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Run failed (${res.status})`); return; }
      setLastResult(`Enriched ${body.capabilitiesEnriched ?? 0} capabilities + ${body.edgesEnriched ?? 0} edges in ${Math.round((body.durationMs ?? 0) / 1000)}s. Workbench refresh running in background.`);
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncRunning(false);
    }
  };

  const saveIndustry = async (industryId: number, body: { enabled?: boolean; refreshDays?: number }) => {
    if (!isSignedIn) { setError("Sign in to change industry settings."); return; }
    setSavingIndustryId(industryId);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/enrichment/industries/${industryId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Save failed (${res.status})`);
        return;
      }
      // Optimistic local update so the toggle/input reflects immediately —
      // fetchAll re-syncs from the server on the next poll.
      setIndustries(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          industries: prev.industries.map(i =>
            i.industryId === industryId
              ? { ...i, enabled: body.enabled ?? i.enabled, refreshDays: body.refreshDays ?? i.refreshDays, hasOverride: true }
              : i,
          ),
        };
      });
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingIndustryId(null);
    }
  };

  const resetIndustry = async (industryId: number) => {
    if (!isSignedIn) { setError("Sign in to reset industry settings."); return; }
    setSavingIndustryId(industryId);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/enrichment/industries/${industryId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Reset failed (${res.status})`);
        return;
      }
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingIndustryId(null);
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

        {/* Health panel — answers "is enrichment actually working?" at a glance */}
        {health && (
          <div className="mb-5 border rounded">
            <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" /> Enrichment Health
              </div>
              <div className="text-[10px] text-muted-foreground">checked {new Date(health.generatedAt).toLocaleTimeString()}</div>
            </div>

            {/* Schema banner — only shows when something is wrong */}
            {health.schema.ok === false && (
              <div className="mx-3 mt-3 px-3 py-2 bg-red-500/10 text-red-700 text-sm rounded flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">Schema out of sync — features will silently degrade.</div>
                  <div className="text-xs mt-1">
                    Missing tables: <code className="font-mono">{health.schema.missing.join(", ")}</code>
                  </div>
                  <div className="text-xs mt-1">
                    Run <code className="font-mono bg-red-500/10 px-1">cd lib/db &amp;&amp; npx drizzle-kit push --force</code>, then restart the API server.
                  </div>
                </div>
              </div>
            )}
            {health.schema.ok === null && (
              <div className="mx-3 mt-3 px-3 py-2 bg-amber-500/10 text-amber-800 text-xs rounded flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" /> Boot schema check has not run yet — restart the API server to populate it.
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-0 divide-x divide-y md:divide-y-0">
              {/* Real pending count — capability_economics row presence is truth */}
              <div className="p-3">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Database className="w-3 h-3" /> Capabilities enriched</div>
                <div className="text-2xl font-mono">
                  {health.capabilities.withEconomics}
                  <span className="text-sm text-muted-foreground font-mono ml-1">/ {health.capabilities.total}</span>
                </div>
                {health.capabilities.withoutEconomics > 0 && (
                  <div className="text-[11px] text-amber-700 mt-0.5">{health.capabilities.withoutEconomics} need enrichment</div>
                )}
              </div>

              {/* Auto-enrich state */}
              <div className="p-3">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Auto-enrich</div>
                {health.autoEnrich.configError ? (
                  <div className="text-sm text-red-700">config error</div>
                ) : !health.autoEnrich.config ? (
                  <div className="text-sm text-muted-foreground">not initialised</div>
                ) : (
                  <>
                    <div className={`text-lg font-mono ${health.autoEnrich.config.enabled ? "text-green-700" : "text-muted-foreground"}`}>
                      {health.autoEnrich.config.enabled ? "Enabled" : "Disabled"}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      last tick: {health.autoEnrich.config.lastRunAt ? new Date(health.autoEnrich.config.lastRunAt).toLocaleString() : "never"}
                    </div>
                  </>
                )}
              </div>

              {/* Redis queue depth */}
              <div className="p-3">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Server className="w-3 h-3" /> Queue</div>
                {!health.queue.configured ? (
                  <div className="text-sm text-red-700">REDIS_URL not set</div>
                ) : health.queue.error ? (
                  <div className="text-sm text-red-700" title={health.queue.error}>unreachable</div>
                ) : (
                  <>
                    <div className="text-2xl font-mono">{health.queue.waiting + health.queue.active}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {health.queue.waiting} waiting · {health.queue.active} active · {health.queue.failed} failed
                    </div>
                  </>
                )}
              </div>

              {/* Sub-capability parity — top-level caps with vs without children */}
              <div className="p-3">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Database className="w-3 h-3" /> Decomposition</div>
                <div className="text-2xl font-mono">
                  {health.decompositionParity.decomposed}
                  <span className="text-sm text-muted-foreground font-mono ml-1">/ {health.decompositionParity.totalTopLevel}</span>
                </div>
                {health.decompositionParity.missing > 0 ? (
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    {health.decompositionParity.missing} parents missing — runs on next boot
                  </div>
                ) : (
                  <div className="text-[11px] text-green-700 mt-0.5">all decomposed</div>
                )}
              </div>

              {/* Recent errors */}
              <div className="p-3">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Recent errors</div>
                <div className="text-2xl font-mono">{health.recentErrors.length}</div>
                {health.recentErrors[0] && (
                  <div className="text-[11px] text-red-700 mt-0.5 truncate" title={health.recentErrors[0].error}>
                    {health.recentErrors[0].name}: {health.recentErrors[0].error.slice(0, 40)}{health.recentErrors[0].error.length > 40 ? "…" : ""}
                  </div>
                )}
              </div>
            </div>

            {/* Recent error detail rows — only if there are any */}
            {health.recentErrors.length > 0 && (
              <details className="border-t">
                <summary className="px-4 py-2 text-xs text-muted-foreground cursor-pointer select-none hover:bg-muted/40">
                  Show last {health.recentErrors.length} error{health.recentErrors.length === 1 ? "" : "s"}
                </summary>
                <ul className="divide-y">
                  {health.recentErrors.map((e) => (
                    <li key={e.capabilityId} className="px-4 py-2 text-xs grid grid-cols-[1fr_auto] gap-3">
                      <div>
                        <div className="font-medium">{e.name}</div>
                        <div className="text-red-700 font-mono break-all">{e.error}</div>
                      </div>
                      <div className="text-muted-foreground whitespace-nowrap">
                        {e.updatedAt ? new Date(e.updatedAt).toLocaleString() : "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Master switch + per-industry cadence */}
        {industries && (
          <div className="mb-5 border rounded">
            <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between flex-wrap gap-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <CalendarClock className="w-3.5 h-3.5" /> Cron schedule
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="cron-master" className="text-xs">Run scheduler</Label>
                <Switch
                  id="cron-master"
                  checked={configEnabled}
                  onCheckedChange={(v) => setConfigEnabled(v)}
                  disabled={!isSignedIn}
                />
                <span className={`text-[11px] font-mono ${configEnabled ? "text-green-700" : "text-muted-foreground"}`}>
                  {configEnabled ? "ON" : "OFF"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveConfig}
                  disabled={configSaving || !isSignedIn || (config?.enabled === configEnabled && config?.refreshDays === configDays)}
                  className="gap-1.5 ml-2"
                >
                  <Save className="w-3 h-3" />
                  Save master
                </Button>
              </div>
            </div>

            <div className="px-4 py-2 border-b text-[11px] text-muted-foreground bg-muted/10">
              Master switch overrides every industry. When ON, each industry runs at its own cadence below — default is the global value
              (<code className="font-mono">{industries.globalDefault.refreshDays}</code> days). Toggle an industry off to pause it without
              affecting others. Reset clears the override and falls back to the global default.
            </div>

            <table className="w-full text-sm">
              <thead className="bg-muted/20">
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Industry</th>
                  <th className="text-left px-4 py-2 font-medium">Coverage</th>
                  <th className="text-left px-4 py-2 font-medium">Enabled</th>
                  <th className="text-left px-4 py-2 font-medium">Refresh (days)</th>
                  <th className="text-left px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {industries.industries.map(ind => (
                  <IndustryRow
                    key={ind.industryId}
                    row={ind}
                    saving={savingIndustryId === ind.industryId}
                    onSave={saveIndustry}
                    onReset={resetIndustry}
                    disabled={!isSignedIn}
                  />
                ))}
              </tbody>
            </table>
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
          <Button
            onClick={runEverything}
            disabled={syncRunning || !isSignedIn}
            title={!isSignedIn ? "Sign in to run enrichment" : "Runs Workbench refresh in background + next 10 capability detail enrichments inline"}
            className="gap-2"
          >
            {syncRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {syncRunning ? "Running enrichment…" : "Run enrichment now"}
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

function IndustryRow({
  row, saving, onSave, onReset, disabled,
}: {
  row: IndustryRow;
  saving: boolean;
  onSave: (industryId: number, body: { enabled?: boolean; refreshDays?: number }) => void;
  onReset: (industryId: number) => void;
  disabled: boolean;
}) {
  const [draftDays, setDraftDays] = useState<number>(row.refreshDays);
  // Sync local draft when the parent gets fresh data (e.g., after polling)
  useEffect(() => { setDraftDays(row.refreshDays); }, [row.refreshDays]);

  const dirty = draftDays !== row.refreshDays;
  const coverage = row.capabilities.total > 0
    ? Math.round((row.capabilities.withEconomics / row.capabilities.total) * 100)
    : 0;

  return (
    <tr className={!row.enabled ? "opacity-60" : ""}>
      <td className="px-4 py-2.5">
        <div className="font-medium">{row.industryName}</div>
        <div className="text-[10px] text-muted-foreground font-mono">{row.industrySlug}</div>
      </td>
      <td className="px-4 py-2.5">
        <div className="font-mono text-xs">
          {row.capabilities.withEconomics}/{row.capabilities.total}
        </div>
        <div className="text-[10px] text-muted-foreground">{coverage}% enriched</div>
      </td>
      <td className="px-4 py-2.5">
        <Switch
          checked={row.enabled}
          onCheckedChange={(v) => onSave(row.industryId, { enabled: v })}
          disabled={disabled || saving}
        />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={365}
            value={draftDays}
            onChange={(e) => setDraftDays(Number(e.target.value))}
            className="h-7 w-20 text-xs"
            disabled={disabled || saving}
          />
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSave(row.industryId, { refreshDays: draftDays })}
              disabled={disabled || saving || draftDays < 1 || draftDays > 365}
              className="h-7 px-2"
            >
              <Save className="w-3 h-3" />
            </Button>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
        {row.hasOverride ? "override" : "global default"}
      </td>
      <td className="px-4 py-2.5 text-right">
        {row.hasOverride && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onReset(row.industryId)}
            disabled={disabled || saving}
            className="text-[11px] h-7 px-2"
          >
            Reset
          </Button>
        )}
      </td>
    </tr>
  );
}
