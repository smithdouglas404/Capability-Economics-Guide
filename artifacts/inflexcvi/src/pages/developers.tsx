import { useEffect, useState, useCallback } from "react";
import { useUser } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, Key, Loader2, Trash2, BookOpen, Activity, AlertTriangle } from "lucide-react";

const API_BASE = "/api";

const ALL_SCOPES = [
  { id: "read:industries", label: "Industries" },
  { id: "read:capabilities", label: "Capabilities" },
  { id: "read:cvi", label: "CVI Snapshots" },
  { id: "read:macro-events", label: "Macro Events" },
  { id: "read:value-chain", label: "Value Chain Stages" },
] as const;

type ApiKey = {
  id: number;
  label: string;
  prefix: string;
  scopes: string[] | null;
  rateLimitPerMin: number | null;
  monthlyQuota: number | null;
  monthlyUsageCount: number;
  quotaResetAt: string | null;
  orgId: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type UsageStats = {
  keyId: number;
  monthlyQuota: number | null;
  monthlyUsageCount: number;
  quotaResetAt: string | null;
  rateLimitPerMin: number | null;
  scopes: string[];
  dailyBuckets: { day: string; count: number }[];
  recent: { method: string; path: string; statusCode: number; durationMs: number | null; createdAt: string }[];
};

export default function DevelopersPage() {
  const { isSignedIn, isLoaded } = useUser();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>(ALL_SCOPES.map(s => s.id));
  const [rateLimitPerMin, setRateLimitPerMin] = useState<string>("");
  const [monthlyQuota, setMonthlyQuota] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: number; raw: string } | null>(null);

  // Usage panel
  const [openUsageKeyId, setOpenUsageKeyId] = useState<number | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/me/api-keys`, { credentials: "include" });
      if (res.ok) {
        const j = await res.json();
        setKeys(j.keys ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) void loadKeys();
  }, [isSignedIn, loadKeys]);

  const create = async () => {
    if (!label.trim()) {
      toast({ title: "Label required", description: "Give the key a human-readable label.", variant: "destructive" });
      return;
    }
    if (scopes.length === 0) {
      toast({ title: "Pick at least one scope", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = { label: label.trim(), scopes };
      if (rateLimitPerMin) body.rateLimitPerMin = Number(rateLimitPerMin);
      if (monthlyQuota) body.monthlyQuota = Number(monthlyQuota);
      const res = await fetch(`${API_BASE}/me/api-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to issue key");
      }
      const created = await res.json();
      setRevealedKey({ id: created.id, raw: created.raw });
      setLabel("");
      setRateLimitPerMin("");
      setMonthlyQuota("");
      void loadKeys();
    } catch (e) {
      toast({ title: "Failed to issue key", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: number) => {
    if (!confirm("Revoke this key? Any clients using it will get 401 immediately.")) return;
    const res = await fetch(`${API_BASE}/me/api-keys/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      toast({ title: "Key revoked" });
      void loadKeys();
    } else {
      toast({ title: "Revoke failed", variant: "destructive" });
    }
  };

  const openUsage = async (id: number) => {
    setOpenUsageKeyId(id);
    setUsage(null);
    setUsageLoading(true);
    try {
      const res = await fetch(`${API_BASE}/me/api-keys/${id}/usage`, { credentials: "include" });
      if (res.ok) setUsage(await res.json());
    } finally {
      setUsageLoading(false);
    }
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => toast({ title: "Copied to clipboard" }));
  };

  const toggleScope = (id: string) => {
    setScopes(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="container mx-auto max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Developers</CardTitle>
            <CardDescription>Sign in to issue API keys and view documentation.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const activeKeys = keys.filter(k => !k.revokedAt);
  const revokedKeys = keys.filter(k => k.revokedAt);

  return (
    <div className="container mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight">Public Data API</h1>
        <p className="text-muted-foreground mt-1">
          Stable, versioned access to industries, capabilities, the CVI, macro events, and value-chain stages. Authenticate every request with{" "}
          <code className="bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer ce_live_…</code>.
        </p>
      </div>

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys"><Key className="h-4 w-4 mr-1" /> API Keys</TabsTrigger>
          <TabsTrigger value="docs"><BookOpen className="h-4 w-4 mr-1" /> Documentation</TabsTrigger>
          <TabsTrigger value="quickstart">Quickstart</TabsTrigger>
        </TabsList>

        {/* ───────── Keys tab ───────── */}
        <TabsContent value="keys" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Issue a new API key</CardTitle>
              <CardDescription>Choose only the scopes you need. The raw key is shown once — copy it immediately.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="label">Label</Label>
                  <Input id="label" placeholder="Production integration" value={label} onChange={e => setLabel(e.target.value)} />
                </div>
                <div>
                  <Label>Scopes</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {ALL_SCOPES.map(s => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={scopes.includes(s.id)} onCheckedChange={() => toggleScope(s.id)} />
                        <span>{s.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="rate">Rate limit (req/min, optional)</Label>
                  <Input id="rate" type="number" placeholder="default 1500" value={rateLimitPerMin} onChange={e => setRateLimitPerMin(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="quota">Monthly quota (req/month, optional)</Label>
                  <Input id="quota" type="number" placeholder="unlimited" value={monthlyQuota} onChange={e => setMonthlyQuota(e.target.value)} />
                </div>
              </div>
              <Button onClick={create} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Key className="h-4 w-4 mr-1" />}
                Issue key
              </Button>

              {revealedKey && (
                <div className="border border-amber-500/30 bg-amber-500/5 p-4 mt-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Copy this key now — it will never be shown again.</div>
                      <div className="flex items-center gap-2 mt-2">
                        <code className="font-mono text-xs bg-background px-2 py-1 break-all flex-1">{revealedKey.raw}</code>
                        <Button size="sm" variant="outline" onClick={() => copy(revealedKey.raw)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active keys ({activeKeys.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : activeKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active keys. Issue one above.</p>
              ) : (
                <div className="space-y-3">
                  {activeKeys.map(k => (
                    <div key={k.id} className="border border-border/40 p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{k.label}</div>
                          <code className="text-xs text-muted-foreground">{k.prefix}…</code>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => openUsage(k.id)}>
                            <Activity className="h-4 w-4 mr-1" /> Usage
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => revoke(k.id)}>
                            <Trash2 className="h-4 w-4 mr-1" /> Revoke
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(k.scopes ?? []).map(s => (
                          <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground space-x-3">
                        <span>Rate limit: {k.rateLimitPerMin ?? "1500"}/min</span>
                        <span>Quota: {k.monthlyQuota != null ? `${k.monthlyUsageCount.toLocaleString()} / ${k.monthlyQuota.toLocaleString()}` : `${k.monthlyUsageCount.toLocaleString()} (unlimited)`}</span>
                        <span>Last used: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</span>
                      </div>

                      {openUsageKeyId === k.id && (
                        <div className="mt-3 border-t border-border/40 pt-3">
                          {usageLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : usage ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-7 gap-1">
                                {usage.dailyBuckets.length === 0 ? (
                                  <div className="col-span-7 text-xs text-muted-foreground">No traffic in the last 30 days.</div>
                                ) : usage.dailyBuckets.map(b => (
                                  <div key={b.day} className="text-center">
                                    <div className="bg-primary/20 mx-auto" style={{ height: Math.min(40, b.count / 5 + 4), width: 12 }} />
                                    <div className="text-[10px] text-muted-foreground mt-1">{b.day.slice(5)}</div>
                                    <div className="text-[10px] font-medium">{b.count}</div>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <div className="text-xs font-medium mb-1">Recent requests</div>
                                <div className="space-y-1 max-h-48 overflow-auto">
                                  {usage.recent.length === 0 ? (
                                    <div className="text-xs text-muted-foreground">No requests yet.</div>
                                  ) : usage.recent.map((r, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs font-mono">
                                      <span className={`shrink-0 w-10 ${r.statusCode >= 400 ? "text-red-600" : "text-emerald-600"}`}>{r.statusCode}</span>
                                      <span className="shrink-0 w-12">{r.method}</span>
                                      <span className="truncate flex-1">{r.path}</span>
                                      <span className="shrink-0 text-muted-foreground">{r.durationMs}ms</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">No usage data.</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {revokedKeys.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-muted-foreground">Revoked ({revokedKeys.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {revokedKeys.map(k => (
                    <div key={k.id} className="flex justify-between">
                      <span>{k.label} — <code className="text-xs">{k.prefix}…</code></span>
                      <span className="text-xs">revoked {k.revokedAt ? new Date(k.revokedAt).toLocaleDateString() : ""}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ───────── Docs tab — embeds Swagger UI ───────── */}
        <TabsContent value="docs" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>OpenAPI 3.0 reference</CardTitle>
              <CardDescription>
                Spec served at <code className="text-xs">/v1/openapi.json</code>. Try endpoints inline with your active key.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <iframe
                src="/v1/docs"
                title="Swagger UI"
                className="w-full"
                style={{ height: "80vh", border: 0 }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────── Quickstart tab ───────── */}
        <TabsContent value="quickstart" className="pt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quickstart</CardTitle>
              <CardDescription>All endpoints live under <code>/v1</code> and require a Bearer key.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="font-medium mb-1">Inspect your key</div>
                <pre className="bg-muted p-3 text-xs overflow-x-auto">{`curl -H "Authorization: Bearer ce_live_..." \\
  https://inflexcvi.ai/v1/me`}</pre>
              </div>
              <div>
                <div className="font-medium mb-1">Latest CVI snapshot</div>
                <pre className="bg-muted p-3 text-xs overflow-x-auto">{`curl -H "Authorization: Bearer ce_live_..." \\
  https://inflexcvi.ai/v1/cvi/current`}</pre>
              </div>
              <div>
                <div className="font-medium mb-1">List capabilities for an industry</div>
                <pre className="bg-muted p-3 text-xs overflow-x-auto">{`curl -H "Authorization: Bearer ce_live_..." \\
  "https://inflexcvi.ai/v1/capabilities?industrySlug=insurance&limit=50"`}</pre>
              </div>
              <div>
                <div className="font-medium mb-1">Response headers</div>
                <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                  <li><code>X-RateLimit-Limit</code> / <code>X-RateLimit-Remaining</code> — per-minute quota</li>
                  <li><code>X-Quota-Limit</code> / <code>X-Quota-Used</code> / <code>X-Quota-Remaining</code> — monthly quota (only when set)</li>
                  <li><code>Retry-After</code> — seconds until the rate limit resets (on 429)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
