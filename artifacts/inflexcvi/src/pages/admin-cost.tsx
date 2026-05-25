import { useEffect, useState } from "react";
import { RefreshCw, Save, Loader2, HelpCircle, DollarSign, Database, TrendingDown, Cpu } from "lucide-react";
import { AdminPageShell } from "@/components/admin-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ADMIN_KEY_STORAGE = "ce.admin-key";

function adminHeaders(): Record<string, string> {
  try {
    const k = localStorage.getItem(ADMIN_KEY_STORAGE);
    return k ? { "X-Admin-Key": k, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

interface CacheStats {
  perplexityCache: {
    rows: number;
    active: number;
    expired: number;
    totalHits: number;
    totalSavedUsd: number;
    byModel: Array<{ model: string; rows: number; hits: number; estimatedSavedUsd: number }>;
    hotQueries: Array<{ key: string; model: string; hits: number; createdAt: string; expiresAt: string; lastHitAt: string | null }>;
  };
  llmUsage: {
    last24h: { totals: { calls: number; costUsd: number; errors: number; quota: number }; monthEstimateUsd: number };
    last7d:  { totals: { calls: number; costUsd: number; errors: number; quota: number }; monthEstimateUsd: number };
  };
  assumptions: { avgInputTokensPerQuery: number; avgOutputTokensPerQuery: number; note: string };
}

interface OpenRouterBalance {
  label: string | null;
  usageUsd: number | null;
  limitUsd: number | null;
  remainingUsd: number | null;
  isFreeTier: boolean | null;
}

interface TtlFlag {
  name: string;
  endpointKey: string;
  hours: number;
  description: string;
  updatedAt: string;
  updatedBy: string | null;
}

function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(digits)}`;
}

function fmtHoursLabel(h: number): string {
  if (h < 24) return `${h}h`;
  const days = Math.round((h / 24) * 10) / 10;
  if (days < 30) return `${days}d`;
  const months = Math.round((days / 30) * 10) / 10;
  return `~${months}mo`;
}

export default function AdminCostPage() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [balance, setBalance] = useState<OpenRouterBalance | null>(null);
  const [balanceErr, setBalanceErr] = useState<string | null>(null);
  const [ttls, setTtls] = useState<TtlFlag[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { hours: string; description: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, b, t] = await Promise.all([
        fetch("/api/admin/cache-stats", { headers: adminHeaders() }).then((r) => r.json()),
        fetch("/api/admin/openrouter-balance", { headers: adminHeaders() }).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        fetch("/api/admin/cache-ttl", { headers: adminHeaders() }).then((r) => r.json()),
      ]);
      setStats(s);
      if (b.ok) { setBalance(b.body); setBalanceErr(null); } else { setBalance(null); setBalanceErr(b.body?.error ?? "unknown"); }
      setTtls(t.flags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function draftFor(flag: TtlFlag): { hours: string; description: string } {
    return drafts[flag.name] ?? { hours: String(flag.hours), description: flag.description };
  }

  async function saveTtl(flag: TtlFlag) {
    const d = draftFor(flag);
    const hours = parseInt(d.hours, 10);
    if (!Number.isFinite(hours) || hours < 1 || hours > 8760) {
      setError(`Hours must be 1..8760 for ${flag.endpointKey}`);
      return;
    }
    setSavingKey(flag.name);
    setError(null);
    try {
      const r = await fetch("/api/admin/cache-ttl", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ endpointKey: flag.endpointKey, hours, description: d.description }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      setDrafts((prev) => { const n = { ...prev }; delete n[flag.name]; return n; });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <AdminPageShell
      title="Cost & Caching"
      description="Live OpenRouter balance, LLM spend, Perplexity cache savings, and per-endpoint cache lifetime controls."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      }
    >
      {error && (
        <div className="border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" /> OpenRouter Balance</CardTitle>
          </CardHeader>
          <CardContent>
            {balance ? (
              <>
                <div className="text-2xl font-semibold">{fmtUsd(balance.remainingUsd)}</div>
                <div className="text-xs text-muted-foreground mt-1">remaining of {fmtUsd(balance.limitUsd)} limit</div>
                <div className="text-xs text-muted-foreground">used: {fmtUsd(balance.usageUsd)}{balance.isFreeTier ? " · free tier" : ""}</div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">{balanceErr ?? "Loading…"}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4" /> LLM Spend (24h / 7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats ? (
              <>
                <div className="text-2xl font-semibold">{fmtUsd(stats.llmUsage.last24h.totals.costUsd, 3)}</div>
                <div className="text-xs text-muted-foreground mt-1">24h · {stats.llmUsage.last24h.totals.calls} calls · est. {fmtUsd(stats.llmUsage.last24h.monthEstimateUsd)}/mo</div>
                <div className="text-xs text-muted-foreground">7d · {fmtUsd(stats.llmUsage.last7d.totals.costUsd, 2)} · {stats.llmUsage.last7d.totals.calls} calls</div>
              </>
            ) : <div className="text-sm text-muted-foreground">Loading…</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Cache Savings (est.)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats ? (
              <>
                <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(stats.perplexityCache.totalSavedUsd)}</div>
                <div className="text-xs text-muted-foreground mt-1">{stats.perplexityCache.totalHits} cache hits · {stats.perplexityCache.active} active rows</div>
                <div className="text-xs text-muted-foreground">{stats.perplexityCache.expired} expired</div>
              </>
            ) : <div className="text-sm text-muted-foreground">Loading…</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" /> Cache Lifetime (TTL) per Endpoint
            <Tooltip>
              <TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">
                How long a Perplexity research answer is kept in the cache before we ask Perplexity again.
                Longer = cheaper but staler. Each endpoint can have its own value; `default` is the fallback.
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!ttls ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-3">
              {ttls.map((flag) => {
                const d = draftFor(flag);
                const dirty = d.hours !== String(flag.hours) || d.description !== flag.description;
                const previewHours = parseInt(d.hours, 10);
                return (
                  <div key={flag.name} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{flag.endpointKey}</code>
                        <Badge variant="outline" className="text-[10px]">{fmtHoursLabel(flag.hours)}</Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm text-xs whitespace-pre-wrap">
                            {flag.description || "No description"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Updated {new Date(flag.updatedAt).toLocaleString()} by {flag.updatedBy ?? "—"}
                      </div>
                    </div>
                    <div className="flex items-end gap-2 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Hours (1 – 8760)</label>
                        <Input
                          type="number"
                          min={1}
                          max={8760}
                          value={d.hours}
                          onChange={(e) => setDrafts((p) => ({ ...p, [flag.name]: { ...d, hours: e.target.value } }))}
                          className="h-8 text-sm"
                        />
                        {Number.isFinite(previewHours) && previewHours > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">= {fmtHoursLabel(previewHours)}</div>
                        )}
                      </div>
                      <div className="flex-[2] min-w-[280px]">
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Description (shows in tooltip)</label>
                        <Textarea
                          rows={2}
                          value={d.description}
                          onChange={(e) => setDrafts((p) => ({ ...p, [flag.name]: { ...d, description: e.target.value } }))}
                          className="text-xs min-h-[44px]"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => saveTtl(flag)}
                        disabled={!dirty || savingKey === flag.name}
                      >
                        {savingKey === flag.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        <span className="ml-1.5">Save</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {stats && stats.perplexityCache.byModel.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Savings by Model</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left py-1">Model</th><th className="text-right">Rows</th><th className="text-right">Hits</th><th className="text-right">Est. Saved</th></tr>
              </thead>
              <tbody>
                {stats.perplexityCache.byModel.map((m) => (
                  <tr key={m.model} className="border-b last:border-0">
                    <td className="py-1.5 font-mono text-xs">{m.model}</td>
                    <td className="text-right">{m.rows}</td>
                    <td className="text-right">{m.hits}</td>
                    <td className="text-right text-emerald-600 dark:text-emerald-400">{fmtUsd(m.estimatedSavedUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground mt-2">{stats.assumptions.note}</div>
          </CardContent>
        </Card>
      )}

      {stats && stats.perplexityCache.hotQueries.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Top 20 Hottest Cached Queries</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left py-1">Key</th><th className="text-left">Model</th><th className="text-right">Hits</th><th className="text-right">Last Hit</th><th className="text-right">Expires</th></tr>
              </thead>
              <tbody>
                {stats.perplexityCache.hotQueries.map((q) => (
                  <tr key={q.key} className="border-b last:border-0">
                    <td className="py-1.5 font-mono text-[10px]">{q.key}…</td>
                    <td className="font-mono text-[10px]">{q.model}</td>
                    <td className="text-right font-semibold">{q.hits}</td>
                    <td className="text-right text-[10px]">{q.lastHitAt ? new Date(q.lastHitAt).toLocaleString() : "—"}</td>
                    <td className="text-right text-[10px]">{new Date(q.expiresAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </AdminPageShell>
  );
}
