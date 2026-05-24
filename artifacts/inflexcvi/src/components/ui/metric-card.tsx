/**
 * <MetricCard> — Tremor-style KPI card built on the platform's existing
 * Tailwind tokens. Replaces the ad-hoc "Card with mono number + label"
 * pattern repeated across CVI, scorecard, alpha, exports, etc.
 *
 * Three composable parts:
 *   <MetricCard>
 *     <Metric>$1.2B</Metric>
 *     <MetricLabel>Total EVaR (12mo)</MetricLabel>
 *     <MetricDelta value={12.4} suffix="%" />     // green/red badge
 *     <MetricSparkline data={[…]} />              // optional inline trend
 *   </MetricCard>
 *
 * Each part is unstyled-by-default + tone-graded by value. The whole card
 * uses the new --token-* CSS variables so spacing + shadow + motion are
 * consistent across the platform.
 */
import { type ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export function MetricCard({
  children,
  className = "",
  emphasis = "default",
}: {
  children: ReactNode;
  className?: string;
  emphasis?: "default" | "subtle" | "accent";
}) {
  const tones = {
    default: "border-border bg-card",
    subtle: "border-border/60 bg-muted/20",
    accent: "border-accent/40 bg-accent/[0.04]",
  };
  return (
    <div
      className={`border ${tones[emphasis]} p-[var(--token-space-4)] space-y-[var(--token-space-2)] transition-shadow duration-[var(--token-motion-med)] hover:shadow-[var(--token-shadow-2)] ${className}`}
    >
      {children}
    </div>
  );
}

export function MetricLabel({ children, icon: Icon }: { children: ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {Icon && <Icon className="w-3 h-3" />}
      {children}
    </div>
  );
}

export function Metric({
  children,
  suffix,
  className = "",
}: {
  children: ReactNode;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={`font-mono text-3xl tabular-nums font-bold tracking-tight text-foreground ${className}`}>
      {children}
      {suffix && <span className="ml-1 text-xl text-muted-foreground font-medium">{suffix}</span>}
    </div>
  );
}

export function MetricSubtext({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted-foreground leading-snug">{children}</div>;
}

export function MetricDelta({
  value,
  suffix = "%",
  precision = 1,
  inverse = false,
}: {
  /** Positive = up, negative = down, 0 = flat. */
  value: number;
  suffix?: string;
  precision?: number;
  /** When true, positive-is-bad (e.g. risk metrics): inverts the color. */
  inverse?: boolean;
}) {
  const isUp = value > 0.05;
  const isDown = value < -0.05;
  const goodIsUp = !inverse;
  const tone = isUp
    ? (goodIsUp ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30" : "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30")
    : isDown
      ? (goodIsUp ? "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30" : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30")
      : "text-muted-foreground bg-muted border-border";
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono tabular-nums border ${tone}`}>
      <Icon className="w-3 h-3" />
      {sign}{value.toFixed(precision)}{suffix}
    </span>
  );
}

/**
 * Compact inline sparkline — SVG, no library. ~40px wide. Designed to sit
 * alongside a Metric value or in a table cell. Tone-graded by direction.
 */
export function MetricSparkline({
  data,
  width = 60,
  height = 18,
  className = "",
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const trend = data[data.length - 1] - data[0];
  const stroke = trend > 0 ? "rgb(16 185 129)" : trend < 0 ? "rgb(244 63 94)" : "rgb(120 113 108)";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`inline-block ${className}`} width={width} height={height} aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * height} r="1.5" fill={stroke} />
    </svg>
  );
}

/**
 * <MetricGrid> — opinionated 2/3/4-column responsive grid that the cards
 * fit into. Replaces the dozen one-off "grid grid-cols-2 md:grid-cols-4
 * gap-4" instances across pages.
 */
export function MetricGrid({
  children,
  cols = 4,
  className = "",
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const gridCols = cols === 2 ? "md:grid-cols-2" : cols === 3 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-4";
  return <div className={`grid grid-cols-1 ${gridCols} gap-[var(--token-space-3)] ${className}`}>{children}</div>;
}
