import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle, Loader2, Clock, AlertTriangle } from "lucide-react";
import { AdminPageShell } from "@/components/admin-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

/**
 * Agent Proposal Review — admin queue for every mutating action the
 * autonomous Letta agent wants to take. The agent can never write to
 * canonical platform data directly; every proposed flag, rule change,
 * or industry-prior update lands here for human approval.
 *
 * Reads /api/admin/agent/proposals, then approve/reject via the
 * matching POST routes. Auth: X-Admin-Key header from localStorage
 * (same pattern as other admin pages).
 */

type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "expired";

interface Proposal {
  id: number;
  agentRunId: number | null;
  proposalType: string;
  targetEntity: string;
  payload: Record<string, unknown>;
  agentRationale: string | null;
  status: ProposalStatus;
  proposedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  appliedAt: string | null;
  expiresAt: string;
  createdAt: string;
  qualityScore?: number;
  qualityBreakdown?: {
    sourceDiversity: number;
    triangulationConfidence: number;
    hasCorroboration: boolean;
  };
}

type SortMode = "quality" | "recent";

/**
 * Colour bucketing for the quality badge — matches the rest of the admin
 * surface's amber→emerald gradient so a glance tells you triage priority.
 */
function qualityBadgeClass(score: number | undefined): string {
  if (score === undefined) return "bg-muted text-muted-foreground border-border/40";
  if (score >= 70) return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
  if (score >= 40) return "bg-sky-500/15 text-sky-700 border-sky-500/30";
  if (score >= 20) return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-rose-500/15 text-rose-600 border-rose-500/30";
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

const STATUS_COLORS: Record<ProposalStatus, string> = {
  pending: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  approved: "bg-sky-500/15 text-sky-700 border-sky-500/30",
  applied: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  expired: "bg-muted text-muted-foreground border-border/40",
};

const TYPE_LABELS: Record<string, string> = {
  capability_flag: "Capability Flag",
  economic_rule_change: "Economic Rule Change",
  industry_prior_update: "Industry Prior Update",
};

export default function AdminAgentProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ProposalStatus>("pending");
  const [sortMode, setSortMode] = useState<SortMode>("quality");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({});
  const [approveNotes, setApproveNotes] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/agent/proposals?status=${filterStatus}&limit=100&sort=${sortMode}`, {
        headers: adminHeaders(),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      setProposals(data.proposals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filterStatus, sortMode]);

  async function approve(p: Proposal) {
    setPendingActionId(p.id);
    try {
      const res = await fetch(`/api/admin/agent/proposals/${p.id}/approve`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ reviewNotes: approveNotes[p.id] || null }),
      });
      if (!res.ok) {
        const body = await res.text();
        alert(`Approve failed: ${body}`);
        return;
      }
      const data = await res.json();
      alert(`Approved — ${data.summary}`);
      load();
    } catch (err) {
      alert(`Approve failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setPendingActionId(null);
    }
  }

  async function reject(p: Proposal) {
    const notes = rejectNotes[p.id];
    if (!notes || notes.trim().length === 0) {
      alert("reviewNotes is required when rejecting — explain why.");
      return;
    }
    setPendingActionId(p.id);
    try {
      const res = await fetch(`/api/admin/agent/proposals/${p.id}/reject`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ reviewNotes: notes }),
      });
      if (!res.ok) {
        const body = await res.text();
        alert(`Reject failed: ${body}`);
        return;
      }
      load();
    } catch (err) {
      alert(`Reject failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setPendingActionId(null);
    }
  }

  async function expireStale() {
    if (!confirm("Expire all proposals past their 30-day window?")) return;
    try {
      const res = await fetch("/api/admin/agent/proposals/expire-stale", { method: "POST", headers: adminHeaders() });
      const data = await res.json();
      alert(`Expired ${data.expired} stale proposals.`);
      load();
    } catch (err) {
      alert(`Expire-stale failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return (
    <AdminPageShell
      title="Agent Proposal Queue"
      description="Review and approve every mutating action the Letta agent proposes. Nothing in here has been applied to canonical data yet."
      actions={
        <>
          <Button variant="outline" size="sm" onClick={expireStale} className="rounded-none">
            <Clock className="h-4 w-4 mr-2" /> Expire stale
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-none">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </>
      }
    >
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        {(["pending", "applied", "rejected", "expired"] as ProposalStatus[]).map(s => (
          <Button
            key={s}
            variant={filterStatus === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterStatus(s)}
          >
            {s}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          <Button
            variant={sortMode === "quality" ? "default" : "outline"}
            size="sm"
            onClick={() => setSortMode("quality")}
            data-testid="button-sort-quality"
          >
            Highest quality first
          </Button>
          <Button
            variant={sortMode === "recent" ? "default" : "outline"}
            size="sm"
            onClick={() => setSortMode("recent")}
            data-testid="button-sort-recent"
          >
            Most recent
          </Button>
        </div>
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

      {proposals && proposals.length === 0 && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No <strong>{filterStatus}</strong> proposals. The agent hasn&apos;t queued any actions matching this filter.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {proposals?.map(p => (
          <Card key={p.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="outline" className={STATUS_COLORS[p.status]}>{p.status}</Badge>
                    <Badge
                      variant="outline"
                      className={qualityBadgeClass(p.qualityScore)}
                      title={p.qualityBreakdown
                        ? `Sources: ${p.qualityBreakdown.sourceDiversity} · Triangulation: ${(p.qualityBreakdown.triangulationConfidence * 100).toFixed(0)}% · ${p.qualityBreakdown.hasCorroboration ? "Corroborated" : "Single-source"}`
                        : "No quality breakdown available"}
                      data-testid={`badge-quality-${p.id}`}
                    >
                      Quality {p.qualityScore ?? "—"}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">#{p.id}</span>
                    {p.agentRunId && (
                      <span className="font-mono text-xs text-muted-foreground">run #{p.agentRunId}</span>
                    )}
                  </div>
                  <CardTitle className="text-lg">
                    {TYPE_LABELS[p.proposalType] ?? p.proposalType}
                  </CardTitle>
                  <div className="text-sm text-muted-foreground mt-1">
                    {p.targetEntity} · proposed by <span className="font-mono">{p.proposedBy}</span> · {new Date(p.createdAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                >
                  {expandedId === p.id ? "Collapse" : "Inspect"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {expandedId === p.id && (
                <>
                  <div className="mb-3">
                    <div className="text-sm font-semibold mb-1">Payload</div>
                    <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto">
                      {JSON.stringify(p.payload, null, 2)}
                    </pre>
                  </div>
                  {p.agentRationale && (
                    <div className="mb-3">
                      <div className="text-sm font-semibold mb-1">Agent rationale</div>
                      <div className="text-sm bg-muted/30 p-3 rounded whitespace-pre-wrap">{p.agentRationale}</div>
                    </div>
                  )}
                  {p.reviewNotes && (
                    <div className="mb-3">
                      <div className="text-sm font-semibold mb-1">Review notes</div>
                      <div className="text-sm bg-muted/30 p-3 rounded whitespace-pre-wrap">{p.reviewNotes}</div>
                      {p.reviewedAt && (
                        <div className="text-xs text-muted-foreground mt-1">
                          By {p.reviewedBy ?? "unknown"} on {new Date(p.reviewedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {p.status === "pending" && (
                <div className="space-y-3 mt-3 border-t pt-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Approve notes (optional)</label>
                    <Textarea
                      value={approveNotes[p.id] ?? ""}
                      onChange={e => setApproveNotes(prev => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Optional context for the audit trail"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Reject notes (required to reject)</label>
                    <Textarea
                      value={rejectNotes[p.id] ?? ""}
                      onChange={e => setRejectNotes(prev => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Why is the agent's reasoning wrong here?"
                      rows={2}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => reject(p)}
                      disabled={pendingActionId === p.id || !rejectNotes[p.id]?.trim()}
                    >
                      {pendingActionId === p.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                      Reject
                    </Button>
                    <Button
                      onClick={() => approve(p)}
                      disabled={pendingActionId === p.id}
                    >
                      {pendingActionId === p.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                      Approve & apply
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AdminPageShell>
  );
}
