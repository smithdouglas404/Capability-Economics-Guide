import { useEffect, useState } from "react";
import { Link } from "wouter";
import { RefreshCw, Star, StarOff, Loader2, ExternalLink, KeyRound, Copy, CheckCircle2, Eye, Calendar, X, Save, Sparkles } from "lucide-react";
import { AdminPageShell } from "@/components/admin-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/**
 * Admin page for managing the homepage analogy-card rotation.
 *
 * Lists every case study with:
 *   - whether it has an economics_breakdown populated
 *   - the company name + event title (if populated)
 *   - a regenerate button (re-runs Perplexity research)
 *   - a feature toggle (only one case study can be featured at a time; the
 *     featured one drives the homepage analogy card via /api/featured-case-study)
 *
 * All actions hit admin endpoints; user must be signed in as admin (the
 * AdminOnly wrapper in App.tsx enforces this).
 */

interface CaseStudyRow {
  id: number;
  industryId: number;
  industrySlug: string;
  industryName: string;
  title: string;
  isFeatured: boolean;
  hasEconomicsBreakdown: boolean;
  economicsCompanyName: string | null;
  economicsEventTitle: string | null;
  generatedAt: string;
}

interface EconomicsBreakdown {
  companyName: string;
  eventTitle: string;
  costBreakdown: Array<{ label: string; amountUsdMm: number }>;
  valueGeneratedUsdMm: number;
  unlockedUsdMm: number;
  sources: Array<{ url: string; title: string }>;
}

interface RotationPolicy {
  id: number;
  mode: "manual" | "rotation";
  rotationDays: number | null;
  rotationSource: "existing_rotate" | "anthropic_new" | null;
  industryFilter: string | null;
  lastRotatedAt: string | null;
  nextRotationAt: string | null;
}

interface ScheduleRow {
  id: number;
  scheduledFor: string;
  caseStudyId: number | null;
  generateForIndustryId: number | null;
  generateCompanyName: string | null;
  status: "pending" | "executed" | "failed" | "cancelled";
  executedAt: string | null;
  resultCaseStudyId: number | null;
  errorMessage: string | null;
}

const ADMIN_KEY_STORAGE = "ce.admin-key";

function getAdminKey(): string | null {
  try { return localStorage.getItem(ADMIN_KEY_STORAGE); }
  catch { return null; }
}

function adminHeaders(): Record<string, string> {
  const k = getAdminKey();
  return k ? { "X-Admin-Key": k, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export default function AdminCaseStudiesPage() {
  const [rows, setRows] = useState<CaseStudyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Record<number, boolean>>({});
  const [companyInputs, setCompanyInputs] = useState<Record<number, string>>({});
  const [adminKey, setAdminKey] = useState<string>(getAdminKey() ?? "");
  const [rotating, setRotating] = useState(false);
  const [newKeyJustRotated, setNewKeyJustRotated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewBreakdown, setPreviewBreakdown] = useState<EconomicsBreakdown | null>(null);
  const [policy, setPolicy] = useState<RotationPolicy | null>(null);
  const [policyDraft, setPolicyDraft] = useState<{ mode: "manual" | "rotation"; rotationDays: string; rotationSource: "existing_rotate" | "anthropic_new"; industryFilter: string }>({ mode: "manual", rotationDays: "7", rotationSource: "existing_rotate", industryFilter: "" });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [scheduleDraftId, setScheduleDraftId] = useState<number | null>(null); // case study being scheduled
  const [scheduleDraftWhen, setScheduleDraftWhen] = useState<string>("");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  function persistAdminKey(v: string) {
    setAdminKey(v);
    try { localStorage.setItem(ADMIN_KEY_STORAGE, v); } catch {}
  }

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/admin/case-studies", { headers: adminHeaders() });
      if (res.status === 401) { setError("Set the admin key below to load case studies."); setRows([]); return; }
      if (!res.ok) { setError(`Load failed: HTTP ${res.status}`); setRows([]); return; }
      const data = await res.json() as { caseStudies: CaseStudyRow[] };
      setRows(data.caseStudies);
      // Pre-fill company inputs with the existing economics company name if present.
      const inputs: Record<number, string> = {};
      for (const r of data.caseStudies) {
        if (r.economicsCompanyName) inputs[r.id] = r.economicsCompanyName;
      }
      setCompanyInputs(inputs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setRows([]);
    }
  }

  async function loadPolicy() {
    try {
      const res = await fetch("/api/admin/case-studies/policy", { headers: adminHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { policy: RotationPolicy | null };
      setPolicy(data.policy);
      if (data.policy) {
        setPolicyDraft({
          mode: data.policy.mode,
          rotationDays: String(data.policy.rotationDays ?? 7),
          rotationSource: (data.policy.rotationSource ?? "existing_rotate"),
          industryFilter: data.policy.industryFilter ?? "",
        });
      }
    } catch { /* silent */ }
  }

  async function loadSchedule() {
    try {
      const res = await fetch("/api/admin/case-studies/schedule", { headers: adminHeaders() });
      if (!res.ok) return;
      const data = await res.json() as { schedule: ScheduleRow[] };
      setSchedule(data.schedule);
    } catch { /* silent */ }
  }

  async function savePolicy() {
    setSavingPolicy(true);
    setError(null);
    try {
      const body = {
        mode: policyDraft.mode,
        rotationDays: policyDraft.mode === "rotation" ? Number(policyDraft.rotationDays) : null,
        rotationSource: policyDraft.mode === "rotation" ? policyDraft.rotationSource : null,
        industryFilter: policyDraft.industryFilter.trim() || null,
      };
      const res = await fetch("/api/admin/case-studies/policy", { method: "PUT", headers: adminHeaders(), body: JSON.stringify(body) });
      if (!res.ok) { setError(`Save policy failed: HTTP ${res.status}`); return; }
      await loadPolicy();
    } finally { setSavingPolicy(false); }
  }

  async function submitSchedule(caseStudyId: number | null, generateForIndustryId: number | null) {
    if (!scheduleDraftWhen) { setError("Pick a date/time first"); return; }
    setScheduleSaving(true);
    setError(null);
    try {
      const body = {
        scheduledFor: new Date(scheduleDraftWhen).toISOString(),
        ...(caseStudyId ? { caseStudyId } : {}),
        ...(generateForIndustryId ? { generateForIndustryId } : {}),
      };
      const res = await fetch("/api/admin/case-studies/schedule", { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(`Schedule failed: ${b.error ?? res.status}`);
        return;
      }
      setScheduleDraftId(null);
      setScheduleDraftWhen("");
      await loadSchedule();
    } finally { setScheduleSaving(false); }
  }

  async function cancelSchedule(id: number) {
    const res = await fetch(`/api/admin/case-studies/schedule/${id}`, { method: "DELETE", headers: adminHeaders() });
    if (!res.ok) { setError(`Cancel failed: HTTP ${res.status}`); return; }
    await loadSchedule();
  }

  useEffect(() => { load(); loadPolicy(); loadSchedule(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [adminKey]);

  async function regenerate(id: number) {
    const companyName = (companyInputs[id] ?? "").trim();
    if (!companyName) { setError("Enter a company name first"); return; }
    setRegenerating(prev => ({ ...prev, [id]: true }));
    setError(null);
    try {
      const res = await fetch(`/api/admin/case-studies/${id}/regenerate-economics-breakdown`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ companyName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown" }));
        setError(`Regenerate failed: ${body.error ?? res.status}`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRegenerating(prev => ({ ...prev, [id]: false }));
    }
  }

  async function toggleFeatured(id: number, makeFeatured: boolean) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/case-studies/${id}/feature`, {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ featured: makeFeatured }),
      });
      if (!res.ok) {
        setError(`Toggle failed: HTTP ${res.status}`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  async function rotateAdminKey() {
    if (!confirm("Generate a NEW admin key? The current key stops working immediately. You'll get the new value once — copy it into your password manager + paste back into the field below.")) return;
    setRotating(true);
    setError(null);
    setNewKeyJustRotated(null);
    try {
      const res = await fetch("/api/admin/security/rotate-admin-key", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ reason: "manual rotation from admin UI" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown" }));
        setError(`Rotation failed: ${body.error ?? res.status}`);
        return;
      }
      const data = await res.json() as { newKey: string };
      setNewKeyJustRotated(data.newKey);
      // Auto-replace the current admin key in localStorage so the UI keeps
      // working post-rotation.
      persistAdminKey(data.newKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRotating(false);
    }
  }

  async function copyNewKey() {
    if (!newKeyJustRotated) return;
    try {
      await navigator.clipboard.writeText(newKeyJustRotated);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard write failed — select the value manually");
    }
  }

  async function loadPreview(id: number, industrySlug: string) {
    setPreviewId(id);
    setPreviewBreakdown(null);
    try {
      const res = await fetch(`/api/case-study/${industrySlug}/economics-breakdown`);
      if (!res.ok) return;
      const data = await res.json() as { economicsBreakdown: EconomicsBreakdown | null };
      setPreviewBreakdown(data.economicsBreakdown);
    } catch {
      // ignore
    }
  }

  return (
    <AdminPageShell
      title="Case-study rotation"
      description="Manage which case study renders on the homepage analogy card. Each case study can have a Perplexity-researched economics breakdown attached. Only one case study is featured at a time — flipping the star moves the spotlight."
    >
      <Card className="rounded-none border-border/60 mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <KeyRound className="w-3.5 h-3.5" /> Admin key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="admin-key" className="text-xs text-muted-foreground">
            Pasted once and stored in localStorage. Required for the admin endpoints. Use <strong>Rotate</strong> to generate a new value when the current one is compromised or stale.
          </Label>
          <div className="flex gap-2">
            <Input
              id="admin-key"
              type="password"
              value={adminKey}
              onChange={e => persistAdminKey(e.target.value)}
              placeholder="X-Admin-Key value"
              className="rounded-none font-mono text-xs flex-1"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-none text-[11px]"
              onClick={rotateAdminKey}
              disabled={rotating}
            >
              {rotating
                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                : <RefreshCw className="w-3 h-3 mr-1" />}
              Rotate key
            </Button>
          </div>
          {newKeyJustRotated && (
            <div className="border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 text-xs">
              <div className="font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" /> New admin key — save now, shown ONCE
              </div>
              <div className="font-mono text-xs break-all bg-background border border-border/60 p-2 select-all">
                {newKeyJustRotated}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-[11px]">
                  The previous key stopped working immediately. Copy to your password manager. localStorage has already been updated.
                </p>
                <Button type="button" size="sm" variant="outline" className="rounded-none text-[11px]" onClick={copyNewKey}>
                  {copied
                    ? <><CheckCircle2 className="w-3 h-3 mr-1 text-emerald-500" /> Copied</>
                    : <><Copy className="w-3 h-3 mr-1" /> Copy</>}
                </Button>
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Rotations are logged with a sha256 hash of the previous key (never the plaintext) in <code>system_secrets.audit_log</code> — blockchain-anchor-ready when that infrastructure ships.
          </p>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2 rounded-none">
          {error}
        </div>
      )}

      {/* Auto-rotation policy panel */}
      <Card className="rounded-none border-border/60 mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Auto-rotation
            {policy?.mode === "rotation" && (
              <Badge className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-700 border-emerald-500/30">Active</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[140px_120px_1fr_160px_auto] gap-2 items-end">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</Label>
              <select
                className="rounded-none w-full h-9 border border-border bg-background px-2 text-sm"
                value={policyDraft.mode}
                onChange={e => setPolicyDraft(d => ({ ...d, mode: e.target.value as "manual" | "rotation" }))}
              >
                <option value="manual">Manual</option>
                <option value="rotation">Auto-rotate</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Every (days)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                disabled={policyDraft.mode === "manual"}
                value={policyDraft.rotationDays}
                onChange={e => setPolicyDraft(d => ({ ...d, rotationDays: e.target.value }))}
                className="rounded-none h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</Label>
              <select
                className="rounded-none w-full h-9 border border-border bg-background px-2 text-sm disabled:opacity-50"
                disabled={policyDraft.mode === "manual"}
                value={policyDraft.rotationSource}
                onChange={e => setPolicyDraft(d => ({ ...d, rotationSource: e.target.value as "existing_rotate" | "anthropic_new" }))}
              >
                <option value="existing_rotate">Cycle existing case studies (LRU by industry)</option>
                <option value="anthropic_new">Anthropic generates a fresh one each rotation</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Industry filter</Label>
              <Input
                placeholder="(all industries)"
                disabled={policyDraft.mode === "manual"}
                value={policyDraft.industryFilter}
                onChange={e => setPolicyDraft(d => ({ ...d, industryFilter: e.target.value }))}
                className="rounded-none h-9 text-sm"
              />
            </div>
            <Button onClick={savePolicy} disabled={savingPolicy} className="rounded-none h-9 text-[11px]">
              {savingPolicy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
              Save
            </Button>
          </div>
          {policy?.mode === "rotation" && policy.nextRotationAt && (
            <div className="text-xs text-muted-foreground font-mono">
              Next rotation: {new Date(policy.nextRotationAt).toLocaleString()}
              {policy.lastRotatedAt && ` · last: ${new Date(policy.lastRotatedAt).toLocaleString()}`}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>The cron checks every 10 minutes. With <code>anthropic_new</code>, each rotation generates a fresh case study and features it — costs ~1 Anthropic call per rotation.</span>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Case studies ({rows?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows === null ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No case studies yet — generate some via the agent first.</div>
          ) : (
            <div className="divide-y divide-border/40">
              {rows.map(r => {
                const busy = regenerating[r.id] === true;
                return (
                  <div key={r.id} className="p-4 grid lg:grid-cols-[1fr_320px] gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                          {r.industryName}
                        </Badge>
                        {r.isFeatured && (
                          <Badge className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-600 border-amber-500/30">
                            Featured
                          </Badge>
                        )}
                        {r.hasEconomicsBreakdown ? (
                          <Badge className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                            Economics: {r.economicsCompanyName} — {r.economicsEventTitle}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            No economics breakdown yet
                          </Badge>
                        )}
                      </div>
                      <div className="font-serif text-base leading-tight">{r.title}</div>
                      <Link
                        href={`/case-study/${r.industrySlug}`}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
                      >
                        View case study <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`co-${r.id}`} className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Company for economics research
                      </Label>
                      <Input
                        id={`co-${r.id}`}
                        value={companyInputs[r.id] ?? ""}
                        onChange={e => setCompanyInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="e.g. Progressive Corp"
                        className="rounded-none text-xs h-8"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-none text-[11px] flex-1"
                          disabled={busy}
                          onClick={() => regenerate(r.id)}
                        >
                          {busy
                            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            : <RefreshCw className="w-3 h-3 mr-1" />}
                          {r.hasEconomicsBreakdown ? "Regenerate" : "Research"}
                        </Button>
                        <Button
                          size="sm"
                          variant={r.isFeatured ? "default" : "outline"}
                          className="rounded-none text-[11px]"
                          onClick={() => toggleFeatured(r.id, !r.isFeatured)}
                        >
                          {r.isFeatured
                            ? <><StarOff className="w-3 h-3 mr-1" /> Unfeature</>
                            : <><Star className="w-3 h-3 mr-1" /> Feature</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-none text-[11px]"
                          onClick={() => { setScheduleDraftId(r.id); setScheduleDraftWhen(""); }}
                          title="Schedule a date to feature this case study"
                        >
                          <Calendar className="w-3 h-3 mr-1" /> Schedule
                        </Button>
                      </div>
                      {scheduleDraftId === r.id && (
                        <div className="border border-border bg-muted/40 p-2 space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            <Input
                              type="datetime-local"
                              value={scheduleDraftWhen}
                              onChange={e => setScheduleDraftWhen(e.target.value)}
                              className="rounded-none text-xs h-8 flex-1"
                            />
                            <Button size="sm" disabled={scheduleSaving || !scheduleDraftWhen} className="rounded-none text-[11px]" onClick={() => submitSchedule(r.id, null)}>
                              {scheduleSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="rounded-none text-[11px]" onClick={() => { setScheduleDraftId(null); setScheduleDraftWhen(""); }}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                          <div className="text-[10px] text-muted-foreground">At the scheduled time, this case study becomes featured (cron runs every 10 minutes).</div>
                        </div>
                      )}
                      {r.hasEconomicsBreakdown && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-none text-[11px] w-full"
                          onClick={() => loadPreview(r.id, r.industrySlug)}
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          Preview analogy card
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending + recent scheduled changes */}
      {schedule.length > 0 && (
        <Card className="rounded-none border-border/60 mt-4">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Scheduled feature changes ({schedule.filter(s => s.status === "pending").length} pending)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/40">
              {schedule.map(s => {
                const target = s.caseStudyId
                  ? `Promote case study #${s.caseStudyId}`
                  : `Generate new for industry #${s.generateForIndustryId}${s.generateCompanyName ? ` (${s.generateCompanyName})` : ""}`;
                const statusBadge = {
                  pending: { label: "Pending", cls: "bg-blue-500/15 text-blue-700 border-blue-500/30" },
                  executed: { label: "Executed", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
                  failed: { label: "Failed", cls: "bg-destructive/15 text-destructive border-destructive/30" },
                  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
                }[s.status];
                return (
                  <div key={s.id} className="p-3 flex items-center gap-3 text-sm">
                    <Badge className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${statusBadge.cls}`}>
                      {statusBadge.label}
                    </Badge>
                    <div className="font-mono text-xs">{new Date(s.scheduledFor).toLocaleString()}</div>
                    <div className="flex-1 text-xs text-muted-foreground">{target}</div>
                    {s.errorMessage && <div className="text-xs text-destructive max-w-md truncate" title={s.errorMessage}>{s.errorMessage}</div>}
                    {s.status === "pending" && (
                      <Button size="sm" variant="ghost" className="rounded-none text-[11px]" onClick={() => cancelSchedule(s.id)}>
                        <X className="w-3 h-3 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview pane — renders the analogy-card layout for the selected row. */}
      {previewId !== null && (
        <Card className="rounded-none border-border/60 mt-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Preview — homepage analogy card</span>
              <Button size="sm" variant="ghost" onClick={() => { setPreviewId(null); setPreviewBreakdown(null); }} className="rounded-none text-[11px]">
                Close
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {previewBreakdown === null ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading breakdown…</div>
            ) : (
              <div className="grid md:grid-cols-[1fr_320px] gap-6 max-w-4xl">
                <div className="space-y-3 text-sm">
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    {previewBreakdown.companyName} — {previewBreakdown.eventTitle}
                  </div>
                  <h3 className="font-serif text-xl tracking-tight">How this renders on the homepage:</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The card on the right replaces the "Traditional view → Capability view → Value unlocked" trio on the homepage analogy section. Hit <strong>Feature</strong> to make this the live homepage card.
                  </p>
                  <div className="border-t border-border/40 pt-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Sources</div>
                    <ul className="space-y-1">
                      {previewBreakdown.sources.map((s, i) => (
                        <li key={i} className="text-xs">
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            {s.title}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="space-y-3">
                  {previewBreakdown.costBreakdown[0] && (
                    <div className="border border-border/50 bg-background p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1">Traditional view</div>
                          <div className="font-serif text-lg tracking-tight">{previewBreakdown.costBreakdown[0].label}</div>
                        </div>
                        <div className="font-mono text-xl font-light tabular-nums text-foreground/40">${previewBreakdown.costBreakdown[0].amountUsdMm.toFixed(1)}M</div>
                      </div>
                    </div>
                  )}
                  {previewBreakdown.costBreakdown[1] && (
                    <div className="border border-accent/30 bg-accent/[0.04] p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-accent mb-1">Capability view</div>
                          <div className="font-serif text-lg tracking-tight">{previewBreakdown.costBreakdown[1].label}</div>
                        </div>
                        <div className="font-mono text-xl font-light tabular-nums text-foreground/60">${previewBreakdown.costBreakdown[1].amountUsdMm.toFixed(1)}M</div>
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-2">
                        Value generated: <span className="text-accent">${previewBreakdown.valueGeneratedUsdMm.toFixed(1)}M</span>
                        {" · "}
                        {(previewBreakdown.valueGeneratedUsdMm / previewBreakdown.costBreakdown[1].amountUsdMm).toFixed(1)}× return
                      </div>
                    </div>
                  )}
                  <div className="border border-border/40 bg-background p-3 flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Unlocked</span>
                    <span className="font-serif text-lg text-accent font-medium">+${previewBreakdown.unlockedUsdMm.toFixed(1)}M</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </AdminPageShell>
  );
}
