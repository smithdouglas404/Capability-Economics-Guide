import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Loader2, ShoppingCart } from "lucide-react";

const API_BASE = "/api";

type Listing = {
  id: number;
  type: string;
  title: string;
  description: string;
  priceCents: number;
  tags: string[];
  status: string;
  fileKey: string | null;
  previewFileKey: string | null;
};

type Seller = {
  displayName: string | null;
  email: string | null;
};

const fmtMoney = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function MarketplaceListingPage() {
  const [, params] = useRoute("/marketplace/listings/:id");
  const id = params?.id;

  const [listing, setListing] = useState<Listing | null>(null);
  const [seller, setSeller] = useState<Seller | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/marketplace/listings/${id}`, { credentials: "include" })
      .then(r => r.json())
      .then(j => { setListing(j.listing); setSeller(j.seller); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const buy = async () => {
    if (!listing) return;
    setBuying(true);
    try {
      const res = await fetch(`${API_BASE}/marketplace/listings/${listing.id}/checkout`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { checkoutUrl: string };
      window.location.href = json.checkoutUrl;
    } catch (e) {
      alert((e as Error).message);
      setBuying(false);
    }
  };

  if (loading) return <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  if (!listing) return <div className="p-12 text-center text-muted-foreground">Listing not found.</div>;

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/marketplace"><ArrowLeft className="w-4 h-4" /> <span className="ml-1">All listings</span></Link>
      </Button>

      <Card className="rounded-none">
        <CardHeader>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{listing.type}</div>
          <CardTitle className="font-serif text-3xl">{listing.title}</CardTitle>
          {seller?.displayName && <div className="text-sm text-muted-foreground">by {seller.displayName}</div>}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="whitespace-pre-wrap leading-relaxed">{listing.description}</div>

          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {listing.tags.map(t => (
                <span key={t} className="px-2 py-0.5 text-xs bg-muted rounded-full">{t}</span>
              ))}
            </div>
          )}

          <div className="border-t pt-4 flex items-center justify-between flex-wrap gap-3">
            <span className="text-3xl font-mono font-bold">{fmtMoney(listing.priceCents)}</span>
            <div className="flex items-center gap-2">
              {listing.previewFileKey && (
                <Button asChild variant="outline" className="rounded-none">
                  <a href={`${API_BASE}/marketplace/listings/${listing.id}/preview.pdf`} target="_blank" rel="noopener">
                    <FileText className="w-4 h-4" />
                    <span className="ml-2">Free preview</span>
                  </a>
                </Button>
              )}
              <Button onClick={buy} disabled={buying || listing.status !== "approved"} className="rounded-none">
                {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                <span className="ml-2">Buy now</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
