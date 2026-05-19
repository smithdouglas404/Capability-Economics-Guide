import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RefreshCw, FileSearch, Scale } from "lucide-react";

interface RegulationProposed {
  id: number;
  name: string;
  shortCode: string;
  description: string | null;
  jurisdiction: string;
  effectiveDate: string | null;
  industries: number[];
  proposedBy: string;
  proposedAt: string;
  sourceUrl: string | null;
  sourceCitation: string | null;
  verificationNotes: string | null;
  reviewStatus: string;
  reviewerNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  promotedToLiveId: number | null;
}

interface RequirementProposed {
  id: number;
  regulationId: number;
  capabilityId: number;
  requiredMaturity: number;
  priority: string;
  evidenceNotes: string | null;
  article: string | null;
  proposedBy: string;
  proposedAt: string;
  sourceUrl: string | null;
  sourceCitation: string | null;
  verificationNotes: string | null;
  reviewStatus: string;
  reviewerNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

const STATUSES = ["pending", "approved", "rejected", "all"] as const;
type Status = (typeof STATUSES)[number];

export default function AdminReviewQueue() {
  const [tab, setTab] = useState<"regulations" | "requirements">("regulations");
  const [status, setStatus] = useState<Status>("pending");
  const [regs, setRegs] = useState<RegulationProposed[]>([]);
  const [reqs, setReqs] = useState<RequirementProposed[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, q] = await Promise.all([
        fetch(`/api/admin/review-queue/regulations?status=${status}`).then(r => r.json()),
        fetch(`/api/admin/review-queue/requirements?status=${status}`).then(r => r.json()),
      ]);
      setRegs(r.rows ?? []);
      setReqs(q.rows ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [status]);

  const act = async (kind: "regulations" | "requirements", id: number, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      const body = action === "reject"
        ? { reason: window.prompt("Reason for rejection? (optional)", "") ?? "" }
        : {};
      const res = await fetch(`/api/admin/review-queue/${kind}/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        window.alert(`${action} failed: ${j.error ?? res.statusText}`);
      } else {
        await load();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Curation</span>
          </div>
          <h1 className="font-serif text-4xl tracking-tight">Review Queue</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
            Content proposals from seed scripts, agents, and admin forms. Approving promotes the row
            to the live table; rejecting marks the proposal as declined and leaves live rows alone.
            Re-runs of the originating seed will re-propose unless rejected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {STATUSES.map(s => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
              {s}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b">
        <Button
          variant="ghost"
          className={`rounded-none border-b-2 ${tab === "regulations" ? "border-accent" : "border-transparent"}`}
          onClick={() => setTab("regulations")}
        >
          <Scale className="w-4 h-4 mr-1" /> Regulations ({regs.length})
        </Button>
        <Button
          variant="ghost"
          className={`rounded-none border-b-2 ${tab === "requirements" ? "border-accent" : "border-transparent"}`}
          onClick={() => setTab("requirements")}
        >
          <FileSearch className="w-4 h-4 mr-1" /> Requirement Mappings ({reqs.length})
        </Button>
      </div>

      {tab === "regulations" ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Regulation Proposals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2">Code</th>
                    <th className="text-left">Name</th>
                    <th className="text-left">Jurisdiction</th>
                    <th className="text-left">Industries</th>
                    <th className="text-left">Proposed By</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {regs.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 font-mono">{r.shortCode}</td>
                      <td>
                        {r.name}
                        {r.verificationNotes && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 max-w-md truncate" title={r.verificationNotes}>
                            {r.verificationNotes}
                          </div>
                        )}
                      </td>
                      <td className="text-xs">{r.jurisdiction}</td>
                      <td className="text-xs">{r.industries?.length ?? 0}</td>
                      <td className="text-xs font-mono text-muted-foreground">{r.proposedBy}</td>
                      <td>
                        <Badge variant={r.reviewStatus === "pending" ? "outline" : r.reviewStatus === "approved" ? "secondary" : "destructive"}>
                          {r.reviewStatus}
                        </Badge>
                      </td>
                      <td className="text-right">
                        {r.reviewStatus === "pending" || r.reviewStatus === "needs-edit" ? (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="default" onClick={() => act("regulations", r.id, "approve")} disabled={busyId === r.id}>
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => act("regulations", r.id, "reject")} disabled={busyId === r.id}>
                              <XCircle className="w-3 h-3 mr-1" /> Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {r.reviewedBy ? `by ${r.reviewedBy}` : ""}
                            {r.reviewedAt ? ` · ${new Date(r.reviewedAt).toLocaleDateString()}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {regs.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No regulation proposals in this status.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">Requirement Mapping Proposals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2">Reg #</th>
                    <th className="text-left">Cap #</th>
                    <th className="text-left">Required @</th>
                    <th className="text-left">Priority</th>
                    <th className="text-left">Article</th>
                    <th className="text-left">Proposed By</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reqs.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 font-mono text-xs">{r.regulationId}</td>
                      <td className="font-mono text-xs">{r.capabilityId}</td>
                      <td className="text-xs tabular-nums">{r.requiredMaturity}</td>
                      <td><Badge variant="outline" className="text-[10px]">{r.priority}</Badge></td>
                      <td className="text-xs font-mono">{r.article ?? ""}</td>
                      <td className="text-xs font-mono text-muted-foreground">{r.proposedBy}</td>
                      <td>
                        <Badge variant={r.reviewStatus === "pending" ? "outline" : r.reviewStatus === "approved" ? "secondary" : "destructive"}>
                          {r.reviewStatus}
                        </Badge>
                      </td>
                      <td className="text-right">
                        {r.reviewStatus === "pending" || r.reviewStatus === "needs-edit" ? (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="default" onClick={() => act("requirements", r.id, "approve")} disabled={busyId === r.id}>
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => act("requirements", r.id, "reject")} disabled={busyId === r.id}>
                              <XCircle className="w-3 h-3 mr-1" /> Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {r.reviewedBy ? `by ${r.reviewedBy}` : ""}
                            {r.reviewedAt ? ` · ${new Date(r.reviewedAt).toLocaleDateString()}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {reqs.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No requirement proposals in this status.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
