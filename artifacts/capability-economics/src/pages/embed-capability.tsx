import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";

const API_BASE = "/api";

interface CapPayload {
  id: number;
  slug: string;
  name: string;
  description: string;
  industry: { id: number; name: string; slug: string };
  score: number;
  ciLow: number | null;
  ciHigh: number | null;
  velocity: number | null;
  sourceCount: number;
  lastUpdatedAt: string | null;
}

export default function EmbedCapability() {
  const [, params] = useRoute<{ id: string }>("/embed/capability/:id");
  const [data, setData] = useState<CapPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = new URLSearchParams(window.location.search);
  const theme = search.get("theme") === "dark" ? "dark" : "light";
  const hideBranding = search.get("hideBranding") === "1";

  useEffect(() => {
    if (!params?.id) return;
    fetch(`${API_BASE}/embed/capability/${params.id}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setErr(e instanceof Error ? e.message : "load failed"));
  }, [params?.id]);

  const dark = theme === "dark";
  const cardCls = dark
    ? "bg-zinc-900 text-zinc-50 border-zinc-800"
    : "bg-white text-zinc-900 border-zinc-200";

  const VeloIcon = data?.velocity == null
    ? Minus
    : data.velocity > 0.5
      ? TrendingUp
      : data.velocity < -0.5
        ? TrendingDown
        : Minus;

  return (
    <div className={`min-h-[160px] p-4 ${dark ? "bg-zinc-950" : "bg-zinc-50"}`}>
      <div className={`rounded-md border ${cardCls} p-4 max-w-md`}>
        {err && <div className="text-xs text-rose-500">Failed to load: {err}</div>}

        {data && (
          <>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-60 mb-1">
              {data.industry.name}
            </div>
            <div className="text-base font-semibold leading-tight mb-2">{data.name}</div>
            <div className="text-[11px] opacity-70 leading-snug line-clamp-2 mb-3">
              {data.description}
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-semibold tabular-nums">{data.score.toFixed(1)}</div>
              <VeloIcon className={`w-3.5 h-3.5 ${
                data.velocity != null && data.velocity > 0.5 ? "text-emerald-500"
                  : data.velocity != null && data.velocity < -0.5 ? "text-rose-500"
                  : "opacity-50"}`}
              />
              {data.ciLow !== null && data.ciHigh !== null && (
                <div className="text-[10px] opacity-60 font-mono">
                  95% CI [{data.ciLow.toFixed(1)}, {data.ciHigh.toFixed(1)}]
                </div>
              )}
            </div>
            <div className="text-[10px] opacity-50 mt-2 font-mono">
              {data.sourceCount} sources · updated{" "}
              {data.lastUpdatedAt ? new Date(data.lastUpdatedAt).toLocaleDateString() : "—"}
            </div>
          </>
        )}

        {!hideBranding && (
          <div className={`mt-3 pt-3 border-t ${dark ? "border-zinc-800" : "border-zinc-200"} flex items-center justify-between text-[10px]`}>
            <span className="opacity-50 uppercase tracking-wider">Powered by</span>
            <a
              href={data ? `https://capabilityeconomics.com/explore` : "https://capabilityeconomics.com"}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 ${dark ? "text-emerald-400" : "text-emerald-700"} hover:underline font-mono`}
            >
              Capability Economics <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
