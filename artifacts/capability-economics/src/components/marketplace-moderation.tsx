import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Store, XCircle } from "lucide-react";

const API_BASE = "/api";

type Row = {
  listing: {
    id: number;
    title: string;
    description: string;
    priceCents: number;
    status: "pending_review" | "rejected" | "approved" | "archived" | "draft";
    fileOriginalName: string | null;
    fileSizeBytes: number | null;
    rejectionReason: string | null;
    createdAt: string;
  };
  seller: { displayName: string | null; email: string | null; userId: string } | null;
};

export default function MarketplaceModeration() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/marketplace/listings/pending`, { credentials: "include" });
      if (res.ok) {
        const j = await res.json() as { listings: Row[] };
        setRows(j.listings ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const approve = async (id: number) => {
    setBusy(`approve-${id}`);
    try {
      const res = await fetch(`${API_BASE}/admin/marketplace/listings/${id}/approve`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) { alert((e as Error).message); } finally { setBusy(null); }
  };

  const reject = async (id: number) => {
    const reason = rejectReason[id] ?? "Does not meet publishing guidelines";
    setBusy(`reject-${id}`);
    try {
      const res = await fetch(`${API_BASE}/admin/marketplace/listings/${id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) { alert((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <Card className="rounded-none">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Store className="w-5 h-5" /> Marketplace Moderation
          <span className="text-sm font-normal text-muted-foreground ml-2">
            {rows.length} pending / recently rejected
          </span>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No listings awaiting review.</div>
        ) : (
          <ul className="divide-y">
            {rows.map(({ listing, seller }) => (
              <li key={listing.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1">
                    <div className="font-medium">{listing.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {seller?.displayName ?? seller?.email ?? seller?.userId.slice(0, 12)}
                      {" · "}${(listing.priceCents / 100).toFixed(2)}
                      {listing.fileOriginalName && ` · ${listing.fileOriginalName}`}
                      {listing.fileSizeBytes && ` · ${(listing.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                    listing.status === "pending_review"
                      ? "bg-amber-500/10 text-amber-700 border border-amber-500/20"
                      : "bg-red-500/10 text-red-700 border border-red-500/20"
                  }`}>
                    <ShieldCheck className="w-3 h-3" /> {listing.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3">{listing.description}</p>
                {listing.rejectionReason && (
                  <div className="text-xs text-red-700 bg-red-50 dark:bg-red-950/30 px-2 py-1 rounded">
                    Previous rejection: {listing.rejectionReason}
                  </div>
                )}
                {listing.status === "pending_review" && (
                  <div className="flex flex-col md:flex-row gap-2 pt-2">
                    <Input
                      placeholder="Rejection reason (only used for reject)"
                      value={rejectReason[listing.id] ?? ""}
                      onChange={e => setRejectReason(r => ({ ...r, [listing.id]: e.target.value }))}
                      className="rounded-none flex-1"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-none border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => approve(listing.id)}
                        disabled={busy === `approve-${listing.id}`}
                      >
                        {busy === `approve-${listing.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        <span className="ml-1">Approve</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-none border-red-300 text-red-700 hover:bg-red-50"
                        onClick={() => reject(listing.id)}
                        disabled={busy === `reject-${listing.id}`}
                      >
                        {busy === `reject-${listing.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                        <span className="ml-1">Reject</span>
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
