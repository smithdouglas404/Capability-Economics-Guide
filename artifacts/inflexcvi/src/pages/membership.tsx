import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bitcoin } from "lucide-react";
import { motion } from "framer-motion";

type Tier = {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  isContactSales: boolean;
  features: string[];
  ctaLabel: string;
  highlight: boolean;
};

function formatPrice(cents: number | null): string {
  if (cents === null) return "";
  if (cents % 100000 === 0) return `$${(cents / 100000).toFixed(0)}K`;
  if (cents >= 100000) return `$${(cents / 100).toLocaleString()}`;
  return `$${(cents / 100).toFixed(0)}`;
}

type CheckoutMethod = "card" | "crypto";

async function startCheckout(tier: Tier, billing: "monthly" | "annual", method: CheckoutMethod = "card"): Promise<void> {
  const monthly = tier.monthlyPriceCents ?? 0;
  const annual = tier.annualPriceCents ?? 0;
  const isFree = !tier.isContactSales && monthly === 0 && annual === 0;
  const cents = billing === "annual" ? tier.annualPriceCents : tier.monthlyPriceCents;

  if (tier.isContactSales) {
    window.location.href = `mailto:sales@inflexcvi.ai?subject=${encodeURIComponent(`Inquiry: ${tier.name}`)}`;
    return;
  }

  try {
    const kycRes = await fetch("/api/kyc/status");
    if (kycRes.ok) {
      const kyc = await kycRes.json() as {
        verified: boolean; kycLevel: string | null; highestApprovedLevel: string | null; configured: boolean;
        levels: Record<string, string>;
      };
      const requiredLevel = kyc.levels?.[tier.slug];
      const rank: Record<string, number> = { email: 0, identity: 1, biometric: 2, full: 3 };
      const userLevel = kyc.highestApprovedLevel;
      const hasLevel = userLevel ? (rank[userLevel] ?? -1) >= (rank[requiredLevel ?? "email"] ?? 0) : false;
      if (requiredLevel && !hasLevel) {
        if (!kyc.configured) {
          alert("Identity verification service is not configured yet. Please contact support to activate this tier.");
          return;
        }
        const proceed = window.confirm(
          `The ${tier.name} tier requires identity verification (${requiredLevel} level). Continue to verification?`,
        );
        if (!proceed) return;
        window.location.href = `/kyc?tierSlug=${encodeURIComponent(tier.slug)}&returnTo=${encodeURIComponent("/membership")}`;
        return;
      }
    } else if (kycRes.status === 401) {
      alert("Please sign in to start this tier.");
      return;
    }
  } catch {
    // fall through — server-side requireTier still gates protected features.
  }

  const promptMsg = isFree
    ? `Activate ${tier.name} membership.\n\nWho is this membership for? (your name or company)`
    : `Checkout: ${tier.name} (${billing}).\n\nWho is this membership for? (your name or company)`;
  const entityName = window.prompt(promptMsg, "");
  if (!entityName || !entityName.trim()) return;
  const entityType = /\b(inc|llc|corp|ltd|company|co\.)\b/i.test(entityName) ? "company" : "individual";

  try {
    if (isFree) {
      const res = await fetch("/api/me/membership/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tierId: tier.id,
          entityType,
          entityName: entityName.trim(),
          paymentMethod: "card",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) { alert("Please sign in to activate a membership."); return; }
        alert(`Could not activate: ${err.error ?? res.statusText}`);
        return;
      }
      alert(`${tier.name} activated. Welcome.`);
      window.location.href = "/membership?status=success";
      return;
    }

    if (cents === null || cents === 0) {
      alert(`${tier.name} is not available on a ${billing} plan. Try the other billing period.`);
      return;
    }

    const endpoint = method === "crypto" ? "/api/me/membership/crypto/start" : "/api/me/membership/checkout";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tierId: tier.id, billing, entityType, entityName: entityName.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) { alert("Please sign in to purchase a membership."); return; }
      if (res.status === 503 && method === "crypto") { alert("Crypto payments aren't configured yet. Try card instead, or contact support."); return; }
      alert(`Could not start checkout: ${err.error ?? res.statusText}`);
      return;
    }
    const json = await res.json() as { checkoutUrl?: string; invoiceUrl?: string };
    const url = json.invoiceUrl ?? json.checkoutUrl;
    if (url) {
      window.location.href = url;
    } else {
      alert("Checkout session created but no redirect URL was returned.");
    }
  } catch (e) {
    alert(`Checkout failed: ${(e as Error).message}`);
  }
}

function PriceDisplay({ tier, billing }: { tier: Tier; billing: "monthly" | "annual" }) {
  if (tier.isContactSales && billing === "monthly") {
    return (
      <div>
        <div className="font-mono text-3xl font-light tabular-nums tracking-tight">Custom</div>
        <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">Contact sales</div>
      </div>
    );
  }
  const cents = billing === "monthly" ? tier.monthlyPriceCents : tier.annualPriceCents;
  if (cents === null) {
    return (
      <div>
        <div className="font-mono text-3xl font-light tabular-nums tracking-tight text-muted-foreground">—</div>
        <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{billing === "monthly" ? "Annual only" : "Monthly only"}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-mono text-4xl font-light tabular-nums tracking-tight leading-none">
        {formatPrice(cents)}
      </div>
      <div className="font-sans text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-2">
        USD / {billing === "monthly" ? "month" : "year"}
      </div>
      {billing === "annual" && tier.monthlyPriceCents !== null && cents > 0 && (
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground mt-0.5">
          ≈ ${(cents / 100 / 12).toFixed(0)}/mo
        </div>
      )}
    </div>
  );
}

function TierRow({ tier, billing, index }: { tier: Tier; billing: "monthly" | "annual"; index: number }) {
  const [loading, setLoading] = useState<null | "card" | "crypto">(null);
  const onPurchase = async (method: "card" | "crypto" = "card") => {
    setLoading(method);
    try { await startCheckout(tier, billing, method); } finally { setLoading(null); }
  };
  const isFree = !tier.isContactSales && (tier.monthlyPriceCents ?? 0) === 0 && (tier.annualPriceCents ?? 0) === 0;
  const showCryptoButton = !isFree && !tier.isContactSales;
  const indexLabel = String(index + 1).padStart(2, "0");

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative ${tier.highlight ? "bg-accent/[0.06]" : ""}`}
    >
      {tier.highlight && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent" aria-hidden />
      )}
      <div className="grid lg:grid-cols-[80px_1fr_240px_240px] gap-x-8 gap-y-6 px-6 lg:px-10 py-10 border-t border-border/60">
        {/* Index + name */}
        <div className="lg:col-span-1">
          <div className="font-mono text-[11px] tabular-nums text-muted-foreground tracking-[0.18em] mb-1.5">
            {indexLabel}
          </div>
          {tier.highlight && (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
              Editor's choice
            </div>
          )}
        </div>

        {/* Description + features */}
        <div className="lg:col-span-1 max-w-2xl">
          <h3 className="font-serif text-3xl lg:text-[2.25rem] leading-[1.05] tracking-tight">
            {tier.name}
          </h3>
          <p className="font-serif italic text-base lg:text-lg text-foreground/70 mt-2 leading-relaxed">
            {tier.tagline}
          </p>
          <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
            {tier.description}
          </p>
          <ul className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {tier.features.slice(0, 6).map((f, i) => (
              <li key={i} className="text-[13px] text-foreground/85 leading-snug flex gap-2 before:content-['—'] before:text-muted-foreground/60 before:font-light">
                <span>{f}</span>
              </li>
            ))}
          </ul>
          {tier.features.length > 6 && (
            <details className="mt-3 group/more">
              <summary className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground cursor-pointer list-none flex items-center gap-1.5 select-none">
                <span>Show {tier.features.length - 6} more</span>
                <span className="transition-transform group-open/more:rotate-90">›</span>
              </summary>
              <ul className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {tier.features.slice(6).map((f, i) => (
                  <li key={i} className="text-[13px] text-foreground/85 leading-snug flex gap-2 before:content-['—'] before:text-muted-foreground/60 before:font-light">
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* Price */}
        <div className="lg:col-span-1 lg:border-l lg:border-border/60 lg:pl-8">
          <PriceDisplay tier={tier} billing={billing} />
        </div>

        {/* CTA */}
        <div className="lg:col-span-1 flex flex-col gap-2 lg:justify-start">
          <Button
            className={`w-full h-11 rounded-none font-sans text-[13px] tracking-wide uppercase ${
              tier.highlight ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""
            }`}
            variant={tier.highlight ? "default" : "outline"}
            data-testid={`button-purchase-${tier.slug}`}
            onClick={() => onPurchase("card")}
            disabled={loading !== null}
          >
            {loading === "card" ? "Redirecting…" : tier.ctaLabel}
          </Button>
          {showCryptoButton && (
            <button
              data-testid={`button-purchase-crypto-${tier.slug}`}
              onClick={() => onPurchase("crypto")}
              disabled={loading !== null}
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1.5 py-1 disabled:opacity-50"
            >
              <Bitcoin className="w-3 h-3" />
              {loading === "crypto" ? "Redirecting…" : "Or pay with crypto"}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Compute the maximum annual-billing savings across tiers as a percentage.
 * Returns null if no priced tier has both monthly and annual prices.
 * Replaces the hardcoded "save ~17%" badge (PLAN.md item #11).
 */
function computeMaxAnnualSavingsPct(tiers: Tier[] | null): number | null {
  if (!tiers) return null;
  let best = 0;
  for (const t of tiers) {
    const monthly = t.monthlyPriceCents ?? 0;
    const annual = t.annualPriceCents ?? 0;
    if (monthly > 0 && annual > 0) {
      const pct = ((monthly * 12 - annual) / (monthly * 12)) * 100;
      if (pct > best) best = pct;
    }
  }
  return best > 0 ? Math.round(best) : null;
}

export default function Membership() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");

  useEffect(() => {
    fetch("/api/membership/tiers")
      .then((r) => r.json())
      .then(setTiers)
      .catch(() => setTiers([]));
  }, []);

  const annualSavingsPct = computeMaxAnnualSavingsPct(tiers);

  return (
    <div className="min-h-screen bg-background">
      {/* Editorial header */}
      <header className="border-b border-border/60 bg-background">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-16 pb-12 lg:pt-24 lg:pb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="grid lg:grid-cols-[1fr_auto] gap-10 lg:gap-16 items-end"
          >
            <div>
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-5">
                Vol. I &nbsp;·&nbsp; Membership
              </div>
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-7xl leading-[0.95] tracking-tight">
                Choose how you<br />
                <span className="italic text-foreground/85">use the framework.</span>
              </h1>
            </div>
            <p className="font-serif text-lg lg:text-xl text-foreground/70 leading-relaxed max-w-md italic">
              From reading the index to running Inflexcvi on your own industries — four ways in.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-12 flex items-center gap-6 border-t border-border/60 pt-6"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Billed
            </div>
            <div className="inline-flex items-center font-mono text-[12px] uppercase tracking-[0.18em]">
              <button
                onClick={() => setBilling("monthly")}
                data-testid="button-billing-monthly"
                className={`pr-4 transition-colors ${
                  billing === "monthly" ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}
              >
                Monthly
              </button>
              <span className="text-muted-foreground/40">/</span>
              <button
                onClick={() => setBilling("annual")}
                data-testid="button-billing-annual"
                className={`pl-4 pr-3 transition-colors ${
                  billing === "annual" ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}
              >
                Annual
              </button>
              {billing === "annual" && annualSavingsPct !== null && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="ml-1 px-2 py-0.5 bg-accent/15 text-accent normal-case tracking-normal text-[10px] font-sans"
                >
                  save up to {annualSavingsPct}%
                </motion.span>
              )}
            </div>
          </motion.div>
        </div>
      </header>

      {/* Tier list */}
      <main className="max-w-7xl mx-auto">
        {tiers === null && (
          <div className="text-center text-muted-foreground py-16 sm:py-32 font-mono text-sm uppercase tracking-[0.18em]">
            Loading tiers…
          </div>
        )}
        {tiers && tiers.length === 0 && (
          <div className="text-center text-muted-foreground py-16 sm:py-32 font-mono text-sm uppercase tracking-[0.18em]">
            No tiers available
          </div>
        )}
        {tiers && tiers.length > 0 && (
          <div className="border-b border-border/60">
            {tiers.map((tier, i) => (
              <TierRow key={tier.id} tier={tier} billing={billing} index={i} />
            ))}
          </div>
        )}
      </main>

      {/* Credit packs for payg / paid users */}
      <CreditPacksSection />

      {/* Footer note */}
      <footer className="max-w-7xl mx-auto px-6 lg:px-10 py-12">
        <div className="grid lg:grid-cols-3 gap-8 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <div>
            <div className="text-foreground/80 mb-2">Pricing</div>
            <p className="normal-case tracking-normal font-sans text-sm leading-relaxed">
              All prices in USD. Annual plans billed once per year. Monthly plans cancel anytime.
            </p>
          </div>
          <div>
            <div className="text-foreground/80 mb-2">Identity</div>
            <p className="normal-case tracking-normal font-sans text-sm leading-relaxed">
              Higher tiers require identity verification through our KYC partner. You'll be guided through it at checkout.
            </p>
          </div>
          <div>
            <div className="text-foreground/80 mb-2">Enterprise</div>
            <p className="normal-case tracking-normal font-sans text-sm leading-relaxed">
              Procurement, security review, SSO, and custom industries supported on Platform.{" "}
              <a href="mailto:sales@inflexcvi.ai" className="underline underline-offset-2 hover:text-foreground">
                Talk to sales
              </a>.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

interface CreditPack {
  id: number;
  slug: string;
  displayName: string;
  description: string | null;
  priceCents: number;
  creditAmount: number;
  highlight: string | null;
}

function CreditPacksSection() {
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/credits/packs")
      .then(r => r.ok ? r.json() : [])
      .then((j: CreditPack[]) => setPacks(Array.isArray(j) ? j : []))
      .catch(() => setPacks([]));
  }, []);

  const buy = async (slug: string) => {
    setBuying(slug);
    setError(null);
    try {
      const res = await fetch("/api/credits/purchase", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packSlug: slug }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json() as { checkoutUrl?: string; newBalance?: number };
      if (j.checkoutUrl) {
        window.location.href = j.checkoutUrl;
      } else if (j.newBalance != null) {
        alert(`Purchase complete (dev mode). New balance: ${j.newBalance.toLocaleString()} credits.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setBuying(null);
    }
  };

  if (packs === null) return null;
  if (packs.length === 0) return null;

  return (
    <section className="max-w-7xl mx-auto px-6 lg:px-10 py-12 border-t border-border/60">
      <div className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Pay as you go</div>
        <h2 className="font-serif text-2xl sm:text-3xl tracking-tight">Buy credits — no subscription</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Top up a credit balance and use it across assessments, research queries, and enrichment. Credits expire 1 year after purchase. Upgrade to a subscription tier any time for monthly allocations and team features.
        </p>
      </div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {packs.map(p => {
          const isHighlighted = p.highlight === "most-popular" || p.highlight === "best-value";
          return (
            <div
              key={p.id}
              className={`relative border ${isHighlighted ? "border-foreground" : "border-border"} bg-card p-5 flex flex-col`}
            >
              {p.highlight && (
                <div className="absolute -top-3 left-4 px-2 py-0.5 bg-foreground text-background text-[10px] font-mono uppercase tracking-[0.18em]">
                  {p.highlight === "most-popular" ? "Most popular" : p.highlight === "best-value" ? "Best value" : p.highlight}
                </div>
              )}
              <div className="font-serif text-xl tracking-tight">{p.displayName}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-3xl tabular-nums">${(p.priceCents / 100).toFixed(p.priceCents % 100 === 0 ? 0 : 2)}</span>
                <span className="text-xs text-muted-foreground">one-time</span>
              </div>
              <div className="mt-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {p.creditAmount.toLocaleString()} credits
              </div>
              {p.description && (
                <p className="text-xs text-muted-foreground mt-3 flex-1">{p.description}</p>
              )}
              <button
                onClick={() => buy(p.slug)}
                disabled={buying === p.slug}
                className="mt-4 w-full bg-foreground text-background py-2 text-xs font-mono uppercase tracking-[0.18em] hover:opacity-90 disabled:opacity-60"
              >
                {buying === p.slug ? "Processing…" : "Buy now"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        Credits are non-refundable and expire 1 year after purchase. Balance is non-transferable. Subscription tiers (Briefing, Console, Platform) include monthly credit allocations — see plans above.
      </p>
    </section>
  );
}
