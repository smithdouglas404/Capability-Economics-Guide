import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw, Save, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

/**
 * Economic Rules Editor — admin-tunable strategic thresholds that the
 * Letta agent reasons against (CVI floor, DVX ceiling, posterior
 * variance limits, DVX factor weights, EVaR alarm levels, etc.).
 *
 * Edits land in the economic_rules table and immediately re-sync to
 * Letta's economic_rules core memory block so the agent's next
 * decision step sees the new threshold without waiting for the next
 * scheduled cycle.
 */

interface Rule {
  key: string;
  value: unknown;
  unit: string | null;
  description: string;
  lastUpdatedBy: string | null;
  lastUpdatedAt: string;
}

const ADMIN_KEY_STORAGE = "ce.admin-key";

function adminHeaders(): Record<string, string> {
  try {
    const k = localStorage.getItem(ADMIN_KEY_STORAGE);
    return k ? { "X-Admin-Key": k, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

function valueAsString(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function parseValueString(s: string): unknown {
  // Try number first, then JSON, then raw string.
  const trimmed = s.trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
  return s;
}

export default function AdminEconomicRulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { value: string; description: string }>>({});
  const [lastSyncedKey, setLastSyncedKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/economic-rules", { headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setRules(data.rules ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function draftFor(rule: Rule): { value: string; description: string } {
    return drafts[rule.key] ?? { value: valueAsString(rule.value), description: rule.description };
  }

  function updateDraft(key: string, patch: Partial<{ value: string; description: string }>) {
    setDrafts(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? { value: "", description: "" }), ...patch },
    }));
  }

  function isDirty(rule: Rule): boolean {
    const d = drafts[rule.key];
    if (!d) return false;
    return d.value !== valueAsString(rule.value) || d.description !== rule.description;
  }

  async function save(rule: Rule) {
    const d = draftFor(rule);
    setPendingKey(rule.key);
    try {
      const body: Record<string, unknown> = {};
      if (d.value !== valueAsString(rule.value)) body.value = parseValueString(d.value);
      if (d.description !== rule.description) body.description = d.description;
      const res = await fetch(`/api/admin/economic-rules/${encodeURIComponent(rule.key)}`, {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        alert(`Save failed: ${txt}`);
        return;
      }
      const data = await res.json();
      setLastSyncedKey(`${rule.key} (Letta ${data.lettaSynced ? "synced" : "sync skipped"})`);
      setTimeout(() => setLastSyncedKey(null), 3000);
      setDrafts(prev => {
        const next = { ...prev };
        delete next[rule.key];
        return next;
      });
      load();
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="mb-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to admin
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">Economic Rules</h1>
          <p className="text-muted-foreground mt-1">
            Strategic thresholds the Letta agent reasons against. Changes here re-sync to the agent&apos;s economic_rules core memory block immediately.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="mb-4 border-rose-500/40">
          <CardContent className="pt-4">
            <div className="flex items-center text-rose-600">
              <AlertTriangle className="h-4 w-4 mr-2" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {lastSyncedKey && (
        <Card className="mb-4 border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center text-emerald-700">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              <span>Saved {lastSyncedKey}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {rules?.map(rule => {
          const dirty = isDirty(rule);
          const d = draftFor(rule);
          return (
            <Card key={rule.key} className={dirty ? "border-amber-500/40" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-mono text-base">{rule.key}</CardTitle>
                  {rule.unit && <Badge variant="outline">{rule.unit}</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3 items-start">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Value</label>
                    <Input
                      value={d.value}
                      onChange={e => updateDraft(rule.key, { value: e.target.value })}
                      placeholder="number, true/false, or JSON"
                      className="font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Description (shown to the agent verbatim)</label>
                    <Textarea
                      value={d.description}
                      onChange={e => updateDraft(rule.key, { description: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <div className="md:pt-5">
                    <Button
                      onClick={() => save(rule)}
                      disabled={!dirty || pendingKey === rule.key}
                      size="sm"
                    >
                      {pendingKey === rule.key ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                      Save
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Last updated {new Date(rule.lastUpdatedAt).toLocaleString()} {rule.lastUpdatedBy ? `by ${rule.lastUpdatedBy}` : ""}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
