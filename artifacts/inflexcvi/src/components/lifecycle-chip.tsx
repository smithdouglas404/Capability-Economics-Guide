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
    // Light-mode text-sky-700 / dark-mode text-sky-300 — both readable against the 10% tint bg.
    classes: "border-sky-500/60 bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold",
    tooltip: "Low maturity but climbing fast — early adopters investing.",
  },
  adopted: {
    label: "Adopted",
    classes: "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold",
    tooltip: "Mainstream adoption underway — mid-range maturity, positive or neutral momentum.",
  },
  mature: {
    label: "Mature",
    classes: "border-violet-500/60 bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold",
    tooltip: "Table stakes — high maturity (≥65) and stable trajectory.",
  },
  decaying: {
    label: "Decaying",
    classes: "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold",
    tooltip: "Sustained negative velocity — capability is losing relevance.",
  },
  obsolete: {
    label: "Obsolete",
    classes: "border-destructive/60 bg-destructive/15 text-destructive font-semibold",
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
