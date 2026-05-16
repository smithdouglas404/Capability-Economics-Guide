import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Store, Sparkles, BadgeCheck, Star } from "lucide-react";
import { MarketplaceNav } from "@/components/marketplace-nav";
import { SyntheticAgentBadge, isSyntheticAgent, personaDisplayForClerkId } from "@/components/synthetic-agent-badge";

const API_BASE = "/api";

type SellerTier = "open" | "analyst" | "featured";

type Listing = {
  id: number;
  sellerId: number;
  sellerName: string | null;
  sellerTier: SellerTier | null;
  sellerUserId: string | null;
  type: "report" | "dataset" | "template" | "service";
  title: string;
  description: string;
  priceCents: number;
  tags: string[];
  featured: boolean;
  featuredUntil: string | null;
  approvedAt: string | null;
};

type Segment = "all" | "technology" | "insurance" | "healthcare";
type TypeFilter = "all" | "report" | "dataset" | "template" | "service";
type SortMode = "newest" | "price_asc" | "price_desc" | "featured";

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

const SEGMENT_LABELS: Record<Segment, string> = {
  all: "All",
  technology: "Technology",
  insurance: "Insurance",
  healthcare: "Healthcare",
};

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "All types",
  report: "Reports",
  dataset: "Datasets",
  template: "Templates",
  service: "Services",
};

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<Segment>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");

  useEffect(() => {
    fetch(`${API_BASE}/marketplace/listings`, { credentials: "include" })
      .then(r => r.json())
      .then(j => setListings(j.listings ?? []))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = listings.filter(l => {
      if (segment !== "all" && !l.tags.includes(segment)) return false;
      if (typeFilter !== "all" && l.type !== typeFilter) return false;
      if (q && !(l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q) || l.tags.some(t => t.toLowerCase().includes(q)))) return false;
      return true;
    });
    if (sort === "price_asc") out = [...out].sort((a, b) => a.priceCents - b.priceCents);
    else if (sort === "price_desc") out = [...out].sort((a, b) => b.priceCents - a.priceCents);
    else if (sort === "featured") out = [...out].sort((a, b) => Number(b.featured) - Number(a.featured));
    // "newest" = server order (already featured-first, then desc by approvedAt)
    return out;
  }, [listings, segment, typeFilter, query, sort]);

  return (
    <div className="container mx-auto px-4 py-6 sm:py-8 max-w-6xl">
      <MarketplaceNav />

      <div className="mb-6">
        <h1 className="font-serif text-2xl sm:text-3xl flex items-center gap-2"><Store className="w-6 h-6 sm:w-7 sm:h-7 text-primary" /> Marketplace</h1>
        <p className="text-muted-foreground text-sm mt-1">Curated research and reports authored by platform members.</p>
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SEGMENT_LABELS) as Segment[]).map(s => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`px-3 py-1.5 text-sm rounded-none border transition-colors ${
                segment === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:border-primary/50"
              }`}
            >
              {SEGMENT_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search title, description, or tag..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="rounded-none pl-9"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as TypeFilter)}
            className="h-9 px-3 text-sm border border-input bg-background rounded-none"
          >
            {(Object.keys(TYPE_LABELS) as TypeFilter[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            className="h-9 px-3 text-sm border border-input bg-background rounded-none"
          >
            <option value="newest">Newest</option>
            <option value="featured">Featured first</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
          </select>
        </div>
        <div className="text-xs text-muted-foreground">
          {loading ? "Loading..." : `${filtered.length} of ${listings.length} listing${listings.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin" />
      ) : filtered.length === 0 ? (
        <Card className="rounded-none">
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            {listings.length === 0
              ? "No listings yet. Be the first to publish research."
              : "No listings match your filters. Try broadening your search."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(l => {
            const tier: SellerTier = (l.sellerTier ?? "open");
            const TierIcon = TIER_ICON[tier];
            return (
              <Link key={l.id} href={`/marketplace/listings/${l.id}`}>
                <Card className={`rounded-none cursor-pointer hover:border-primary transition-colors h-full ${l.featured ? "ring-1 ring-amber-500/40" : ""}`}>
                  <CardContent className="p-5 flex flex-col h-full">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="rounded-none text-[10px] uppercase tracking-wider">
                        {l.type}
                      </Badge>
                      {l.featured && (
                        <Badge variant="outline" className="rounded-none text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/40 inline-flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Featured
                        </Badge>
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-serif text-lg mb-2">{l.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-3">{l.description}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate">{l.sellerName ?? "Author"}</span>
                        {isSyntheticAgent(l.sellerUserId) && (
                          <SyntheticAgentBadge personaDisplay={personaDisplayForClerkId(l.sellerUserId)} size="sm" />
                        )}
                        {tier !== "open" && (
                          <Badge variant="outline" className={`rounded-none text-[10px] uppercase tracking-wider inline-flex items-center gap-1 ${TIER_TONE[tier]}`}>
                            <TierIcon className="w-3 h-3" />
                            {TIER_LABEL[tier]}
                          </Badge>
                        )}
                      </div>
                      <span className="font-mono font-semibold">{fmtMoney(l.priceCents)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
