import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RefreshCw, Copy, ExternalLink, ShieldCheck } from "lucide-react";

interface SignupRequest {
  id: number;
  email: string;
  name: string;
  organization: string;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  inviteToken: string | null;
  inviteTokenExpiresAt: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  completedSignupAt: string | null;
  completedSignupUserId: string | null;
}

const TABS = ["pending", "approved", "rejected", "all"] as const;
type Tab = (typeof TABS)[number];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/sign-up?invite=${encodeURIComponent(token)}`;
}

export default function AdminPlatformSignups() {
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<SignupRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const url = tab === "all" ? "/api/admin/platform-signups" : `/api/admin/platform-signups?status=${tab}`;
      const res = await fetch(url, { credentials: "include" });
      const json = (await res.json()) as SignupRequest[];
      setRows(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const approve = async (id: number) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/platform-signups/${id}/approve`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Approval failed: ${err.error ?? res.statusText}`);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: number) => {
    const reason = window.prompt("Reason for rejection? (optional, shown to admin only)", "") ?? "";
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/platform-signups/${id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Rejection failed: ${err.error ?? res.statusText}`);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const copyInvite = async (row: SignupRequest) => {
    if (!row.inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(row.inviteToken));
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt("Copy the invite link:", inviteUrl(row.inviteToken));
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl tracking-tight flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-600" />
            Platform sign-up requests
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            Human-in-the-loop approval queue for the Platform tier. Approving generates a one-time
            invite link (14-day expiry) that you copy and send to the requester. After they finish
            signing up, KYC still applies before they can check out.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="rounded-none">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <div className="flex items-center gap-2 border-b border-border">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] border-b-2 transition-colors ${
              tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
            {t !== "all" && counts[t] > 0 && (
              <Badge variant="secondary" className="ml-2 rounded-full px-2">{counts[t]}</Badge>
            )}
          </button>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground italic">
            No {tab === "all" ? "" : tab} requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map(row => (
            <Card key={row.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                      {row.name}
                      <span className="font-mono text-xs text-muted-foreground">&lt;{row.email}&gt;</span>
                      <StatusPill status={row.status} />
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{row.organization}</p>
                  </div>
                  <div className="text-right font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    <div>Requested {formatDate(row.requestedAt)}</div>
                    {row.decidedAt && <div>Decided {formatDate(row.decidedAt)}</div>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {row.message && (
                  <div className="text-sm text-foreground/80 leading-relaxed border-l-2 border-border pl-3 italic">
                    "{row.message}"
                  </div>
                )}

                {row.status === "pending" && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="rounded-none"
                      disabled={busyId === row.id}
                      onClick={() => approve(row.id)}
                      data-testid={`button-approve-${row.id}`}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-none"
                      disabled={busyId === row.id}
                      onClick={() => reject(row.id)}
                      data-testid={`button-reject-${row.id}`}
                    >
                      <XCircle className="w-4 h-4 mr-1.5" />
                      Reject
                    </Button>
                  </div>
                )}

                {row.status === "approved" && row.inviteToken && (
                  <div className="space-y-2 p-3 bg-emerald-500/[0.06] border border-emerald-500/20">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
                      Invite link — copy and send to {row.email}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="flex-1 min-w-[20rem] text-xs font-mono bg-background border border-border px-2 py-1.5 overflow-x-auto whitespace-nowrap">
                        {inviteUrl(row.inviteToken)}
                      </code>
                      <Button size="sm" variant="outline" className="rounded-none" onClick={() => copyInvite(row)}>
                        <Copy className="w-3.5 h-3.5 mr-1.5" />
                        {copiedId === row.id ? "Copied" : "Copy"}
                      </Button>
                      <a href={inviteUrl(row.inviteToken)} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost" className="rounded-none">
                          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                          Preview
                        </Button>
                      </a>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      Expires {formatDate(row.inviteTokenExpiresAt)}
                      {row.completedSignupAt && ` · Consumed ${formatDate(row.completedSignupAt)}`}
                    </div>
                  </div>
                )}

                {row.status === "rejected" && row.rejectionReason && (
                  <div className="text-sm text-muted-foreground italic">
                    Reason: {row.rejectionReason}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SignupRequest["status"] }) {
  const styles: Record<SignupRequest["status"], string> = {
    pending: "bg-amber-500/15 text-amber-600 border-amber-500/40",
    approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/40",
    rejected: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${styles[status]}`}>
      {status}
    </Badge>
  );
}
