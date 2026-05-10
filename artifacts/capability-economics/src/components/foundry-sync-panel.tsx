import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Clock, RefreshCw, Database, KeyRound } from "lucide-react";

const API_BASE = "/api";

type SyncRow = {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: "ok" | "http_401" | "http_5xx" | "network" | "other";
  httpStatus: number | null;
  durationMs: number | null;
  rowsByDataset: Record<string, number> | null;
  errorMessage: string | null;
  reason: string | null;
};

type Health = {
  envConfigured: boolean;
  tokenConfigured: boolean;
  latest: SyncRow | null;
  lastSuccessAt: string | null;
  alert: {
    active: boolean;
    consecutive401: number;
    firstFailureAt: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
  };
};

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_BADGE: Record<SyncRow["status"], { label: string; className: string; Icon: React.ElementType }> = {
  ok:       { label: "OK",       className: "bg-green-500/10 text-green-600 border border-green-500/20", Icon: CheckCircle },
  http_401: { label: "401",      className: "bg-red-500/10 text-red-600 border border-red-500/20",       Icon: KeyRound },
  http_5xx: { label: "5xx",      className: "bg-amber-500/10 text-amber-600 border border-amber-500/20", Icon: AlertCircle },
  network:  { label: "Network",  className: "bg-amber-500/10 text-amber-600 border border-amber-500/20", Icon: AlertCircle },
  other:    { label: "Error",    className: "bg-muted text-muted-foreground border border-border",       Icon: AlertCircle },
};

function StatusBadge({ status }: { status: SyncRow["status"] }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.other;
  const Icon = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${s.className}`}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  );
}

export default function FoundrySyncPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [runs, setRuns] = useState<SyncRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [recheckResult, setRecheckResult] = useState<{ ok: boolean; status: string; httpStatus: number | null; error?: string } | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const [h, l] = await Promise.all([
        fetch(`${API_BASE}/admin/foundry/health`, { credentials: "include" }).then(r => r.json()),
        fetch(`${API_BASE}/admin/foundry/sync-log?limit=10`, { credentials: "include" }).then(r => r.json()),
      ]);
      setHealth(h);
      setRuns(l.runs ?? []);
    } catch (e) {
      console.error("[foundry-panel] fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // Surface the alert in the browser console too — task spec calls for
  // "banner + console warn + audit log entry".
  useEffect(() => {
    if (health?.alert.active) {
      console.warn(
        `[foundry-sync] token rotation needed — ${health.alert.consecutive401} consecutive 401s. Rotate FOUNDRY_TOKEN (or PALANTIR_TOKEN) then click "I rotated the token".`,
        { firstFailureAt: health.alert.firstFailureAt, lastError: health.alert.lastError },
      );
    }
  }, [health?.alert.active, health?.alert.consecutive401, health?.alert.firstFailureAt, health?.alert.lastError]);

  const recheck = async () => {
    setRechecking(true);
    setRecheckResult(null);
    try {
      const res = await fetch(`${API_BASE}/admin/foundry/recheck`, { method: "POST", credentials: "include" });
      const body = await res.json();
      setRecheckResult(body.result);
      await refetch();
    } catch (e) {
      setRecheckResult({ ok: false, status: "other", httpStatus: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRechecking(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Database className="w-5 h-5" /> Foundry Sync Health
          <span className="text-sm font-normal text-muted-foreground ml-2">
            Hourly Postgres → Foundry Datasets mirror
          </span>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={refetch} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Token rotation alert banner — only when ≥2 consecutive 401s */}
        {health?.alert.active && (
          <div className="border border-red-500/40 bg-red-500/5 p-4 rounded-none">
            <div className="flex items-start gap-3">
              <KeyRound className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-600">
                  Foundry rejected the token {health.alert.consecutive401}× in a row.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Rotate <code className="px-1 py-0.5 bg-muted rounded text-xs">FOUNDRY_TOKEN</code>
                  {" "}(or <code className="px-1 py-0.5 bg-muted rounded text-xs">PALANTIR_TOKEN</code>)
                  in Replit Secrets, then click below. Until then, Foundry mirrors are stale —
                  Postgres remains the source of truth.
                </p>
                {health.alert.lastError && (
                  <p className="text-xs text-muted-foreground mt-2 font-mono break-all">
                    {health.alert.lastError.slice(0, 240)}
                  </p>
                )}
                <div className="mt-3">
                  <Button size="sm" onClick={recheck} disabled={rechecking} className="gap-1.5">
                    {rechecking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                    {rechecking ? "Re-checking..." : "I rotated the token — recheck now"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Env not configured prompt */}
        {!loading && health && !health.envConfigured && (
          <div className="border border-border bg-muted/30 p-3 text-sm text-muted-foreground rounded-none">
            Foundry env vars not set — sync is no-op. Set
            {" "}<code className="px-1 py-0.5 bg-muted rounded text-xs">FOUNDRY_BASE_URL</code> +
            {" "}<code className="px-1 py-0.5 bg-muted rounded text-xs">FOUNDRY_TOKEN</code>
            {" "}(or the <code className="px-1 py-0.5 bg-muted rounded text-xs">PALANTIR_*</code> equivalents) to enable mirroring.
          </div>
        )}

        {/* Recheck inline result */}
        {recheckResult && (
          <div className={`border p-3 text-sm rounded-none ${recheckResult.ok ? "border-green-500/40 bg-green-500/5 text-green-700" : "border-amber-500/40 bg-amber-500/5 text-amber-700"}`}>
            {recheckResult.ok
              ? "Sync succeeded — alert cleared."
              : `Recheck failed (${recheckResult.status}${recheckResult.httpStatus ? ` ${recheckResult.httpStatus}` : ""}). ${recheckResult.error ?? ""}`}
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-none bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">Last status</p>
            <div>{health?.latest ? <StatusBadge status={health.latest.status} /> : <span className="text-xs text-muted-foreground">No runs yet</span>}</div>
          </div>
          <div className="p-3 rounded-none bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">Last sync</p>
            <p className="text-sm font-mono">{timeAgo(health?.latest?.completedAt ?? null)}</p>
          </div>
          <div className="p-3 rounded-none bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">Last successful</p>
            <p className="text-sm font-mono">{timeAgo(health?.lastSuccessAt ?? null)}</p>
          </div>
          <div className="p-3 rounded-none bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">Token configured</p>
            <p className="text-sm">{health?.tokenConfigured ? <span className="text-green-600">Yes</span> : <span className="text-amber-600">No</span>}</p>
          </div>
        </div>

        {/* Run history */}
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Last 10 runs
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Started</th>
                  <th className="py-1.5 text-left font-medium">Status</th>
                  <th className="py-1.5 text-left font-medium">Reason</th>
                  <th className="py-1.5 text-right font-medium">Rows</th>
                  <th className="py-1.5 text-right font-medium">Duration</th>
                  <th className="py-1.5 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Loading...</td></tr>
                ) : !runs?.length ? (
                  <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No syncs recorded yet — first run will appear after the next hourly tick.</td></tr>
                ) : runs.map(r => {
                  const totalRows = r.rowsByDataset ? Object.values(r.rowsByDataset).reduce((a, b) => a + (b || 0), 0) : 0;
                  return (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-1.5 text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</td>
                      <td className="py-1.5"><StatusBadge status={r.status} /></td>
                      <td className="py-1.5 text-muted-foreground">{r.reason ?? "—"}</td>
                      <td className="py-1.5 text-right font-mono">{totalRows || "—"}</td>
                      <td className="py-1.5 text-right font-mono">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                      <td className="py-1.5 text-muted-foreground max-w-[280px] truncate" title={r.errorMessage ?? ""}>
                        {r.errorMessage ? r.errorMessage.slice(0, 80) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
