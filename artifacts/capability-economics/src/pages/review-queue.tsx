import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw, Plus, Loader2, MessageSquare, Eye, AlertTriangle, History, AlertCircle, RotateCcw } from "lucide-react";

const API_BASE = "/api";

type QueueItem = {
  id: number;
  name: string;
  industryId: number;
  industryName: string;
  submittedBy: string | null;
  revisionCount: number;
  createdAt: string;
  reviewNotes: Array<{ role: string; comment: string; ts: string }> | null;
  summaryNarrative: string | null;
  hasEconomics: boolean;
  enrichmentReady: boolean;
  enrichmentStatus: "pending" | "running" | "ready" | "failed" | string;
  enrichmentStage: string | null;
  enrichmentError: string | null;
  enrichmentUpdatedAt: string | null;
};

type Industry = { id: number; name: string; slug: string };

type DetailPreview = {
  capability: { name: string; description: string; benchmarkScore: number };
  industry: { name: string };
  economics?: {
    summaryNarrative?: string | null;
    traditionalNarrative?: string | null;
    economicNarrative?: string | null;
    aiNarrative?: string | null;
    aiExposureScore?: number | null;
    aiTimeToDisplacementMonths?: number | null;
    aiSubstitutes?: string[] | null;
    consensusQuadrant?: string | null;
    consensusSummary?: string | null;
    halfLifeMonths?: number | null;
    marginStructurePct?: number | null;
    revenueExposureMm?: number | null;
    playbook?: string[] | null;
    benchmarkInterpretation?: string | null;
  } | null;
};

function timeAgo(s: string) {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function NewCapabilityForm({ industries, onCreated }: { industries: Industry[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [industryId, setIndustryId] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (!name || !industryId || !description) { setMsg({ ok: false, text: "Fill all fields." }); return; }
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/review/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, industryId, description }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: body.error ?? `Failed (${res.status})` });
      } else {
        setMsg({ ok: true, text: `Drafted #${body.id} — enrichment running. It will appear in the queue once ready.` });
        setName(""); setDescription(""); setIndustryId("");
        onCreated();
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary" /> Submit New Capability
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Capability name</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              className="w-full h-9 px-3 border bg-background rounded text-sm"
              placeholder="e.g. Real-Time Fraud Detection"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Industry</label>
            <select
              value={industryId} onChange={e => setIndustryId(e.target.value ? Number(e.target.value) : "")}
              className="w-full h-9 px-3 border bg-background rounded text-sm"
            >
              <option value="">Select…</option>
              {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Short description (the LLM uses this to seed enrichment)</label>
          <textarea
            value={description} onChange={e => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border bg-background rounded text-sm"
            placeholder="What does this capability do, in 1-2 sentences?"
          />
        </div>
        {msg && (
          <div className={`px-3 py-2 rounded text-sm ${msg.ok ? "bg-green-500/10 text-green-700" : "bg-red-500/10 text-red-700"}`}>
            {msg.text}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {submitting ? "Drafting…" : "Draft & Queue for Review"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewPane({ id }: { id: number }) {
  const [data, setData] = useState<DetailPreview | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/alpha/capability/${id}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-8 flex items-center justify-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading preview…</div>;
  if (!data) return <div className="py-4 text-sm text-red-600">Failed to load preview.</div>;
  const e = data.economics;

  return (
    <div className="space-y-3 text-sm">
      <div className="border rounded p-3 bg-muted/20">
        <div className="text-xs text-muted-foreground mb-1">What this capability is</div>
        <p>{e?.summaryNarrative ?? <span className="italic text-muted-foreground">Pending enrichment…</span>}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border rounded p-3">
          <div className="text-xs font-medium text-amber-700 mb-1">Why the conventional view is wrong</div>
          <p className="text-sm">{e?.traditionalNarrative ?? <span className="italic text-muted-foreground">—</span>}</p>
        </div>
        <div className="border rounded p-3">
          <div className="text-xs font-medium text-emerald-700 mb-1">Economic value</div>
          <p className="text-sm">{e?.economicNarrative ?? <span className="italic text-muted-foreground">—</span>}</p>
        </div>
      </div>
      <div className="border rounded p-3">
        <div className="text-xs font-medium text-purple-700 mb-1">AI exposure</div>
        <p className="text-sm">{e?.aiNarrative ?? <span className="italic text-muted-foreground">—</span>}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {e?.aiExposureScore != null && <span>Risk: <b className="text-foreground font-mono">{e.aiExposureScore}%</b></span>}
          {e?.aiTimeToDisplacementMonths != null && <span>TTD: <b className="text-foreground font-mono">{e.aiTimeToDisplacementMonths}mo</b></span>}
          {e?.aiSubstitutes && e.aiSubstitutes.length > 0 && <span>Subs: <b className="text-foreground">{e.aiSubstitutes.slice(0, 4).join(", ")}</b></span>}
        </div>
      </div>
      {e?.playbook && e.playbook.length > 0 && (
        <div className="border rounded p-3">
          <div className="text-xs font-medium text-blue-700 mb-1">Playbook (this week)</div>
          <ol className="list-decimal list-inside space-y-0.5 text-sm">
            {e.playbook.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="border rounded p-2"><div className="text-muted-foreground">CE Quadrant</div><div className="font-mono font-semibold">{e?.consensusQuadrant ?? "—"}</div></div>
        <div className="border rounded p-2"><div className="text-muted-foreground">Half-life</div><div className="font-mono font-semibold">{e?.halfLifeMonths ?? "—"}mo</div></div>
        <div className="border rounded p-2"><div className="text-muted-foreground">Margin %</div><div className="font-mono font-semibold">{e?.marginStructurePct ?? "—"}</div></div>
        <div className="border rounded p-2"><div className="text-muted-foreground">Rev exposure $M</div><div className="font-mono font-semibold">{e?.revenueExposureMm ?? "—"}</div></div>
      </div>
    </div>
  );
}

function QueueRow({ item, onAction }: { item: QueueItem; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "retry" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const retry = async () => {
    setBusy("retry"); setMsg(null);
    try {
      const r = await fetch(`${API_BASE}/review/${item.id}/retry`, { method: "POST" });
      const b = await r.json();
      if (!r.ok) setMsg(b.error ?? "failed");
      else { setMsg(b.message ?? "Retrying enrichment…"); onAction(); }
    } finally { setBusy(null); }
  };

  const approve = async () => {
    setBusy("approve"); setMsg(null);
    try {
      const r = await fetch(`${API_BASE}/review/${item.id}/approve`, { method: "POST" });
      const b = await r.json();
      if (!r.ok) setMsg(b.error ?? "failed");
      else { setMsg("Approved."); onAction(); }
    } finally { setBusy(null); }
  };
  const reject = async () => {
    setBusy("reject"); setMsg(null);
    try {
      const r = await fetch(`${API_BASE}/review/${item.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: comment.trim() || undefined }),
      });
      const b = await r.json();
      if (!r.ok) setMsg(b.error ?? "failed");
      else {
        setMsg(b.message ?? "Rejected.");
        setShowReject(false); setComment("");
        onAction();
      }
    } finally { setBusy(null); }
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-3 bg-muted/20">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{item.name}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-muted">{item.industryName}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-700">{item.submittedBy ?? "?"}</span>
            {item.revisionCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-700 flex items-center gap-1">
                <History className="w-3 h-3" /> rev {item.revisionCount}
              </span>
            )}
            {item.enrichmentStatus === "running" && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {item.enrichmentStage === "alpha"
                  ? "running alpha…"
                  : item.enrichmentStage === "detail"
                    ? "alpha done · narrative running…"
                    : "enriching…"}
              </span>
            )}
            {item.enrichmentStatus === "failed" && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-700 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> failed{item.enrichmentStage ? ` at ${item.enrichmentStage}` : ""}
              </span>
            )}
            {item.enrichmentStatus === "ready" && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-700 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> enrichment ready
              </span>
            )}
            {item.enrichmentStatus !== "running" && item.enrichmentStatus !== "failed" && item.enrichmentStatus !== "ready" && !item.enrichmentReady && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> enriching…
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{timeAgo(item.createdAt)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setExpanded(x => !x)} className="gap-1.5">
            <Eye className="w-3.5 h-3.5" /> {expanded ? "Hide" : "Preview"}
          </Button>
          {(item.enrichmentStatus === "failed" || item.enrichmentStatus === "running") && (
            <Button
              size="sm"
              variant="outline"
              onClick={retry}
              disabled={!!busy || item.enrichmentStatus === "running"}
              className="gap-1.5"
              title={item.enrichmentStatus === "running" ? "Already running" : "Re-fire enrichment job"}
            >
              {busy === "retry" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Retry enrichment
            </Button>
          )}
          <Button size="sm" variant="default" onClick={approve} disabled={!item.enrichmentReady || !!busy} className="gap-1.5">
            {busy === "approve" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowReject(s => !s)} disabled={!!busy} className="gap-1.5">
            <XCircle className="w-3.5 h-3.5" /> Reject
          </Button>
        </div>
      </div>

      {item.enrichmentStatus === "failed" && item.enrichmentError && (
        <div className="px-3 py-2 border-t bg-red-500/5 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            <b>Last error:</b> <span className="font-mono">{item.enrichmentError}</span>
            {item.enrichmentUpdatedAt && (
              <span className="text-muted-foreground"> · {timeAgo(item.enrichmentUpdatedAt)}</span>
            )}
          </div>
        </div>
      )}

      {showReject && (
        <div className="p-3 border-t bg-amber-500/5 space-y-2">
          <div className="flex items-start gap-2">
            <MessageSquare className="w-4 h-4 mt-0.5 text-amber-700 shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-amber-900 mb-1">
                <b>With comment:</b> sent back to LLM for revision, returns to queue.
                <br />
                <b>Without comment:</b> <span className="text-red-700">final termination — capability deleted.</span>
              </p>
              <textarea
                value={comment} onChange={e => setComment(e.target.value)} rows={3}
                placeholder="Optional: what should the LLM fix? (leave blank to terminate)"
                className="w-full px-3 py-2 border bg-background rounded text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setShowReject(false); setComment(""); }}>Cancel</Button>
            <Button
              size="sm"
              variant={comment.trim() ? "default" : "destructive"}
              onClick={() => {
                if (!comment.trim()) {
                  if (!confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) return;
                }
                reject();
              }}
              disabled={busy === "reject"}
              className="gap-1.5"
            >
              {busy === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : comment.trim() ? <RefreshCw className="w-3.5 h-3.5" />
                : <AlertTriangle className="w-3.5 h-3.5" />}
              {comment.trim() ? "Send back to LLM" : "Terminate capability"}
            </Button>
          </div>
        </div>
      )}

      {msg && <div className="px-3 py-2 text-sm bg-green-500/10 text-green-700 border-t">{msg}</div>}

      {item.reviewNotes && item.reviewNotes.length > 0 && (
        <div className="p-3 border-t bg-muted/10 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Review history</div>
          {item.reviewNotes.map((n, i) => (
            <div key={i} className="text-xs flex gap-2">
              <span className="text-muted-foreground shrink-0">{new Date(n.ts).toLocaleString()}</span>
              <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{n.role}</span>
              <span>{n.comment}</span>
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="p-3 border-t">
          <PreviewPane id={item.id} />
        </div>
      )}
    </div>
  );
}

export default function ReviewQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const [q, i] = await Promise.all([
        fetch(`${API_BASE}/review/queue`).then(r => r.json()),
        fetch(`${API_BASE}/industries`).then(r => r.json()),
      ]);
      setQueue(Array.isArray(q) ? q : []);
      setIndustries(Array.isArray(i) ? i : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, 15000);
    return () => clearInterval(id);
  }, [fetchQueue]);

  return (
    <div className="min-h-screen bg-background p-6 max-w-screen-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Capability Review Queue</h1>
          <p className="text-muted-foreground mt-1">Human-in-the-loop approval for new and revised capabilities. Auto-refreshes every 15s.</p>
        </div>
        <Button variant="outline" onClick={fetchQueue} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <NewCapabilityForm industries={industries} onCreated={fetchQueue} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Pending review ({queue.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && queue.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Loading…</div>
          ) : queue.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
              Inbox zero. No capabilities awaiting review.
            </div>
          ) : queue.map(it => (
            <QueueRow key={it.id} item={it} onAction={fetchQueue} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
