import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Power, RefreshCw, Save, Clock } from "lucide-react";

const API_BASE = "/api";

type Flag = {
  flagName: string;
  flagValue: string;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

type SystemFlagsResponse = {
  flags: Record<string, Flag>;
  llmEnabled: boolean;
  maintenanceMessage: string;
};

type ScheduleRow = {
  agentName: string;
  intervalSeconds: number;
  enabled: boolean;
  description: string | null;
  lastRunAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
  perCycleCostUsd: number;
  estimatedMonthlyCostUsd: number;
};

type SchedulesResponse = {
  schedules: ScheduleRow[];
  totalMonthlyEstimateUsd: number;
};

// Friendly interval presets the dropdown offers; admins can also free-type
// a number in the input box if they want a non-listed value.
const INTERVAL_PRESETS: Array<{ label: string; seconds: number }> = [
  { label: "1 hour",     seconds: 3600 },
  { label: "6 hours",    seconds: 21600 },
  { label: "12 hours",   seconds: 43200 },
  { label: "Daily (24h)", seconds: 86400 },
  { label: "48 hours",   seconds: 172800 },
  { label: "7 days",     seconds: 604800 },
];

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1).replace(/\.0$/, "")}h`;
  return `${(seconds / 86400).toFixed(1).replace(/\.0$/, "")}d`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function AgentsControlPanel() {
  const [flags, setFlags] = useState<SystemFlagsResponse | null>(null);
  const [schedules, setSchedules] = useState<SchedulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [maintenanceDraft, setMaintenanceDraft] = useState<string>("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [f, s] = await Promise.all([
        fetch(`${API_BASE}/admin/system-flags`, { credentials: "include" }).then((r) => r.json()),
        fetch(`${API_BASE}/admin/agent-schedules`, { credentials: "include" }).then((r) => r.json()),
      ]);
      setFlags(f);
      setSchedules(s);
      if (f && typeof f.maintenanceMessage === "string") {
        setMaintenanceDraft(f.maintenanceMessage);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function toggleLlm(enabled: boolean) {
    if (!enabled) {
      const ok = confirm(
        "Disable ALL LLM calls?\n\n" +
        "• Every Inngest agent cron will skip\n" +
        "• Every /api/* request (except admin + health) will return 503\n" +
        "• Logged-in users will see the maintenance message\n\n" +
        "Continue?"
      );
      if (!ok) return;
    }
    setBusy("llm-toggle");
    try {
      const res = await fetch(`${API_BASE}/admin/system-flags/llm-toggle`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, message: maintenanceDraft }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      alert(`Toggle failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveMaintenanceMessage() {
    setBusy("save-message");
    try {
      const res = await fetch(`${API_BASE}/admin/system-flags/maintenance_message`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagValue: maintenanceDraft }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  async function updateSchedule(
    agentName: string,
    patch: { intervalSeconds?: number; enabled?: boolean },
  ) {
    setBusy(`sched-${agentName}`);
    try {
      const res = await fetch(`${API_BASE}/admin/agent-schedules/${agentName}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      alert(`Update failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !flags) {
    return <div className="text-muted-foreground text-sm">Loading…</div>;
  }

  const llmEnabled = flags?.llmEnabled ?? true;

  return (
    <div className="space-y-6">
      {/* ─── Master LLM kill switch ─────────────────────────────── */}
      <Card className={llmEnabled ? "" : "border-destructive bg-destructive/5"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className={`w-5 h-5 ${llmEnabled ? "text-green-600" : "text-destructive"}`} />
            LLM master switch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <div className="font-medium mb-1">
                Status: {llmEnabled ? (
                  <span className="text-green-700">ENABLED — agents and user requests run normally</span>
                ) : (
                  <span className="text-destructive">DISABLED — maintenance mode active</span>
                )}
              </div>
              <div className="text-muted-foreground text-xs leading-relaxed">
                When disabled, every Inngest agent cron skips and every /api/* request
                (except this admin route + /api/health) returns 503 with the
                maintenance message below. Effect propagates within 30 seconds.
              </div>
            </div>
            <Button
              size="lg"
              variant={llmEnabled ? "destructive" : "default"}
              onClick={() => toggleLlm(!llmEnabled)}
              disabled={busy === "llm-toggle"}
              className="rounded-none shrink-0"
            >
              {busy === "llm-toggle" ? "…" : llmEnabled ? "Disable everything" : "Re-enable"}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maint-msg" className="text-xs">Maintenance message (shown to users when disabled)</Label>
            <Textarea
              id="maint-msg"
              value={maintenanceDraft}
              onChange={(e) => setMaintenanceDraft(e.target.value)}
              rows={2}
              className="text-sm rounded-none font-mono"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={saveMaintenanceMessage}
              disabled={busy === "save-message" || maintenanceDraft === (flags?.maintenanceMessage ?? "")}
              className="rounded-none gap-2"
            >
              <Save className="w-3.5 h-3.5" />
              {busy === "save-message" ? "Saving…" : "Save message"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Per-agent schedules ────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Agent schedules
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              Est. monthly: <span className="font-mono font-medium">
                ${schedules?.totalMonthlyEstimateUsd?.toFixed(2) ?? "0.00"}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={refresh} className="rounded-none gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  <th className="py-2 pr-3">Agent</th>
                  <th className="py-2 pr-3">Interval</th>
                  <th className="py-2 pr-3">Cycles/mo</th>
                  <th className="py-2 pr-3">$/cycle</th>
                  <th className="py-2 pr-3">Est. $/mo</th>
                  <th className="py-2 pr-3">Last run</th>
                  <th className="py-2 pr-3">Enabled</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {schedules?.schedules.map((row) => (
                  <ScheduleRowEditor
                    key={row.agentName}
                    row={row}
                    busy={busy === `sched-${row.agentName}`}
                    onSave={(patch) => updateSchedule(row.agentName, patch)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {!schedules?.schedules?.length && (
            <div className="text-muted-foreground text-sm py-6 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              No schedule rows seeded yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScheduleRowEditor({
  row,
  busy,
  onSave,
}: {
  row: ScheduleRow;
  busy: boolean;
  onSave: (patch: { intervalSeconds?: number; enabled?: boolean }) => void;
}) {
  const [draft, setDraft] = useState(String(row.intervalSeconds));
  const dirty = String(row.intervalSeconds) !== draft;
  const cyclesPerMonth = (30 * 24 * 60 * 60) / Math.max(60, Number(draft) || row.intervalSeconds);
  return (
    <tr className="border-b border-border/20 hover:bg-muted/30">
      <td className="py-2 pr-3 font-mono text-xs">{row.agentName}</td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={60}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-24 h-8 rounded-none font-mono text-xs"
            disabled={busy}
          />
          <select
            value=""
            onChange={(e) => e.target.value && setDraft(e.target.value)}
            className="h-8 rounded-none text-xs border border-input bg-background"
            disabled={busy}
          >
            <option value="">preset…</option>
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.seconds} value={p.seconds}>{p.label}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">({formatInterval(Number(draft) || row.intervalSeconds)})</span>
        </div>
      </td>
      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{cyclesPerMonth.toFixed(1)}</td>
      <td className="py-2 pr-3 font-mono text-xs">${row.perCycleCostUsd.toFixed(3)}</td>
      <td className="py-2 pr-3 font-mono text-xs">
        ${(row.perCycleCostUsd * cyclesPerMonth).toFixed(2)}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{timeAgo(row.lastRunAt)}</td>
      <td className="py-2 pr-3">
        <input
          type="checkbox"
          checked={row.enabled}
          onChange={(e) => onSave({ enabled: e.target.checked })}
          disabled={busy}
        />
      </td>
      <td className="py-2 pr-3">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || busy}
          onClick={() => onSave({ intervalSeconds: Math.max(60, parseInt(draft, 10)) })}
          className="h-7 rounded-none text-xs"
        >
          {busy ? "…" : "Save"}
        </Button>
      </td>
    </tr>
  );
}
