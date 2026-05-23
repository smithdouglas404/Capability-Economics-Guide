import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Target } from "lucide-react";

interface RollingResponse {
  available: boolean;
  windowDays?: number;
  runs?: number;
  rollingAccuracy?: number;
  brier?: number | null;
  latestRunAt?: string | null;
  eventsScored?: number;
}

/**
 * Compact "our calls hit X% over last Y days" badge. Renders inline in
 * page heroes and synthesis cards. Quiet when no backtest history exists.
 *
 * Clicking links to /proof for the full backtest gallery.
 */
export function LiveBacktestBadge({
  windowDays = 90,
  variant = "default",
}: {
  windowDays?: number;
  variant?: "default" | "compact";
}) {
  const [data, setData] = useState<RollingResponse | null>(null);
  useEffect(() => {
    fetch(`/api/backtest/rolling?days=${windowDays}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: RollingResponse | null) => setData(d))
      .catch(() => setData(null));
  }, [windowDays]);

  if (!data?.available || data.rollingAccuracy == null) return null;

  const tone =
    data.rollingAccuracy >= 70 ? "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400"
      : data.rollingAccuracy >= 50 ? "border-amber-500/40 bg-amber-500/[0.06] text-amber-700 dark:text-amber-400"
      : "border-destructive/40 bg-destructive/[0.06] text-destructive";

  if (variant === "compact") {
    return (
      <Link href="/proof">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em] border ${tone} hover:opacity-80 transition-opacity cursor-pointer`}
          title={`${data.eventsScored ?? 0} events scored across ${data.runs} backtest runs in the last ${data.windowDays} days. Click for the full proof gallery.`}
        >
          <Target className="w-3 h-3" />
          {data.rollingAccuracy.toFixed(1)}% accuracy
        </span>
      </Link>
    );
  }

  return (
    <Link href="/proof">
      <div
        className={`inline-flex items-center gap-3 px-3 py-2 border ${tone} hover:opacity-90 transition-opacity cursor-pointer`}
        title={`Click for the full backtest gallery — events, methodology, per-event scoring.`}
      >
        <Target className="w-4 h-4" />
        <div className="text-left">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-80">
            Last {data.windowDays}d rolling accuracy
          </div>
          <div className="font-mono text-lg tabular-nums font-bold">
            {data.rollingAccuracy.toFixed(1)}%
          </div>
        </div>
        <div className="text-left font-mono text-[10px] opacity-70">
          {data.eventsScored ?? 0} events ·<br />{data.runs} runs
        </div>
      </div>
    </Link>
  );
}
