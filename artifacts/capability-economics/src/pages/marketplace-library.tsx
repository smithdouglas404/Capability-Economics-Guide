import { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2 } from "lucide-react";
import { MarketplaceNav } from "@/components/marketplace-nav";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

type Purchase = {
  id: number;
  listingId: number;
  priceCents: number;
  status: "pending" | "paid" | "refunded" | "failed";
  purchasedAt: string | null;
  refundedAt: string | null;
  downloadCount: number;
};

type Listing = { id: number; title: string } | null;

type Row = { purchase: Purchase; listing: Listing };

const fmtMoney = (c: number) => `$${(c / 100).toFixed(2)}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

export default function MarketplaceLibraryPage() {
  const { user, isLoaded } = useUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/marketplace/my-purchases`, { credentials: "include" });
      if (res.ok) {
        const j = await res.json() as { purchases: Row[] };
        setRows(j.purchases ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <MobileNotice />
      <MarketplaceNav />
      {!isLoaded ? (
        <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : !user ? (
        <div className="p-12 text-center text-muted-foreground">Sign in to view your library.</div>
      ) : (
      <>
      <h1 className="font-serif text-3xl flex items-center gap-2 mb-2"><FileText className="w-7 h-7 text-primary" /> Your library</h1>
      <p className="text-muted-foreground text-sm mb-6">Reports you've purchased. Downloads are watermarked with your email.</p>

      <Card className="rounded-none">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No purchases yet.</div>
          ) : (
            <ul className="divide-y">
              {rows.map(({ purchase, listing }) => (
                <li key={purchase.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{listing?.title ?? "(deleted listing)"}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtMoney(purchase.priceCents)}
                      {" · "}{purchase.status}
                      {purchase.purchasedAt && ` · ${fmtDate(purchase.purchasedAt)}`}
                      {" · "}downloads: {purchase.downloadCount}
                    </div>
                    {purchase.refundedAt && <div className="text-xs text-red-700">Refunded {fmtDate(purchase.refundedAt)}</div>}
                  </div>
                  {purchase.status === "paid" && !purchase.refundedAt && (
                    <Button asChild variant="outline" className="rounded-none">
                      <a href={`${API_BASE}/marketplace/purchases/${purchase.id}/download`} target="_blank" rel="noopener">
                        <Download className="w-4 h-4" />
                        <span className="ml-2">Download</span>
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
