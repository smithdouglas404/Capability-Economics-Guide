import { useEffect, useState } from "react";
import { GitBranch, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { CapabilityCascadePanel } from "@/components/capability-cascade-panel";

const API_BASE = "/api";

interface CascadeSummary {
  totalImpactUsdMm: number;
  nodeCount: number;
}

function formatUsdMm(mm: number): string {
  if (mm === 0) return "—";
  if (mm >= 1000) return `$${(mm / 1000).toFixed(1)}B`;
  if (mm >= 1) return `$${mm.toFixed(0)}M`;
  return `$${(mm * 1000).toFixed(0)}K`;
}

/**
 * Compact "↘ Cascade: $X across N caps" chip. Lazy-fetches the cascade
 * summary so a list of N alerts doesn't fire N requests on render.
 * Click expands the full <CapabilityCascadePanel> inline.
 */
export function CapabilityCascadeChip({ capabilityId, depth = 3 }: { capabilityId: number; depth?: number }) {
  const [summary, setSummary] = useState<CascadeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/cascade/${capabilityId}?depth=${depth}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (!cancelled) setSummary({ totalImpactUsdMm: d.totalImpactUsdMm ?? 0, nodeCount: (d.nodes ?? []).length }); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId, depth]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Cascade…
      </span>
    );
  }
  if (error || !summary || summary.nodeCount === 0) return null;

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 hover:underline"
        data-testid={`cascade-chip-${capabilityId}`}
      >
        <GitBranch className="w-3 h-3" />
        Cascade: {formatUsdMm(summary.totalImpactUsdMm)} across {summary.nodeCount} cap{summary.nodeCount === 1 ? "" : "s"}
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-2 max-w-2xl">
          <CapabilityCascadePanel capabilityId={capabilityId} />
        </div>
      )}
    </div>
  );
}
