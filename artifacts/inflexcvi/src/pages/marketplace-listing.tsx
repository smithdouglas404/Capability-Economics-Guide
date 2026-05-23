import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Loader2, ShoppingCart, Sparkles, BadgeCheck, Star, Store, Globe, Users2 } from "lucide-react";
import { SyntheticAgentBadge, isSyntheticAgent, personaDisplayForClerkId } from "@/components/synthetic-agent-badge";
import { MarketplaceReviews } from "@/components/marketplace-reviews";

type RelatedListing = {
  id: number;
  sellerName: string | null;
  type: string;
  title: string;
  description: string;
  priceCents: number;
  tags: string[];
  featured: boolean;
  coPurchaseCount: number;
  tagOverlap: number;
};

/**
 * "Buyers of X also bought Y" — horizontal-scroll strip of small listing
 * cards rendered below the main listing. Joins marketplace_purchases with
 * marketplace_listings server-side; ranked by co-purchase count first, then
 * shared-tag overlap. Hidden entirely when no related items.
 */
function CoPurchasedStrip({ listingId }: { listingId: number }) {
  const [related, setRelated] = useState<RelatedListing[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/marketplace/co-purchased-with/${listingId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j?.related) setRelated(j.related); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listingId]);

  if (loading) return null;
  if (!related || related.length === 0) return null;

  return (
    <Card className="rounded-none mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-base flex items-center gap-2">
          <Users2 className="w-4 h-4 text-primary" />
          Buyers of this also bought
        </CardTitle>
        <p className="text-xs text-muted-foreground italic">
          Ranked by shared buyers and matching capability tags.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {related.map(r => (
            <Link key={r.id} href={`/marketplace/listings/${r.id}`} className="shrink-0 snap-start" style={{ width: 230 }}>
              <Card className={`rounded-none cursor-pointer hover:border-primary transition-colors h-full ${r.featured ? "ring-1 ring-amber-500/40" : ""}`}>
                <CardContent className="p-3 flex flex-col h-full">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Badge variant="outline" className="rounded-none text-[9px] uppercase tracking-wider">{r.type}</Badge>
                    {r.coPurchaseCount > 0 && (
                      <span className="text-[9px] uppercase tracking-wider text-primary font-mono">
                        {r.coPurchaseCount} co-buyer{r.coPurchaseCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {r.coPurchaseCount === 0 && r.tagOverlap > 0 && (
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">
                        {r.tagOverlap} shared tag{r.tagOverlap === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <h4 className="font-serif text-sm mb-1.5 line-clamp-2">{r.title}</h4>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 flex-1">{r.description}</p>
                  <div className="mt-2 pt-2 border-t flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground truncate">{r.sellerName ?? "Author"}</span>
                    <span className="font-mono text-xs font-semibold">${(r.priceCents / 100).toFixed(0)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

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
      <CoPurchasedStrip listingId={listing.id} />
      <MarketplaceReviews listingId={listing.id} />
    </div>
  );
}
