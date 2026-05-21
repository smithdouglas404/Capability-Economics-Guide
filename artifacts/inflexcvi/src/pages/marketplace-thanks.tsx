import { useEffect, useState, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Download, ShoppingCart, Check } from "lucide-react";

const API_BASE = "/api";

type PurchaseData = {
  purchase: {
    id: number;
    priceCents: number;
    platformFeeCents: number;
    status: string;
    purchasedAt: string | null;
    createdAt: string;
    buyerEmail: string | null;
  };
  listing: {
    id: number;
    title: string;
    type: string;
    fileKey: string | null;
  } | null;
};

const fmtMoney = (c: number) => `$${(c / 100).toFixed(2)}`;

function ConfettiDots() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 24 }).map((_, i) => {
        const angle = (i / 24) * 360;
        const distance = 80 + Math.random() * 60;
        const rad = (angle * Math.PI) / 180;
        const x = 50 + Math.cos(rad) * (distance / 3);
        const y = 50 + Math.sin(rad) * (distance / 3);
        const size = 3 + Math.random() * 5;
        const delay = 0.1 + Math.random() * 0.6;
        const hue = [244, 195, 340, 160, 45][i % 5];
        return (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              background: `hsl(${hue}, 70%, 55%)`,
              animation: `bounce-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}s both`,
            }}
          />
        );
      })}
    </div>
  );
}

export default function MarketplaceThanksPage() {
  const [location] = useState(() => window.location.search);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [data, setData] = useState<PurchaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [paid, setPaid] = useState(false);
  const [pollAttempts, setPollAttempts] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse purchase ID from URL
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const id = params.get("purchase");
    setPurchaseId(id);
    // Stagger entrance
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, [location]);

  // Fetch purchase details
  useEffect(() => {
    if (!purchaseId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const doFetch = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/marketplace/purchases/${purchaseId}`,
          { credentials: "include" },
        );
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            setError("Purchase not found. It may still be processing.");
          } else if (res.status === 401) {
            setError("Sign in to view your purchase.");
          } else {
            setError("Something went wrong.");
          }
          setLoading(false);
          return;
        }
        const json = (await res.json()) as PurchaseData;
        if (cancelled) return;
        setData(json);
        setPaid(json.purchase.status === "paid");
        setLoading(false);

        // If still pending, poll up to 30s for the webhook to fire
        if (json.purchase.status === "pending" && pollAttempts < 10) {
          pollRef.current = setTimeout(() => {
            setPollAttempts((p) => p + 1);
          }, 3000);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load purchase details.");
          setLoading(false);
        }
      }
    };

    void doFetch();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [purchaseId, pollAttempts]);

  // Entry animation keyframes (injected once)
  useEffect(() => {
    if (document.getElementById("thanks-keyframes")) return;
    const style = document.createElement("style");
    style.id = "thanks-keyframes";
    style.textContent = `
      @keyframes thanks-fade-up {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes thanks-scale-in {
        from { opacity: 0; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes thanks-ring-expand {
        from { opacity: 0.6; transform: scale(1); }
        to { opacity: 0; transform: scale(1.6); }
      }
      @keyframes bounce-in {
        0% { opacity: 0; transform: scale(0); }
        60% { opacity: 1; transform: scale(1.2); }
        100% { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const animStyle = (delay: number): React.CSSProperties => ({
    opacity: 0,
    animation: `thanks-fade-up 0.5s ease-out ${delay}s both`,
  });

  // --- States ---

  if (!purchaseId) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <h1 className="font-serif text-2xl mb-3">No purchase reference</h1>
        <p className="text-muted-foreground text-sm mb-6">
          We couldn't find a purchase ID in the URL. If you just completed a
          purchase, check your email for the receipt.
        </p>
        <Button asChild className="rounded-none">
          <Link href="/marketplace">
            <ShoppingCart className="w-4 h-4" />
            <span className="ml-2">Browse marketplace</span>
          </Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-lg text-center">
        <div
          className={`transition-all duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}
        >
          {/* Animated pulse circle */}
          <div className="flex justify-center mb-8">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
              <div className="absolute inset-2 rounded-full border-2 border-primary/40 animate-ping" style={{ animationDelay: "0.2s", animationDuration: "1.5s" }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-primary/60 animate-pulse" />
              </div>
            </div>
          </div>
          <h1 className="font-serif text-2xl mb-3">Confirming your purchase</h1>
          <p className="text-muted-foreground text-sm">
            Please wait while we verify the payment
            {pollAttempts > 0 && "… still processing"}.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    // If we have cached data from a previous successful fetch, show it
    // instead of the error screen (poll may have transiently failed).
    if (data) {
      // fall through to the success view below
    } else {
      return (
        <div className="container mx-auto px-4 py-16 max-w-lg text-center">
          <div className={`transition-all duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}
          >
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
            </div>
            <h1 className="font-serif text-xl mb-3">{error}</h1>
            <p className="text-muted-foreground text-sm mb-6">
              Your payment may still be processing. Check your email for a
              receipt or try again.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button asChild className="rounded-none">
                <Link href="/marketplace/my-purchases">
                  <span className="ml-2">Check my library</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-none">
                <Link href="/marketplace">Back to marketplace</Link>
              </Button>
            </div>
          </div>
        </div>
      );
    }
  }

  // TypeScript narrows after the early returns above — data is non-null here
  // because every preceding branch either returns or (for error+data) falls
  // through only when data is truthy. This guard silences the assertion.
  if (!data) return null;
  const purchase = data.purchase;
  const listing = data.listing;

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      {/* Subtle back-link */}
      <div style={animStyle(0)} className="mb-8">
        <Link
          href="/marketplace"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 group"
        >
          <svg
            className="w-3 h-3 transition-transform group-hover:-translate-x-0.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to marketplace
        </Link>
      </div>

      {/* Celebration section */}
      <div className="relative">
        <ConfettiDots />
        <div className="relative z-10 text-center" style={animStyle(0.15)}>
          {/* Animated checkmark */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full border-2 border-emerald-400/30"
                style={{
                  animation: "thanks-ring-expand 1.2s ease-out 0.3s both",
                }}
              />
              <div
                className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center"
                style={{
                  animation: "thanks-scale-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both",
                }}
              >
                <Check className="w-10 h-10 text-white" strokeWidth={3} />
              </div>
            </div>
          </div>

          <h1
            className="font-serif text-3xl sm:text-4xl tracking-tight mb-2"
            style={{ animation: "thanks-fade-up 0.5s ease-out 0.35s both", opacity: 0 }}
          >
            {paid ? "Purchase confirmed" : "Processing your purchase"}
          </h1>
          <p
            className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed"
            style={{ animation: "thanks-fade-up 0.5s ease-out 0.45s both", opacity: 0 }}
          >
            {paid
              ? "Your report is ready. Download it anytime — watermarked copies are tied to your account."
              : "Please wait a moment while Stripe confirms the payment. The page will update automatically."}
          </p>
        </div>

        {/* Purchase summary card */}
        {listing && (
          <div
            className="mt-8 border border-border/50 bg-card"
            style={{ animation: "thanks-fade-up 0.5s ease-out 0.55s both", opacity: 0 }}
          >
            {/* Receipt-style header */}
            <div className="border-b border-border/50 px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
                  Receipt
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  #{String(purchase.id).padStart(6, "0")}
                </span>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Item row */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-serif text-lg leading-snug">{listing.title}</h2>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">
                    {listing.type}
                    {purchase.purchasedAt && (
                      <>
                        {" · "}
                        {new Date(purchase.purchasedAt).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </>
                    )}
                  </p>
                </div>
                <span className="font-mono font-semibold text-lg shrink-0">
                  {fmtMoney(purchase.priceCents)}
                </span>
              </div>

              {/* Divider */}
              <div className="border-t border-dashed border-border/60" />

              {/* Total */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                  Total paid
                </span>
                <span className="font-mono font-bold">
                  {fmtMoney(purchase.priceCents)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Polling hint */}
        {!paid && (
          <p
            className="mt-4 text-center text-xs text-muted-foreground"
            style={{ animation: "thanks-fade-up 0.5s ease-out 0.65s both", opacity: 0 }}
          >
            Automatically checking for confirmation{". ".repeat((pollAttempts % 3) + 1)}
          </p>
        )}

        {/* Actions */}
        <div
          className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
          style={{ animation: "thanks-fade-up 0.5s ease-out 0.65s both", opacity: 0 }}
        >
          {paid && (
            <Button asChild className="rounded-none w-full sm:w-auto">
              <a
                href={`${API_BASE}/marketplace/purchases/${purchase.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="w-4 h-4" />
                <span className="ml-2">Download now</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </a>
            </Button>
          )}
          <Button asChild variant={paid ? "outline" : "default"} className="rounded-none w-full sm:w-auto">
            <Link href="/marketplace/my-purchases">
              <ShoppingCart className="w-4 h-4" />
              <span className="ml-2">View my library</span>
            </Link>
          </Button>
        </div>

        {/* Help footer */}
        <p
          className="mt-12 text-center text-xs text-muted-foreground/60"
          style={{ animation: "thanks-fade-up 0.5s ease-out 0.75s both", opacity: 0 }}
        >
          Downloaded reports are watermarked with your email for security.
          Need help?{" "}
          <a
            href="mailto:support@capabilityeconomics.com"
            className="underline hover:text-foreground transition-colors"
          >
            Contact support
          </a>
          .
        </p>
      </div>
    </div>
  );
}
