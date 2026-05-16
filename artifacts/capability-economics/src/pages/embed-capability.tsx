import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";

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
  citations: Citation[];
  branding: Branding;
}

/**
 * Iframe-embeddable single-capability widget. `?theme=dark|light` is
 * cosmetic. `?token=...` is forwarded to the API and the API returns
 * the trusted `branding` block — the URL does NOT carry a hideBranding
 * flag the client respects, which prevents anonymous brand stripping.
 */
export default function EmbedCapability() {
  const [, params] = useRoute<{ id: string }>("/embed/capability/:id");
  const [data, setData] = useState<CapPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const search = new URLSearchParams(window.location.search);
  const theme = search.get("theme") === "dark" ? "dark" : "light";
  const token = search.get("token") ?? "";

  useEffect(() => {
    if (!params?.id) return;
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    fetch(`${API_BASE}/embed/capability/${params.id}${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setErr(e instanceof Error ? e.message : "load failed"));
  }, [params?.id, token]);

  const dark = theme === "dark";
  const cardCls = dark
    ? "bg-zinc-900 text-zinc-50 border-zinc-800"
    : "bg-white text-zinc-900 border-zinc-200";
  const branding = data?.branding ?? { hideBranding: false, customLogo: null, customLink: null, tenant: null };

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
            {data.citations.length > 0 && (
              <div className="text-[9px] opacity-60 mt-2 font-mono leading-snug">
                <div className="uppercase tracking-wider opacity-70 mb-0.5">Cited sources</div>
                {data.citations.slice(0, 3).map((c, i) => (
                  <div key={i} className="truncate">
                    · {c.label} <span className="opacity-60">(w {c.weight.toFixed(2)}, {c.methodology})</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {data && !branding.hideBranding && (
          <div className={`mt-3 pt-3 border-t ${dark ? "border-zinc-800" : "border-zinc-200"} flex items-center justify-between text-[10px]`}>
            <span className="opacity-50 uppercase tracking-wider">Powered by</span>
            <a
              href={`https://inflexcvi.ai/explore`}
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
