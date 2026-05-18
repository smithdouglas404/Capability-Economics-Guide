import { useEffect, useState } from "react";
import { Activity, ExternalLink } from "lucide-react";

const API_BASE = "/api";

interface Citation {
  label: string;
  methodology: string;
  weight: number;
  queriedAt: string;
}

interface Branding {
  hideBranding: boolean;
  customLogo: string | null;
  customLink: string | null;
  tenant: string | null;
}

interface CviPayload {
  overallIndex: number;
  ciLow: number | null;
  ciHigh: number | null;
  marketSentiment: number;
  volatility: number;
  timestamp: string;
  citations: Citation[];
  branding: Branding;
}

/**
 * Iframe-embeddable CVI widget. Bare layout. `?theme=dark|light` is
 * cosmetic and trusted from the URL; `?token=...` is forwarded to the
 * API which is the SOLE source of truth for branding rights — the URL
 * does NOT carry a `hideBranding` flag the client trusts. This stops
 * an anonymous embedder from stripping our branding by URL editing.
 */
export default function EmbedCvi() {
  const [data, setData] = useState<CviPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const token = params.get("token") ?? "";

  useEffect(() => {
    const url = token
      ? `${API_BASE}/embed/cvi?token=${encodeURIComponent(token)}`
      : `${API_BASE}/embed/cvi`;
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setErr(e instanceof Error ? e.message : "load failed"));
  }, [token]);

  const dark = theme === "dark";
  const cardCls = dark
    ? "bg-zinc-900 text-zinc-50 border-zinc-800"
    : "bg-white text-zinc-900 border-zinc-200";
  const branding = data?.branding ?? { hideBranding: false, customLogo: null, customLink: null, tenant: null };

  return (
    <div className={`min-h-[160px] p-4 ${dark ? "bg-zinc-950" : "bg-zinc-50"}`}>
      <div className={`rounded-md border ${cardCls} p-4 max-w-md`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className={`w-3.5 h-3.5 ${dark ? "text-emerald-400" : "text-emerald-600"}`} />
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-70">
              Capability Value Index
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
            {data.citations.length > 0 && (
              <div className="text-[9px] opacity-50 mt-3 font-mono leading-tight">
                <span className="uppercase tracking-wider opacity-70">Source: </span>
                {data.citations[0]!.label} ({data.citations[0]!.methodology})
              </div>
            )}
            <div className="text-[10px] opacity-50 mt-2 font-mono">
              {new Date(data.timestamp).toLocaleString()}
            </div>
          </>
        )}

        {data && !branding.hideBranding && (
          <div className={`mt-3 pt-3 border-t ${dark ? "border-zinc-800" : "border-zinc-200"} flex items-center justify-between text-[10px]`}>
            <span className="opacity-50 uppercase tracking-wider">Powered by</span>
            <a
              href="https://inflexcvi.ai"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 ${dark ? "text-emerald-400" : "text-emerald-700"} hover:underline font-mono`}
            >
              Inflexcvi <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        )}
        {data && branding.hideBranding && (branding.customLogo || branding.customLink) && (
          <div className={`mt-3 pt-3 border-t ${dark ? "border-zinc-800" : "border-zinc-200"} flex items-center justify-end text-[10px]`}>
            {branding.customLogo && (
              <img src={branding.customLogo} alt={branding.tenant ?? ""} className="h-4 opacity-80" />
            )}
            {branding.customLink && (
              <a href={branding.customLink} target="_blank" rel="noopener noreferrer" className="ml-2 opacity-70 hover:underline">
                {branding.tenant ?? "Details"}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
