import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Store,
  Users,
  User as UserIcon,
  ShoppingBag,
  Package,
  TrendingUp,
  Loader2,
  ExternalLink,
  Sparkles,
  BadgeCheck,
  Star,
  Share2,
  DollarSign,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { MarketplaceNav } from "@/components/marketplace-nav";
import { useAuth, useUser } from "@clerk/react";

const API_BASE = "/api";

type Mode = "personal" | "team";

interface WorkspacePurchase {
  id: number;
  status: string;
  priceCents: number;
  buyerUserId: string;
  buyerClerkOrgId: string | null;
  purchasedAt: string | null;
  downloadCount: number;
  listing: { id: number; title: string; type: string } | null;
}

interface WorkspaceSeller {
  id: number;
  userId: string;
  clerkOrgId: string | null;
  displayName: string | null;
  tier: "open" | "analyst" | "featured";
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

interface WorkspaceListing {
  id: number;
  title: string;
  type: string;
  status: string;
  priceCents: number;
  featured: boolean;
  salesCount: number;
  grossCents: number;
  netCents: number;
  createdAt: string;
}

interface WorkspaceResp {
  mode: Mode;
  clerkOrgIds: string[];
  summary: {
    purchaseCount: number;
    paidPurchaseCount: number;
    totalSpentCents: number;
    listingCount: number;
    approvedListingCount: number;
    sellerCount: number;
    salesCount: number;
    grossSalesCents: number;
    netRevenueCents: number;
  };
  purchases: WorkspacePurchase[];
  sellers: WorkspaceSeller[];
  listings: WorkspaceListing[];
}

const TIER_LABEL: Record<WorkspaceSeller["tier"], string> = {
  open: "Open",
  analyst: "Verified Analyst",
  featured: "Featured Author",
};
const TIER_TONE: Record<WorkspaceSeller["tier"], string> = {
  open: "bg-muted text-muted-foreground border-border/60",
  analyst: "bg-primary/10 text-primary border-primary/30",
  featured: "bg-amber-500/15 text-amber-500 border-amber-500/40",
};
const TIER_ICON: Record<WorkspaceSeller["tier"], typeof Sparkles> = {
  open: Store,
  analyst: BadgeCheck,
  featured: Star,
};

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function StatCard({ label, value, sub, Icon }: { label: string; value: string | number; sub?: string; Icon: typeof Store }) {
  return (
    <Card className="rounded-none border-border/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        </div>
        <div className="font-mono text-2xl tabular-nums">{value}</div>
        {sub && <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function MarketplaceWorkspacePage() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [data, setData] = useState<WorkspaceResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scopeBusy, setScopeBusy] = useState(false);

  const authedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const token = await getToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
    });
  }, [getToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await authedFetch(`${API_BASE}/marketplace/workspace`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setData(await r.json() as WorkspaceResp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setLoading(false); return; }
    void load();
  }, [isLoaded, user, load]);

  async function setSellerScope(clerkOrgId: string | null) {
    setScopeBusy(true);
    try {
      const r = await authedFetch(`${API_BASE}/marketplace/workspace/sellers/me/scope`, {
        method: "POST",
        body: JSON.stringify({ clerkOrgId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scope change failed");
    } finally {
      setScopeBusy(false);
    }
  }

  const mySeller = useMemo(() => data?.sellers.find(s => s.userId === user?.id) ?? null, [data, user]);

  if (!isLoaded) {
    return <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  if (!user) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <h1 className="font-serif text-3xl tracking-tight mb-2">Marketplace workspace</h1>
        <p className="text-sm text-muted-foreground mb-4">Sign in to view your purchases, listings, and team marketplace activity.</p>
        <Link href="/sign-in"><Button>Sign in</Button></Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <Link href="/marketplace" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Marketplace
        </Link>
        <MarketplaceNav />
        <div className="flex items-center gap-2 mb-1 mt-4">
          {data?.mode === "team" ? <Users className="w-5 h-5 text-primary" /> : <UserIcon className="w-5 h-5 text-muted-foreground" />}
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
            {data?.mode === "team" ? `Team workspace · ${data.clerkOrgIds.length} org${data.clerkOrgIds.length === 1 ? "" : "s"}` : "Personal workspace"}
          </Badge>
        </div>
        <h1 className="font-serif text-3xl tracking-tight">Marketplace Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          {data?.mode === "team"
            ? "Purchases bought under your Clerk organization and listings sold under your team's seller account. Every org member sees the same view."
            : "Your personal marketplace activity. Promote your seller account to team-shared to let your Clerk organization members see and manage these together."}
        </p>
      </div>

      {err && <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-2 text-sm">{err}</div>}
      {loading && <div className="text-sm text-muted-foreground flex items-center gap-2 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

      {data && (
        <>
          {/* ── Summary stats ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Purchases" value={data.summary.paidPurchaseCount} sub={`${data.summary.purchaseCount} total`} Icon={ShoppingBag} />
            <StatCard label="Spent" value={fmtMoney(data.summary.totalSpentCents)} sub="paid purchases" Icon={DollarSign} />
            <StatCard label="Listings" value={data.summary.listingCount} sub={`${data.summary.approvedListingCount} approved`} Icon={Package} />
            <StatCard label="Net revenue" value={fmtMoney(data.summary.netRevenueCents)} sub={`${data.summary.salesCount} sales`} Icon={TrendingUp} />
          </div>

          {/* ── Seller account + tenancy scope ──────────────────────────── */}
          <Card className="rounded-none border-border/60">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-serif text-xl tracking-tight">Seller account</h2>
                </div>
                <Link href="/marketplace/sell"><Button size="sm" variant="outline" className="rounded-none">Open seller dashboard</Button></Link>
              </div>
              {!mySeller ? (
                <p className="text-sm text-muted-foreground">
                  You're not a seller yet. <Link href="/marketplace/sell" className="text-primary hover:underline">Start Stripe Connect onboarding</Link> to list reports, datasets, or templates.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{mySeller.displayName ?? `Seller #${mySeller.id}`}</span>
                    {(() => {
                      const TIcon = TIER_ICON[mySeller.tier];
                      return (
                        <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-1 ${TIER_TONE[mySeller.tier]}`}>
                          <TIcon className="w-3 h-3" />
                          {TIER_LABEL[mySeller.tier]}
                        </Badge>
                      );
                    })()}
                    <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${mySeller.payoutsEnabled ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" : "bg-amber-500/15 text-amber-500 border-amber-500/40"}`}>
                      {mySeller.payoutsEnabled ? "Payouts enabled" : "Stripe setup incomplete"}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1">
                      <Share2 className="w-3 h-3" />
                      Tenancy
                    </div>
                    {mySeller.clerkOrgId ? (
                      <>
                        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-primary/10 text-primary border-primary/30">
                          <Users className="w-3 h-3 mr-1 inline" />
                          Team-shared · {mySeller.clerkOrgId.slice(0, 12)}…
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => setSellerScope(null)} disabled={scopeBusy} className="rounded-none text-[11px] h-7">
                          Revert to personal
                        </Button>
                      </>
                    ) : (
                      <>
                        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                          <UserIcon className="w-3 h-3 mr-1 inline" />
                          Personal
                        </Badge>
                        {data.clerkOrgIds.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {data.clerkOrgIds.map(oid => (
                              <Button key={oid} size="sm" variant="outline" onClick={() => setSellerScope(oid)} disabled={scopeBusy} className="rounded-none text-[11px] h-7">
                                <Share2 className="w-3 h-3 mr-1" />
                                Share with {oid.slice(0, 10)}…
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <span className="font-mono text-[10px] text-muted-foreground">No Clerk orgs available to share with.</span>
                        )}
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground italic">
                    Sharing makes every member of your Clerk org see and manage this seller's listings, payouts, and analytics.
                    Payouts still flow to your single Stripe Connect account.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Listings ─────────────────────────────────────────────────── */}
          {data.listings.length > 0 && (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-0">
                <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <h2 className="font-serif text-xl tracking-tight">Listings ({data.listings.length})</h2>
                  </div>
                  <Link href="/marketplace/sell"><Button size="sm" variant="outline" className="rounded-none">New listing</Button></Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <th className="px-4 py-3">Title</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Price</th>
                        <th className="px-4 py-3 text-right">Sales</th>
                        <th className="px-4 py-3 text-right">Net</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.listings.map(l => (
                        <tr key={l.id} className="border-t border-border/40">
                          <td className="px-4 py-2 flex items-center gap-2">
                            {l.featured && <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />}
                            <Link href={`/marketplace/listings/${l.id}`} className="hover:underline font-medium">{l.title}</Link>
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{l.type}</td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${l.status === "approved" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" : l.status === "pending_review" ? "bg-amber-500/15 text-amber-500 border-amber-500/40" : "bg-muted text-muted-foreground border-border/60"}`}>
                              {l.status.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtMoney(l.priceCents)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{l.salesCount}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtMoney(l.netCents)}</td>
                          <td className="px-4 py-2 text-right">
                            <Link href={`/marketplace/listings/${l.id}`}>
                              <Button size="sm" variant="ghost" className="rounded-none h-7 px-2">
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Purchases ────────────────────────────────────────────────── */}
          <Card className="rounded-none border-border/60">
            <CardContent className="p-0">
              <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-serif text-xl tracking-tight">Purchases ({data.purchases.length})</h2>
                </div>
                <Link href="/marketplace"><Button size="sm" variant="outline" className="rounded-none">Browse marketplace</Button></Link>
              </div>
              {data.purchases.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No purchases yet. <Link href="/marketplace" className="text-primary hover:underline">Browse the marketplace</Link>.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <th className="px-4 py-3">Listing</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Buyer</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Price</th>
                        <th className="px-4 py-3 text-right">Downloads</th>
                        <th className="px-4 py-3">Purchased</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.purchases.map(p => (
                        <tr key={p.id} className="border-t border-border/40">
                          <td className="px-4 py-2">
                            {p.listing ? (
                              <Link href={`/marketplace/listings/${p.listing.id}`} className="hover:underline font-medium">{p.listing.title}</Link>
                            ) : (
                              <span className="text-muted-foreground italic">Listing removed</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{p.listing?.type ?? "—"}</td>
                          <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">
                            {p.buyerClerkOrgId ? <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> team</span> : <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" /> personal</span>}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${p.status === "paid" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" : p.status === "refunded" ? "bg-amber-500/15 text-amber-500 border-amber-500/40" : "bg-muted text-muted-foreground border-border/60"}`}>
                              {p.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{fmtMoney(p.priceCents)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{p.downloadCount}</td>
                          <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{p.purchasedAt ? new Date(p.purchasedAt).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Tenancy note ─────────────────────────────────────────────── */}
          <Card className="rounded-none border-border/60 bg-muted/20">
            <CardContent className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">SaaS multi-tenant note</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The marketplace workspace is a cloud-only feature. On-premise deployments fall back to per-user purchase / seller views.
                The shared-team scope (purchases visible across Clerk org members, team-owned seller accounts) only activates when{" "}
                <code className="font-mono bg-background px-1">CLERK_SECRET_KEY</code> is configured and the caller has at least one Clerk organization membership.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
