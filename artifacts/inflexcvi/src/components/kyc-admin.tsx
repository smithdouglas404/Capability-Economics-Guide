import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, RefreshCw, ExternalLink } from "lucide-react";

type KycRow = {
  id: number;
  userId: string;
  userEmail: string | null;
  kycLevel: string;
  tierSlug: string;
  status: string;
  emailVerified: string | null;
  idStatus: string | null;
  livenessStatus: string | null;
  amlStatus: string | null;
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  documentType: string | null;
  amlHits: number | null;
  declineReasons: string[] | null;
  createdAt: string;
  completedAt: string | null;
  idVerificationUrl: string | null;
};

function StatusPill({ s }: { s: string | null | undefined }) {
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const variant =
    s === "approved" || s === "Approved" || s === "verified" || s === "Clear" ? "bg-green-500/10 text-green-700 border-green-500/30" :
    s === "declined" || s === "Declined" || s === "failed" || s === "Hit" ? "bg-red-500/10 text-red-700 border-red-500/30" :
    s === "pending" || s === "Pending" ? "bg-amber-500/10 text-amber-700 border-amber-500/30" :
    "bg-muted text-muted-foreground border-border";
  return <span className={`px-2 py-0.5 rounded text-xs font-medium border ${variant}`}>{s}</span>;
}

export default function KycAdmin() {
  const [rows, setRows] = useState<KycRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "declined">("all");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/kyc/all");
      if (!r.ok) { setRows([]); return; }
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const filtered = (rows ?? []).filter(r => filter === "all" ? true : r.status === filter);
  const counts = (rows ?? []).reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5" /> KYC verifications
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Identity, liveness and AML screenings via Didit. Approvals are automated; this view is for audit and triage.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="button-kyc-refresh">
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-4">
          {(["all", "pending", "approved", "declined"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded-none border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"}`}
              data-testid={`button-kyc-filter-${f}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== "all" && counts[f] ? ` (${counts[f]})` : ""}
              {f === "all" && rows ? ` (${rows.length})` : ""}
            </button>
          ))}
        </div>

        {rows === null && <div className="text-sm text-muted-foreground py-6 text-center">Loading verifications…</div>}
        {rows && filtered.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No verifications match this filter.</div>}

        {filtered.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left p-2">User</th>
                  <th className="text-left p-2">Tier / Level</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Email</th>
                  <th className="text-left p-2">ID</th>
                  <th className="text-left p-2">Liveness</th>
                  <th className="text-left p-2">AML</th>
                  <th className="text-left p-2">Identity</th>
                  <th className="text-left p-2">When</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40" data-testid={`row-kyc-${r.id}`}>
                    <td className="p-2 align-top">
                      <div className="font-mono text-xs">{r.userId.slice(0, 14)}…</div>
                      {r.userEmail && <div className="text-xs text-muted-foreground">{r.userEmail}</div>}
                    </td>
                    <td className="p-2 align-top">
                      <Badge variant="outline" className="capitalize">{r.tierSlug}</Badge>
                      <div className="text-xs text-muted-foreground mt-1">{r.kycLevel}</div>
                    </td>
                    <td className="p-2 align-top"><StatusPill s={r.status} /></td>
                    <td className="p-2 align-top"><StatusPill s={r.emailVerified} /></td>
                    <td className="p-2 align-top"><StatusPill s={r.idStatus} /></td>
                    <td className="p-2 align-top"><StatusPill s={r.livenessStatus} /></td>
                    <td className="p-2 align-top">
                      <StatusPill s={r.amlStatus} />
                      {r.amlHits ? <div className="text-xs text-red-600 mt-1">{r.amlHits} hits</div> : null}
                    </td>
                    <td className="p-2 align-top">
                      {r.firstName ? (
                        <div>
                          <div className="text-xs">{r.firstName} {r.lastName}</div>
                          {r.nationality && <div className="text-xs text-muted-foreground">{r.nationality} · {r.documentType}</div>}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                      {r.idVerificationUrl && r.status === "pending" && (
                        <a href={r.idVerificationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary mt-1">
                          link <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                    <td className="p-2 align-top text-xs text-muted-foreground">
                      <div>{new Date(r.createdAt).toLocaleString()}</div>
                      {r.completedAt && <div>done {new Date(r.completedAt).toLocaleDateString()}</div>}
                      {r.declineReasons?.length ? (
                        <div className="text-xs text-red-600 mt-1">{r.declineReasons.join("; ")}</div>
                      ) : null}
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
