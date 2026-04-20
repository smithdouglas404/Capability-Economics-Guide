import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShoppingCart, Store } from "lucide-react";

const API_BASE = "/api";

type Listing = {
  id: number;
  sellerId: number;
  sellerName: string | null;
  type: "report" | "service" | "template";
  title: string;
  description: string;
  priceCents: number;
  tags: string[];
  approvedAt: string | null;
};

const fmtMoney = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/marketplace/listings`, { credentials: "include" })
      .then(r => r.json())
      .then(j => setListings(j.listings ?? []))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-3xl flex items-center gap-2"><Store className="w-7 h-7 text-primary" /> Marketplace</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Curated research and reports authored by platform members.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-none">
            <Link href="/marketplace/my-purchases">My library</Link>
          </Button>
          <Button asChild className="rounded-none">
            <Link href="/marketplace/sell">Sell your research</Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin" />
      ) : listings.length === 0 ? (
        <Card className="rounded-none">
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            No listings yet. Be the first to publish research.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.map(l => (
            <Link key={l.id} href={`/marketplace/listings/${l.id}`}>
              <Card className="rounded-none cursor-pointer hover:border-primary transition-colors h-full">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{l.type}</div>
                    <h3 className="font-serif text-lg mb-2">{l.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-3">{l.description}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{l.sellerName ?? "Author"}</span>
                    <span className="font-mono font-semibold">{fmtMoney(l.priceCents)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
