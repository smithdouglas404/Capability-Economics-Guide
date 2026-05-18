import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertCircle, CheckCircle2, Clock, Database, LogIn, LogOut, CalendarClock, Save, Zap, ShieldAlert, Activity, Server, AlertTriangle, Brain, Layers } from "lucide-react";
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
  lifetime: { completed: number; failed: number; capsEnriched: number; edgesEnriched: number };
  recentErrors: Array<{ capabilityId: number; name: string; error: string; updatedAt: string | null }>;
  silentFailure: null | { lastTickAt: string; enqueuedCount: number; minutesSinceTick: number; newEconomicsSinceTick: number; message: string };
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
interface ConsolidationRun {
  id: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  observationsScanned: number;
  patternsConsolidated: number;
  redundantDeleted: number;
  archivalInserted: number;
  errorMessage: string | null;
  status: "running" | "completed" | "failed";
}
interface ConsolidationResponse {
  runs: ConsolidationRun[];
  enabled: boolean;
  claudeConfigured: boolean;
}
interface CsuiteEndpointStats {
  endpoint: string;
  roleSlug: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  lastAttemptAt: string | null;
  lastStatus: string | null;
  modelsUsed: string[];
}
interface CsuiteUsageResponse {
  windowHours: number;
  perRole: CsuiteEndpointStats[];
  totals: { attempts: number; successes: number; failures: number; successRate: number };
}
interface MemoryStatsResponse {
  memory: {
    totalMemories: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    pendingMem0Writes?: number;
    mem0Connected?: boolean;
  };
}

export default function EnrichmentAdmin() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [runs, setRuns] = useState<EnrichmentRun[]>([]);
  const [running, setRunning] = useState(false);
  const [runningMissing, setRunningMissing] = useState(false);
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
  const [consolidation, setConsolidation] = useState<ConsolidationResponse | null>(null);
  const [memStats, setMemStats] = useState<MemoryStatsResponse["memory"] | null>(null);
  const [consolidating, setConsolidating] = useState(false);
  const [csuiteUsage, setCsuiteUsage] = useState<CsuiteUsageResponse | null>(null);
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  const fetchAll = useCallback(async () => {
    try {
      const [s, r, cfgRes, redisRes, alphaRes, healthRes, industriesRes, consolidationRes, memStatsRes, csuiteUsageRes] = await Promise.all([
        fetch(`${API_BASE}/enrichment/status`).then(r => r.json()),
        fetch(`${API_BASE}/enrichment/runs?limit=10`).then(r => r.json()),
        fetch(`${API_BASE}/admin/enrichment/config`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/healthz/redis`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/alpha/status`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/admin/enrichment/health`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/admin/enrichment/industries`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/agent/consolidation/runs?limit=10`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/agent/memory/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE}/usage/csuite?windowHours=24`).then(r => r.ok ? r.json() : null).catch(() => null),
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
      setConsolidation(consolidationRes ?? null);
      setMemStats(memStatsRes?.memory ?? null);
      setCsuiteUsage(csuiteUsageRes ?? null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Single unified enrichment trigger — runs both pipelines:
  //  1. Workbench data (quadrants/value-chain/companies) via the LangGraph agent
  //  2. Detail-page data (capability_economics) via synchronous alpha
  // The sync alpha processes up to 10 caps per click; click repeatedly to
  // drain the backlog. The Workbench trigger is fire-and-forget (runs in
  // the background, row shows up in Recent Runs below).
  const runEverything = async () => {
    if (!isSignedIn) { setError("Sign in to run enrichment."); return; }
    if (!confirm("Run enrichment now?\n\n• Kicks off The Console refresh (runs in background, ~10-15 min)\n• Runs next batch of 10 capability detail enrichments inline (5-15 min, this request blocks)\n\nRe-click to process the next batch of 10.")) return;
    setSyncRunning(true);
    setError(null);
    setLastResult(null);
    try {
      // Fire-and-forget the The Console refresh — we don't wait on it.
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
      setLastResult(`Enriched ${body.capabilitiesEnriched ?? 0} capabilities + ${body.edgesEnriched ?? 0} edges in ${Math.round((body.durationMs ?? 0) / 1000)}s. The Console refresh running in background.`);
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

  const runMissing = async () => {
    if (!isSignedIn) { setError("Sign in to run enrichment."); return; }
    if (!confirm("Fill missing economics for every capability without a capability_alpha row?\n\nRuns the LangGraph agent's deterministic 3-step rerun path per capability (serial — polite to Perplexity quotas). Typical backlog of 5-15 caps completes inside a couple minutes.")) return;
    setRunningMissing(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch(`${API_BASE}/enrichment/run-missing`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Run failed (${res.status})`);
      } else if (body.attempted === 0 || body.processed === undefined) {
        setLastResult(body.message || "Nothing missing — all capabilities have economics rows.");
      } else {
        setLastResult(`Processed ${body.processed}/${body.attempted} caps · ${body.failed ?? 0} failed${body.errors?.length ? ` (first: ${body.errors[0]})` : ""}.`);
      }
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunningMissing(false);
    }
  };

  const triggerConsolidation = async () => {
    if (!isSignedIn) { setError("Sign in to run consolidation."); return; }
    if (!confirm("Run memory consolidation now?\n\nGroups recent observations by industry, capability, and topic, then synthesizes validated patterns via Claude. Takes ~1-3 minutes; old observations get archived.")) return;
    setConsolidating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/agent/memory/consolidate`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Consolidate failed (${res.status})`); return; }
      const r = body.result;
      if (r) setLastResult(`Consolidated ${r.patternsConsolidated} patterns from ${r.observationsScanned} observations · archived ${r.redundantDeleted} redundant memories.`);
      else setLastResult("Consolidation skipped — already running.");
      fetchAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setConsolidating(false);
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

            {/* Silent-failure banner removed: it was misleading. The old logic
                fired on (lastRunAt + 15min + zero new rows) — but lastRunAt was
                frozen 23 days ago because the dead BullMQ tick never updated it.
                The autoEnrichTick in scheduler.ts now keeps lastRunAt fresh and
                does the work, so the banner had nothing useful to add. If the
                pipeline truly fails to produce rows, that surfaces in the
                Recent Runs table (status="failed" / "completed_with_errors")
                and in the lifetime counters above. */}

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

              {/* Worker activity — lifetime counts from Redis (survive removeOnComplete) */}
              <div className="p-3">
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Server className="w-3 h-3" /> Jobs run</div>
                {!health.queue.configured ? (
                  <div className="text-sm text-red-700">REDIS_URL not set</div>
                ) : health.queue.error ? (
                  <div className="text-sm text-red-700" title={health.queue.error}>unreachable</div>
                ) : (
                  <>
                    <div className="text-2xl font-mono">{health.lifetime.completed.toLocaleString()}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      since deploy
                      {health.lifetime.failed > 0 && <> · <span className="text-red-700">{health.lifetime.failed} failed</span></>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                      now: {health.queue.waiting} waiting · {health.queue.active} active
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
            title={!isSignedIn ? "Sign in to run enrichment" : "Runs The Console refresh in background + next 10 capability detail enrichments inline"}
            className="gap-2"
          >
            {syncRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {syncRunning ? "Running enrichment…" : "Run enrichment now"}
          </Button>
          <Button
            variant="outline"
            onClick={runMissing}
            disabled={runningMissing || !isSignedIn}
            title={!isSignedIn ? "Sign in to run enrichment" : "Find every capability without a capability_alpha row and push it through the deterministic per-cap LangGraph rerun path"}
            className="gap-2"
          >
            {runningMissing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {runningMissing ? "Filling missing…" : "Fill missing economics"}
          </Button>
          <Button variant="outline" onClick={fetchAll} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <a href="/console" className="ml-auto text-sm text-primary hover:underline self-center">View The Console →</a>
        </div>
        {alphaStatus && (
          <div className="mb-6 text-xs text-muted-foreground">
            Alpha pipeline (capability_economics): <span className="font-mono text-foreground">{alphaStatus.capabilitiesEnriched}</span> / {alphaStatus.capabilities} capabilities enriched
          </div>
        )}

        {/* Auto-refresh cadence */}
        <div className="mb-6 border rounded-none p-4 bg-muted/20">
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

        {/* Live graph state — subscribes to /api/agent/events SSE so the
            user sees the current node + per-industry progress in real time
            instead of waiting for the run record's final update. */}
        <LiveGraphState />

        {/* Memory Consolidation panel — surfaces the sleeptime job that compresses
            raw observations into validated_pattern memories via Claude, keeping Mem0
            row count flat instead of growing linearly. */}
        {consolidation && (
          <div className="mb-6 border rounded">
            <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Brain className="w-3.5 h-3.5" /> Agent Memory Consolidation
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${consolidation.enabled ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground"}`}>
                  scheduler {consolidation.enabled ? "ON" : "OFF"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${consolidation.claudeConfigured ? "bg-blue-500/10 text-blue-700" : "bg-amber-500/10 text-amber-700"}`}>
                  Claude {consolidation.claudeConfigured ? "ready" : "fallback"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={triggerConsolidation}
                  disabled={consolidating || !isSignedIn}
                  className="gap-1.5"
                  title={!isSignedIn ? "Sign in to trigger consolidation" : "Run consolidation now"}
                >
                  {consolidating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  {consolidating ? "Consolidating…" : "Consolidate now"}
                </Button>
              </div>
            </div>

            {/* Top: Mem0 quota / memory composition — shows whether the pipeline is
                actually keeping growth flat (high pattern : observation ratio = healthy). */}
            {memStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-y md:divide-y-0">
                <div className="p-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Database className="w-3 h-3" /> Total memories</div>
                  <div className="text-2xl font-mono">{memStats.totalMemories.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Mem0: {memStats.mem0Connected ? "connected" : "offline"}
                    {typeof memStats.pendingMem0Writes === "number" && memStats.pendingMem0Writes > 0 && (
                      <> · <span className="text-amber-700">{memStats.pendingMem0Writes} pending</span></>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Layers className="w-3 h-3" /> Patterns</div>
                  <div className="text-2xl font-mono">{(memStats.byType?.pattern ?? 0).toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">validated, durable</div>
                </div>
                <div className="p-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3" /> Observations</div>
                  <div className="text-2xl font-mono">{(memStats.byType?.observation ?? 0).toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">awaiting consolidation</div>
                </div>
                <div className="p-3">
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Compression ratio</div>
                  <div className="text-2xl font-mono">
                    {(() => {
                      const obs = memStats.byType?.observation ?? 0;
                      const pat = memStats.byType?.pattern ?? 0;
                      if (obs + pat === 0) return "—";
                      return `${Math.round((pat / (obs + pat)) * 100)}%`;
                    })()}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">patterns / total</div>
                </div>
              </div>
            )}

            {/* Run history — durable record of every consolidation cycle. */}
            <div className="border-t overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Started</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Status</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase" title="Observations scanned in this run">Scanned</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase" title="Validated_pattern memories synthesized">Patterns</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase" title="Source observations archived from Mem0">Archived</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase" title="Patterns inserted into Letta archival memory">→ Letta</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Duration</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidation.runs.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground text-xs">No consolidation runs yet — first cycle runs ~60s after server boot.</td></tr>
                  ) : consolidation.runs.map(r => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          r.status === "completed" ? "bg-green-500/10 text-green-700"
                          : r.status === "running" ? "bg-blue-500/10 text-blue-700"
                          : "bg-red-500/10 text-red-700"
                        }`}>{r.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{r.observationsScanned}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{r.patternsConsolidated}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{r.redundantDeleted}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{r.archivalInserted}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtDuration(r.durationMs)}</td>
                      <td className="px-3 py-2 text-xs text-red-700 max-w-[240px] truncate" title={r.errorMessage ?? ""}>
                        {r.errorMessage ? r.errorMessage.slice(0, 60) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* C-Suite Perspective Generation panel — surfaces per-CXO success/failure
            rates over the last 24h. The legacy code only logged "GLM error: requires
            more credits" to console, hiding total failure of every render. This panel
            makes silent failure impossible. */}
        {csuiteUsage && csuiteUsage.totals.attempts > 0 && (
          <div className="mb-6 border rounded">
            <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> C-Suite Perspective Generation
                <span className="font-normal normal-case tracking-normal text-[10px] text-muted-foreground/70">last {csuiteUsage.windowHours}h</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                  csuiteUsage.totals.successRate >= 0.9 ? "bg-green-500/10 text-green-700"
                  : csuiteUsage.totals.successRate >= 0.5 ? "bg-amber-500/10 text-amber-700"
                  : "bg-red-500/10 text-red-700"
                }`}>
                  {Math.round(csuiteUsage.totals.successRate * 100)}% success ({csuiteUsage.totals.successes}/{csuiteUsage.totals.attempts})
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Role</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Attempts</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Success</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase">Rate</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Last status</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Last attempt</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase">Models tried</th>
                  </tr>
                </thead>
                <tbody>
                  {csuiteUsage.perRole.map(row => {
                    const ratePct = Math.round(row.successRate * 100);
                    return (
                      <tr key={row.endpoint} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs uppercase">{row.roleSlug}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{row.attempts}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          <span className="text-green-700">{row.successes}</span>
                          {row.failures > 0 && <span className="text-red-700"> / {row.failures} fail</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            ratePct >= 90 ? "bg-green-500/10 text-green-700"
                            : ratePct >= 50 ? "bg-amber-500/10 text-amber-700"
                            : "bg-red-500/10 text-red-700"
                          }`}>{ratePct}%</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            row.lastStatus === "ok" ? "bg-green-500/10 text-green-700"
                            : row.lastStatus === "quota" ? "bg-amber-500/10 text-amber-700"
                            : "bg-red-500/10 text-red-700"
                          }`}>{row.lastStatus ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {row.lastAttemptAt ? new Date(row.lastAttemptAt).toLocaleString() : "—"}
                        </td>
                        <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground" title={row.modelsUsed.join(", ")}>
                          {row.modelsUsed.length === 1 ? row.modelsUsed[0] : `${row.modelsUsed.length} (chain)`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

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

type GraphEvent = {
  type: string;
  runId?: number;
  industryId?: number;
  industryName?: string;
  classified?: number;
  enriched?: number;
  profiled?: number;
  mapped?: number;
  stages?: number;
  memoriesRecalled?: number;
  memoriesStored?: number;
  trigger?: string;
  result?: { errors?: string[]; classified?: number; valueChainStages?: number; companiesProfiled?: number; companiesMapped?: number; alphaEnriched?: number; detailEnriched?: number };
  industries?: number;
  capabilities?: number;
  status?: string;
  timestamp?: string;
};

const NODE_ORDER = [
  { key: "load", label: "Load industries" },
  { key: "recall", label: "Recall memories" },
  { key: "industry.classify_quadrant", label: "Classify quadrants" },
  { key: "industry.map_value_chain", label: "Map value chain" },
  { key: "industry.discover_companies", label: "Discover companies" },
  { key: "industry.economics_alpha", label: "Economics — alpha" },
  { key: "industry.economics_detail", label: "Economics — detail" },
  { key: "reflect", label: "Reflect" },
  { key: "memorize", label: "Memorize + Letta" },
  { key: "finalize", label: "Finalize" },
];

function LiveGraphState() {
  const [currentRunId, setCurrentRunId] = useState<number | null>(null);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, "idle" | "running" | "done" | "failed">>({});
  const [perIndustry, setPerIndustry] = useState<Record<number, { name: string; classified: number; stages: number; profiled: number; mapped: number; alpha: number; detail: number; status: string }>>({});
  const [recentEvents, setRecentEvents] = useState<GraphEvent[]>([]);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/agent/events`);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as GraphEvent;
        if (!evt.type?.startsWith("enrichment.") && !evt.type?.startsWith("industry.")) return;

        setRecentEvents(prev => [evt, ...prev].slice(0, 20));

        if (evt.type === "enrichment.run.start" && evt.runId) {
          setCurrentRunId(evt.runId);
          setActiveNode("load");
          setNodeStatuses({});
          setPerIndustry({});
          return;
        }

        const baseType = evt.type.replace(/^enrichment\./, "").replace(/^industry\./, "industry.");
        if (baseType.endsWith(".start")) {
          const node = baseType.replace(".start", "");
          setActiveNode(node);
          setNodeStatuses(s => ({ ...s, [node]: "running" }));
        } else if (baseType.endsWith(".complete")) {
          const node = baseType.replace(".complete", "");
          setNodeStatuses(s => ({ ...s, [node]: "done" }));
        }

        if (evt.industryId && evt.industryName) {
          setPerIndustry(p => {
            const cur = p[evt.industryId!] ?? { name: evt.industryName!, classified: 0, stages: 0, profiled: 0, mapped: 0, alpha: 0, detail: 0, status: "running" };
            return {
              ...p,
              [evt.industryId!]: {
                name: evt.industryName!,
                classified: evt.classified ?? cur.classified,
                stages: evt.stages ?? cur.stages,
                profiled: evt.profiled ?? cur.profiled,
                mapped: evt.mapped ?? cur.mapped,
                alpha: evt.type === "industry.economics_alpha.complete" ? (evt.enriched ?? cur.alpha) : cur.alpha,
                detail: evt.type === "industry.economics_detail.complete" ? (evt.enriched ?? cur.detail) : cur.detail,
                status: evt.type === "industry.complete" ? (evt.result?.errors?.length ? "failed" : "done") : cur.status,
              },
            };
          });
        }

        if (evt.type === "enrichment.finalize.complete") {
          setActiveNode(null);
        }
      } catch { /* ignore malformed events */ }
    };
    es.onerror = () => { /* keep connection alive; EventSource auto-reconnects */ };
    return () => es.close();
  }, []);

  if (!currentRunId && Object.keys(nodeStatuses).length === 0) {
    return (
      <div className="border border-dashed border-border rounded-none p-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 mb-1"><Activity className="w-3.5 h-3.5" /> Live graph state</div>
        Waiting for the next enrichment run. The cron tick or the "Run scheduler" button will start one.
      </div>
    );
  }

  return (
    <div className="border border-border rounded-none p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500 animate-pulse" />
          Live graph {currentRunId !== null && <span className="text-xs font-mono text-muted-foreground">· run #{currentRunId}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {activeNode ? <>active: <span className="font-mono">{activeNode}</span></> : "idle"}
        </div>
      </div>

      {/* Node strip — left to right shows graph progression */}
      <div className="flex flex-wrap gap-1.5">
        {NODE_ORDER.map(({ key, label }) => {
          const status = nodeStatuses[key] ?? "idle";
          const cls = status === "running" ? "bg-blue-500/10 text-blue-700 border-blue-500/30 animate-pulse"
            : status === "done" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
            : status === "failed" ? "bg-red-500/10 text-red-700 border-red-500/30"
            : "bg-muted text-muted-foreground border-border";
          return (
            <span key={key} className={`text-[10px] px-2 py-1 rounded-sm border ${cls}`}>
              {label}
            </span>
          );
        })}
      </div>

      {/* Per-industry progress table — fills as events arrive */}
      {Object.keys(perIndustry).length > 0 && (
        <div className="border-t pt-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Per industry</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left py-1">Industry</th>
                <th className="text-right py-1">Quad</th>
                <th className="text-right py-1">Stages</th>
                <th className="text-right py-1">Cos</th>
                <th className="text-right py-1">Map</th>
                <th className="text-right py-1">Alpha</th>
                <th className="text-right py-1">Detail</th>
                <th className="text-right py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(perIndustry).map((r) => (
                <tr key={r.name} className="border-b border-border/30">
                  <td className="py-1">{r.name}</td>
                  <td className="text-right font-mono">{r.classified}</td>
                  <td className="text-right font-mono">{r.stages}</td>
                  <td className="text-right font-mono">{r.profiled}</td>
                  <td className="text-right font-mono">{r.mapped}</td>
                  <td className="text-right font-mono">{r.alpha}</td>
                  <td className="text-right font-mono">{r.detail}</td>
                  <td className="text-right text-[10px]">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Last 5 events tail — useful for debugging, collapsed when none */}
      {recentEvents.length > 0 && (
        <details className="border-t pt-2">
          <summary className="text-[11px] text-muted-foreground cursor-pointer">
            Recent events ({recentEvents.length})
          </summary>
          <div className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground max-h-32 overflow-y-auto">
            {recentEvents.slice(0, 10).map((evt, i) => (
              <div key={i}>
                <span className="text-foreground">{evt.type}</span>
                {evt.industryName && <span> · {evt.industryName}</span>}
                {evt.timestamp && <span className="opacity-60"> · {new Date(evt.timestamp).toLocaleTimeString()}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
