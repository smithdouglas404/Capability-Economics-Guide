import { useEffect, useRef, useState } from "react";
import { RefreshCw, Save, Loader2, AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import { AdminPageShell } from "@/components/admin-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";

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

interface PreviewImpact {
  key: string;
  field?: string;
  direction?: "below" | "above";
  supported: boolean;
  currentValue: number | string | unknown;
  proposedValue: number | string | unknown;
  delta?: number;
  totalRows?: number;
  currentlyOver?: number;
  currentlyUnder?: number;
  enteringWatch?: number;
  leavingWatch?: number;
  netDelta?: number;
  message?: string;
}

/**
 * Rule keys whose value is naturally numeric and where a slider is more
 * intuitive than a raw input. Each entry defines the slider range + step
 * so the admin can move the threshold smoothly without typing.
 */
const SLIDER_BOUNDS: Record<string, { min: number; max: number; step: number }> = {
  cvi_floor:                          { min: 0,    max: 1000, step: 10  },
  cvi_ceiling_for_attention:          { min: 0,    max: 1000, step: 10  },
  cvi_posterior_variance_max:         { min: 0,    max: 1,    step: 0.01 },
  economic_multiplier_min:            { min: 0,    max: 5,    step: 0.05 },
  dvx_ceiling:                        { min: 0,    max: 100,  step: 1   },
  dvx_watch_threshold:                { min: 0,    max: 100,  step: 1   },
  dvx_velocity_band_low:              { min: -1,   max: 1,    step: 0.01 },
  dvx_velocity_band_high:             { min: -1,   max: 1,    step: 0.01 },
  ev_at_risk_alarm_threshold:         { min: 0,    max: 1000, step: 10  },
  ev_at_risk_warn_threshold:          { min: 0,    max: 1000, step: 10  },
  contradiction_score_delta:          { min: 0,    max: 100,  step: 1   },
  contradiction_min_prior_confidence: { min: 0,    max: 1,    step: 0.05 },
  refinement_score_delta:             { min: 0,    max: 50,   step: 1   },
  memory_relevance_min:               { min: 0,    max: 1,    step: 0.05 },
  dvx_weight_velocity_divergence:     { min: 0,    max: 1,    step: 0.05 },
  dvx_weight_dependency_fragility:    { min: 0,    max: 1,    step: 0.05 },
  dvx_weight_pattern_match:           { min: 0,    max: 1,    step: 0.05 },
};

export default function AdminEconomicRulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { value: string; description: string }>>({});
  const [lastSyncedKey, setLastSyncedKey] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewImpact>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const previewTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    // If the value moved, schedule a debounced preview-impact fetch.
    if (patch.value !== undefined) {
      schedulePreviewFetch(key, patch.value);
    }
  }

  /**
   * Debounced live preview — 350ms quiet window so a slider drag fires
   * one request when the admin lets go, not per pixel. Idempotent: any
   * pending timer is cleared on each call.
   */
  function schedulePreviewFetch(key: string, value: string): void {
    if (previewTimers.current[key]) clearTimeout(previewTimers.current[key]);
    previewTimers.current[key] = setTimeout(() => {
      void fetchPreview(key, value);
    }, 350);
  }

  async function fetchPreview(key: string, value: string): Promise<void> {
    const proposedValue = Number(value);
    if (!Number.isFinite(proposedValue)) {
      // Non-numeric draft (boolean, JSON) — server-side preview is unavailable.
      setPreviews(prev => ({ ...prev, [key]: { key, supported: false, currentValue: value, proposedValue: value } }));
      return;
    }
    setPreviewLoading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/admin/economic-rules/preview-impact", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ key, proposedValue }),
      });
      if (!res.ok) {
        setPreviews(prev => ({ ...prev, [key]: { key, supported: false, currentValue: 0, proposedValue, message: `preview unavailable (${res.status})` } }));
        return;
      }
      const data = (await res.json()) as PreviewImpact;
      setPreviews(prev => ({ ...prev, [key]: data }));
    } catch (err) {
      setPreviews(prev => ({ ...prev, [key]: { key, supported: false, currentValue: 0, proposedValue, message: err instanceof Error ? err.message : "preview failed" } }));
    } finally {
      setPreviewLoading(prev => ({ ...prev, [key]: false }));
    }
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
    <AdminPageShell
      title="Economic Rules"
      description="Strategic thresholds the Letta agent reasons against. Changes here re-sync to the agent's economic_rules core memory block immediately."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-none">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      }
    >
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
          const bounds = SLIDER_BOUNDS[rule.key];
          const draftNum = Number(d.value);
          const sliderUsable = bounds && Number.isFinite(draftNum);
          const preview = previews[rule.key];
          const isPreviewLoading = !!previewLoading[rule.key];
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
                      data-testid={`input-rule-${rule.key}`}
                    />
                    {sliderUsable && (
                      <div className="mt-3" data-testid={`slider-row-${rule.key}`}>
                        <Slider
                          min={bounds.min}
                          max={bounds.max}
                          step={bounds.step}
                          value={[Math.min(bounds.max, Math.max(bounds.min, draftNum))]}
                          onValueChange={([next]) => updateDraft(rule.key, { value: String(next) })}
                          data-testid={`slider-rule-${rule.key}`}
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
                          <span>{bounds.min}</span>
                          <span>{bounds.max}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Description (shown to the agent verbatim)</label>
                    <Textarea
                      value={d.description}
                      onChange={e => updateDraft(rule.key, { description: e.target.value })}
                      rows={2}
                    />
                    {dirty && (
                      <div
                        className="mt-2 rounded border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
                        data-testid={`preview-impact-${rule.key}`}
                      >
                        {isPreviewLoading && (
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Recalculating impact…
                          </span>
                        )}
                        {!isPreviewLoading && preview && preview.supported && preview.netDelta !== undefined && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {preview.netDelta > 0 ? (
                              <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
                            ) : preview.netDelta < 0 ? (
                              <TrendingDown className="h-3.5 w-3.5 text-emerald-600" />
                            ) : null}
                            <span className="font-medium">
                              {preview.netDelta === 0
                                ? `No change to the watch list at this threshold.`
                                : preview.netDelta > 0
                                  ? `${preview.enteringWatch} more capabilities would enter the watch list`
                                  : `${preview.leavingWatch} capabilities would leave the watch list`}
                            </span>
                            <span className="text-muted-foreground">
                              · {String(preview.currentValue ?? "")} → {String(preview.proposedValue ?? "")}
                              {typeof preview.delta === "number" ? ` (Δ ${preview.delta >= 0 ? "+" : ""}${preview.delta.toFixed(2)})` : ""}
                            </span>
                          </div>
                        )}
                        {!isPreviewLoading && preview && !preview.supported && (
                          <span className="text-muted-foreground italic">
                            {preview.message ?? "Live preview unavailable for this rule."}
                          </span>
                        )}
                        {!isPreviewLoading && !preview && (
                          <span className="text-muted-foreground">Move the slider or edit the value to preview impact.</span>
                        )}
                      </div>
                    )}
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
    </AdminPageShell>
  );
}
