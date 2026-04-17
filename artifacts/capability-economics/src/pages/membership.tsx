import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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

function PriceBlock({ tier, billing }: { tier: Tier; billing: "monthly" | "annual" }) {
  if (tier.isContactSales && billing === "monthly") {
    return (
      <div>
        <div className="text-3xl font-bold font-mono">Custom</div>
        <div className="text-sm text-muted-foreground mt-1">Contact sales</div>
      </div>
    );
  }
  const cents = billing === "monthly" ? tier.monthlyPriceCents : tier.annualPriceCents;
  if (cents === null) {
    return (
      <div>
        <div className="text-3xl font-bold font-mono">—</div>
        <div className="text-sm text-muted-foreground mt-1">Not available {billing}</div>
      </div>
    );
  }
  const suffix = billing === "monthly" ? "/month" : "/year";
  return (
    <div>
      <div className="text-4xl font-bold font-mono tracking-tight">{formatPrice(cents)}</div>
      <div className="text-sm text-muted-foreground mt-1">USD {suffix}</div>
      {billing === "annual" && tier.monthlyPriceCents !== null && (
        <div className="text-xs text-muted-foreground mt-0.5">
          equivalent to ${(cents / 100 / 12).toFixed(0)}/mo
        </div>
      )}
    </div>
  );
}

function TierCard({ tier, billing }: { tier: Tier; billing: "monthly" | "annual" }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="relative h-[520px] [perspective:1500px]">
      <motion.div
        className="relative w-full h-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0.0, 0.2, 1] }}
      >
        <Card
          className={`absolute inset-0 [backface-visibility:hidden] flex flex-col ${
            tier.highlight ? "border-primary border-2 shadow-lg" : ""
          }`}
        >
          {tier.highlight && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground gap-1">
                <Sparkles className="w-3 h-3" /> Most popular
              </Badge>
            </div>
          )}
          <CardContent className="p-7 flex-1 flex flex-col">
            <div className="mb-4">
              <h3 className="text-2xl font-serif font-bold">{tier.name}</h3>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{tier.tagline}</p>
            </div>
            <div className="py-5 border-y mb-5">
              <PriceBlock tier={tier} billing={billing} />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">
              {tier.description}
            </p>
            <div className="space-y-2 mt-6">
              <Button
                className="w-full"
                variant={tier.highlight ? "default" : "outline"}
                data-testid={`button-purchase-${tier.slug}`}
                onClick={() => alert(`Checkout for ${tier.name} not yet wired — coming soon.`)}
              >
                {tier.ctaLabel}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setFlipped(true)}
                data-testid={`button-details-${tier.slug}`}
              >
                More detail →
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] flex flex-col ${
            tier.highlight ? "border-primary border-2 shadow-lg" : ""
          }`}
        >
          <CardContent className="p-7 flex-1 flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">What's included</div>
                <h3 className="text-xl font-serif font-bold">{tier.name}</h3>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFlipped(false)}
                data-testid={`button-back-${tier.slug}`}
                className="gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
            </div>
            <ul className="space-y-2.5 flex-1 overflow-auto">
              {tier.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                  <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button
              className="w-full mt-5"
              variant={tier.highlight ? "default" : "outline"}
              data-testid={`button-purchase-back-${tier.slug}`}
              onClick={() => alert(`Checkout for ${tier.name} not yet wired — coming soon.`)}
            >
              {tier.ctaLabel}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
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

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-serif font-bold tracking-tight mb-3">Membership</h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Choose how you want to use Capability Economics — from reading the framework to running it on your own industries.
        </p>
        <div className="inline-flex items-center mt-6 p-1 rounded-lg bg-muted">
          <button
            onClick={() => setBilling("monthly")}
            data-testid="button-billing-monthly"
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              billing === "monthly" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling("annual")}
            data-testid="button-billing-annual"
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              billing === "annual" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
            }`}
          >
            Annual <span className="text-xs text-primary ml-1">save ~17%</span>
          </button>
        </div>
      </div>

      {tiers === null && (
        <div className="text-center text-muted-foreground py-20">Loading tiers...</div>
      )}

      {tiers && tiers.length === 0 && (
        <div className="text-center text-muted-foreground py-20">No tiers available.</div>
      )}

      <AnimatePresence>
        {tiers && tiers.length > 0 && (
          <div className="grid md:grid-cols-3 gap-6 mt-10">
            {tiers.map((tier) => (
              <TierCard key={tier.id} tier={tier} billing={billing} />
            ))}
          </div>
        )}
      </AnimatePresence>

      <div className="mt-16 text-center text-sm text-muted-foreground">
        <p>All prices in USD. Annual plans billed once per year. Enterprise procurement, security review, and SSO supported on Platform.</p>
      </div>
    </div>
  );
}
