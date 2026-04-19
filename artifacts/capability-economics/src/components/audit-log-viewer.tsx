import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileClock, Loader2, RefreshCw } from "lucide-react";

const API_BASE = "/api";

type Entry = {
  id: number;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const ACTION_COLORS: Record<string, string> = {
  "membership.approve": "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20",
  "membership.reject": "bg-red-500/10 text-red-700 border border-red-500/20",
  "membership.comp": "bg-blue-500/10 text-blue-700 border border-blue-500/20",
  "membership.hold": "bg-amber-500/10 text-amber-700 border border-amber-500/20",
  "membership.reactivate": "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20",
  "membership.change_tier": "bg-purple-500/10 text-purple-700 border border-purple-500/20",
  "membership.refund": "bg-orange-500/10 text-orange-700 border border-orange-500/20",
  "credits.grant": "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20",
  "credits.deduct": "bg-red-500/10 text-red-700 border border-red-500/20",
  "tier.update": "bg-slate-500/10 text-slate-700 border border-slate-500/20",
  "api_key.issue": "bg-indigo-500/10 text-indigo-700 border border-indigo-500/20",
  "api_key.revoke": "bg-red-500/10 text-red-700 border border-red-500/20",
  "impersonate.start": "bg-pink-500/10 text-pink-700 border border-pink-500/20",
};

export default function AuditLogViewer() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/audit-log?limit=200`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setEntries(json.entries ?? []);
    } catch (e) {
      console.error("audit log fetch", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchLog(); }, [fetchLog]);

  const filtered = filter.trim()
    ? entries.filter(e => {
        const q = filter.toLowerCase();
        return (
          e.action.toLowerCase().includes(q) ||
          (e.actorEmail ?? "").toLowerCase().includes(q) ||
          e.actorUserId.toLowerCase().includes(q) ||
          (e.targetId ?? "").toLowerCase().includes(q) ||
          JSON.stringify(e.details ?? {}).toLowerCase().includes(q)
        );
      })
    : entries;

  return (
    <Card className="rounded-none">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileClock className="w-5 h-5" /> Admin Audit Log
            <span className="text-sm font-normal text-muted-foreground ml-2">
              Last {entries.length} actions
            </span>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={fetchLog} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
        <Input
          placeholder="Filter by action, actor, target ID, or detail text..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="rounded-none mt-2"
        />
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {loading ? "Loading..." : "No audit log entries match."}
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 sticky top-0">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-b hover:bg-muted/20 align-top">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium">{e.actorEmail ?? "—"}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">{e.actorUserId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${ACTION_COLORS[e.action] ?? "bg-muted text-muted-foreground"}`}>
                        {e.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                      {e.targetType ? `${e.targetType}#${e.targetId ?? "?"}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.details ? (
                        <pre className="text-[11px] bg-muted/40 p-1.5 font-mono whitespace-pre-wrap max-w-md overflow-hidden">
                          {JSON.stringify(e.details, null, 0)}
                        </pre>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
