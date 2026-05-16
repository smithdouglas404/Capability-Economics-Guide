import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Loader2, ShoppingCart, Sparkles, BadgeCheck, Star, Store, Globe } from "lucide-react";
import { SyntheticAgentBadge, isSyntheticAgent, personaDisplayForClerkId } from "@/components/synthetic-agent-badge";

const API_BASE = "/api";

type SellerTier = "open" | "analyst" | "featured";

type Listing = {
  id: number;
  type: string;
  title: string;
  description: string;
  priceCents: number;
  tags: string[];
  status: string;
  featured: boolean;
  featuredUntil: string | null;
  fileKey: string | null;
  previewFileKey: string | null;
};

type Seller = {
  userId?: string | null;
  displayName: string | null;
  email: string | null;
  tier: SellerTier | null;
  bio: string | null;
  websiteUrl: string | null;
};

const TIER_LABEL: Record<SellerTier, string> = {
  open: "Open",
  analyst: "Verified Analyst",
  featured: "Featured Author",
};
const TIER_TONE: Record<SellerTier, string> = {
  open: "bg-muted text-muted-foreground border-border/60",
  analyst: "bg-primary/10 text-primary border-primary/30",
  featured: "bg-amber-500/15 text-amber-500 border-amber-500/40",
};
const TIER_ICON: Record<SellerTier, typeof Sparkles> = {
  open: Store,
  analyst: BadgeCheck,
  featured: Star,
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

      <Card className={`rounded-none ${listing.featured ? "ring-1 ring-amber-500/40" : ""}`}>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge variant="outline" className="rounded-none text-[10px] uppercase tracking-wider">{listing.type}</Badge>
            {listing.featured && (
              <Badge variant="outline" className="rounded-none text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/40 inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Featured
              </Badge>
            )}
          </div>
          <CardTitle className="font-serif text-3xl">{listing.title}</CardTitle>
          {seller?.displayName && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mt-1">
              <span>by {seller.displayName}</span>
              {isSyntheticAgent(seller.userId) && (
                <SyntheticAgentBadge personaDisplay={personaDisplayForClerkId(seller.userId)} size="sm" />
              )}
              {seller.tier && seller.tier !== "open" && (() => {
                const TIcon = TIER_ICON[seller.tier];
                return (
                  <Badge variant="outline" className={`rounded-none text-[10px] uppercase tracking-wider inline-flex items-center gap-1 ${TIER_TONE[seller.tier]}`}>
                    <TIcon className="w-3 h-3" />
                    {TIER_LABEL[seller.tier]}
                  </Badge>
                );
              })()}
              {seller.websiteUrl && (
                <a href={seller.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                  <Globe className="w-3 h-3" />
                  Website
                </a>
              )}
            </div>
          )}
          {seller?.bio && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{seller.bio}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="whitespace-pre-wrap leading-relaxed">{listing.description}</div>

          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {listing.tags.map(t => (
                <span key={t} className="px-2 py-0.5 text-xs bg-muted rounded-none">{t}</span>
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
