import { cn } from "@/lib/utils";

/**
 * Capability lifecycle stage chip.
 *
 * Five derived stages, each with a fixed colour mapping that's reused
 * everywhere a capability is shown (tables, scorecards, dashboards, graph
 * tooltips). Stage values are computed server-side in
 * `services/lifecycle.ts` and emitted on capability/component payloads —
 * the chip is purely a presentation layer.
 */
export type LifecycleStage = "emerging" | "adopted" | "mature" | "decaying" | "obsolete";

const STAGE_META: Record<LifecycleStage, { label: string; classes: string; tooltip: string }> = {
  emerging: {
    label: "Emerging",
    classes: "border-sky-500/40 bg-sky-500/10 text-sky-400",
    tooltip: "Low maturity but climbing fast — early adopters investing.",
  },
  adopted: {
    label: "Adopted",
    classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    tooltip: "Mainstream adoption underway — mid-range maturity, positive or neutral momentum.",
  },
  mature: {
    label: "Mature",
    classes: "border-violet-500/40 bg-violet-500/10 text-violet-400",
    tooltip: "Table stakes — high maturity (≥65) and stable trajectory.",
  },
  decaying: {
    label: "Decaying",
    classes: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    tooltip: "Sustained negative velocity — capability is losing relevance.",
  },
  obsolete: {
    label: "Obsolete",
    classes: "border-destructive/40 bg-destructive/10 text-destructive",
    tooltip: "Low score AND falling — capability is being abandoned across the industry.",
  },
};

export const LIFECYCLE_STAGES: LifecycleStage[] = ["emerging", "adopted", "mature", "decaying", "obsolete"];

export function lifecycleLabel(stage: LifecycleStage): string {
  return STAGE_META[stage].label;
}

interface LifecycleChipProps {
  stage: LifecycleStage | null | undefined;
  className?: string;
}

export function LifecycleChip({ stage, className }: LifecycleChipProps) {
  if (!stage || !STAGE_META[stage]) return null;
  const meta = STAGE_META[stage];
  return (
    <span
      className={cn(
        "whitespace-nowrap inline-flex items-center rounded-none border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
        meta.classes,
        className,
      )}
      title={meta.tooltip}
      data-testid={`lifecycle-chip-${stage}`}
    >
      {meta.label}
    </span>
  );
}
