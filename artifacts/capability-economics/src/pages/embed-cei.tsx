import { useEffect, useState } from "react";
import { Activity, ExternalLink } from "lucide-react";

const API_BASE = "/api";

interface CeiPayload {
  overallIndex: number;
  ciLow: number | null;
  ciHigh: number | null;
  marketSentiment: number;
  volatility: number;
  timestamp: string;
}

/**
 * Iframe-embeddable CEI widget. Bare layout, transparent-friendly bg,
 * theme via ?theme=dark|light, branding hidden via ?hideBranding=1
 * (Platform tier).
 */
export default function EmbedCei() {
  const [data, setData] = useState<CeiPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const hideBranding = params.get("hideBranding") === "1";

  useEffect(() => {
    fetch(`${API_BASE}/embed/cei`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setErr(e instanceof Error ? e.message : "load failed"));
  }, []);

  const dark = theme === "dark";
  const cardCls = dark
    ? "bg-zinc-900 text-zinc-50 border-zinc-800"
    : "bg-white text-zinc-900 border-zinc-200";

  return (
    <div className={`min-h-[160px] p-4 ${dark ? "bg-zinc-950" : "bg-zinc-50"}`}>
      <div className={`rounded-md border ${cardCls} p-4 max-w-md`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className={`w-3.5 h-3.5 ${dark ? "text-emerald-400" : "text-emerald-600"}`} />
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-70">
              Capability Economics Index
            </div>
          </div>
          {data && <div className="text-[10px] opacity-60 font-mono">LIVE</div>}
        </div>

        {err && <div className="text-xs text-rose-500">Failed to load: {err}</div>}

        {data && (
          <>
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-semibold tabular-nums">
                {data.overallIndex.toFixed(1)}
              </div>
              {data.ciLow !== null && data.ciHigh !== null && (
                <div className="text-xs opacity-60 font-mono">
                  95% CI [{data.ciLow.toFixed(1)}, {data.ciHigh.toFixed(1)}]
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
              <div>
                <div className="opacity-60 uppercase tracking-wider text-[9px]">Sentiment</div>
                <div className="font-mono tabular-nums">{data.marketSentiment.toFixed(1)}</div>
              </div>
              <div>
                <div className="opacity-60 uppercase tracking-wider text-[9px]">Volatility</div>
                <div className="font-mono tabular-nums">{data.volatility.toFixed(2)}</div>
              </div>
            </div>
            <div className="text-[10px] opacity-50 mt-3 font-mono">
              {new Date(data.timestamp).toLocaleString()}
            </div>
          </>
        )}

        {!hideBranding && (
          <div className={`mt-3 pt-3 border-t ${dark ? "border-zinc-800" : "border-zinc-200"} flex items-center justify-between text-[10px]`}>
            <span className="opacity-50 uppercase tracking-wider">Powered by</span>
            <a
              href="https://capabilityeconomics.com"
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
