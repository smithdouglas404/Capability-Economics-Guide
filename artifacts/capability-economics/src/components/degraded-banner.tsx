import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, X } from "lucide-react";
import { useServiceHealth, type ServiceStatus } from "@/hooks/use-service-health";

const DISMISS_KEY = "ce.degraded-banner.dismissed";

/**
 * Builds a stable signature for the current degradation set so dismissal is
 * scoped to "this incident" — if a different service later goes down, the
 * banner reappears.
 */
function buildSignature(services: { service: string; status: ServiceStatus }[]): string {
  return services
    .filter((s) => s.status === "down" || s.status === "degraded")
    .map((s) => `${s.service}:${s.status}`)
    .sort()
    .join("|");
}

export function DegradedServiceBanner() {
  const { data } = useServiceHealth();
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissedSig(sessionStorage.getItem(DISMISS_KEY));
    } catch {
      /* sessionStorage unavailable (SSR / privacy mode) — banner stays visible */
    }
  }, []);

  if (!data) return null;
  const affected = data.services.filter((s) => s.status === "down" || s.status === "degraded");
  if (affected.length === 0) return null;

  const sig = buildSignature(data.services);
  if (sig === dismissedSig) return null;

  const anyDown = affected.some((s) => s.status === "down");
  const tone = anyDown
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";

  const names = affected.map((s) => s.service).join(", ");

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, sig);
    } catch {
      /* ignore */
    }
    setDismissedSig(sig);
  };

  return (
    <div
      data-testid="degraded-banner"
      className={`w-full border-b ${tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="container mx-auto px-4 py-2 flex items-center gap-3 text-xs font-mono">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="uppercase tracking-[0.16em]">
          {anyDown ? "Service outage" : "Degraded service"}
        </span>
        <span className="hidden sm:inline opacity-80 truncate">
          Affecting: {names}
        </span>
        <Link href="/system-status">
          <a
            className="underline underline-offset-2 hover:opacity-80 ml-auto"
            data-testid="degraded-banner-details"
          >
            Details
          </a>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          data-testid="degraded-banner-dismiss"
          className="opacity-70 hover:opacity-100"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
