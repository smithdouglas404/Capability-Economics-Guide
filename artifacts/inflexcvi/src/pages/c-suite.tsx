import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, AlertTriangle, Brain } from "lucide-react";
import { ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

const API_BASE = "/api";

interface Role {
  id: number;
  slug: string;
  title: string;
  name: string;
  focus: string;
}

interface Perspective {
  id: number;
  scenario: string;
  questions: string[];
  capabilities: string[];
  metrics: string[];
  chartData: { subject: string; A: number; fullMark: number }[];
  generatedAt: string;
}

// ─── Persona-specific data shapes ────────────────────────────────────────
interface MoatItem {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  moatScore: number;
  tier: string;
  halfLifeMonths: number | null;
}
interface EvarItem {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  evar12: number;
  evar24: number;
  evar36: number;
  revenueExposureMm: number;
  marginStructurePct: number | null;
}
interface AlphaEconRow {
  capabilityId: number;
  industryId: number;
  aiExposureScore: number | null;
  aiTimeToDisplacementMonths: number | null;
  aiSubstitutes: string[] | null;
}
interface TalentItem {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  bottleneckScore: number;
  status: string;
  companies: number;
  coreCount: number;
  masteryRatio: number;
}
interface SynthesisResp {
  available: boolean;
  synthesis?: {
    brief?: string;
    keyFindings?: string[];
    crossAgentInsights?: string[];
  } | null;
}

interface PersonaBullet {
  label: string;
  detail: string;
}
interface PersonaFocus {
  bullets: PersonaBullet[];
  loading: boolean;
  empty: boolean;
  placeholder?: string;
}

function usePersonaFocus(slug: string | null): PersonaFocus {
  const [bullets, setBullets] = useState<PersonaBullet[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [placeholder, setPlaceholder] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setEmpty(false);
    setBullets([]);
    setPlaceholder(undefined);

    const fmtMm = (n: number) => {
      if (!Number.isFinite(n)) return "—";
      if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}B`;
      return `$${Math.round(n)}M`;
    };

    async function loadCEO() {
      // Market position + competitive moat
      const [moatRes, synthRes] = await Promise.all([
        fetch(`${API_BASE}/alpha/moat`).then(r => r.ok ? r.json() as Promise<{ items: MoatItem[] }> : Promise.reject()).catch(() => null),
        fetch(`${API_BASE}/synthesis/brief`).then(r => r.ok ? r.json() as Promise<SynthesisResp> : Promise.reject()).catch(() => null),
      ]);
      const items = moatRes?.items ?? [];
      const out: PersonaBullet[] = [];
      const fortresses = items.filter(i => i.tier === "fortress");
      const exposed = items.filter(i => i.tier === "exposed" || i.tier === "contestable");
      const top = items[0];
      if (top) {
        out.push({
          label: `Moat leader: ${top.capabilityName}`,
          detail: `${top.industryName} — moat score ${top.moatScore}/100 (${top.tier})${top.halfLifeMonths ? `, ${Math.round(top.halfLifeMonths)}mo half-life` : ""}`,
        });
      }
      if (fortresses.length > 0) {
        out.push({
          label: `${fortresses.length} fortress-tier capabilit${fortresses.length === 1 ? "y" : "ies"}`,
          detail: `Defensible cash-flow positions — protect pricing power; resist commoditization pressure`,
        });
      }
      if (exposed.length > 0) {
        const worst = exposed[exposed.length - 1];
        out.push({
          label: `${exposed.length} exposed/contestable position${exposed.length === 1 ? "" : "s"}`,
          detail: worst ? `Weakest: ${worst.capabilityName} (${worst.industryName}) — moat ${worst.moatScore}/100` : "Competitive flank — moat erosion risk",
        });
      }
      const findings = synthRes?.synthesis?.keyFindings ?? [];
      if (findings.length > 0) {
        out.push({
          label: "Synthesis brief headline",
          detail: findings[0]!,
        });
      }
      if (!cancelled) {
        if (out.length === 0) setEmpty(true);
        else setBullets(out);
        setLoading(false);
      }
    }

    async function loadCFO() {
      const evarRes = await fetch(`${API_BASE}/alpha/evar`).then(r => r.ok ? r.json() as Promise<{ items: EvarItem[]; totals: { totalEvar12: number; totalEvar24: number; totalEvar36: number; count: number } }> : Promise.reject()).catch(() => null);
      if (!evarRes) {
        if (!cancelled) { setEmpty(true); setLoading(false); }
        return;
      }
      const items = evarRes.items ?? [];
      const totals = evarRes.totals;
      const out: PersonaBullet[] = [];
      if (totals && totals.totalEvar12 > 0) {
        out.push({
          label: `Portfolio EVaR12: ${fmtMm(totals.totalEvar12)} at risk`,
          detail: `${fmtMm(totals.totalEvar24)} at 24mo, ${fmtMm(totals.totalEvar36)} at 36mo across ${totals.count} priced capabilities`,
        });
      }
      const top = items[0];
      if (top) {
        out.push({
          label: `EVaR36 leader: ${fmtMm(top.evar36)} on ${top.capabilityName}`,
          detail: `${top.industryName} — ${fmtMm(top.revenueExposureMm)} revenue exposure${top.marginStructurePct != null ? `, ${Math.round(top.marginStructurePct)}% margin` : ""}`,
        });
      }
      const top2 = items[1];
      if (top2) {
        out.push({
          label: `Runner-up: ${fmtMm(top2.evar36)} on ${top2.capabilityName}`,
          detail: `${top2.industryName} — capital-allocation priority for the next planning cycle`,
        });
      }
      // Skew of risk concentration
      if (items.length >= 3) {
        const top3 = items.slice(0, 3).reduce((s, i) => s + i.evar36, 0);
        const total = totals?.totalEvar36 ?? items.reduce((s, i) => s + i.evar36, 0);
        if (total > 0) {
          const pct = Math.round((top3 / total) * 100);
          out.push({
            label: `Top-3 concentration: ${pct}% of EVaR36`,
            detail: `Defensive capital should be aimed at the head of the risk distribution, not spread evenly`,
          });
        }
      }
      if (!cancelled) {
        if (out.length === 0) setEmpty(true);
        else setBullets(out);
        setLoading(false);
      }
    }

    async function loadCTO() {
      // Pull raw capability_alpha rows (have aiExposureScore + substitutes) and
      // join with fragility for AI-exposure-style readout.
      const [econRes, fragRes] = await Promise.all([
        fetch(`${API_BASE}/alpha/economics`).then(r => r.ok ? r.json() as Promise<AlphaEconRow[]> : Promise.reject()).catch(() => null),
        fetch(`${API_BASE}/alpha/fragility`).then(r => r.ok ? r.json() as Promise<{ items: Array<{ capabilityId: number; capabilityName: string; industryName: string; fragilityScore: number; severity: string; halfLifeMonths: number | null }> }> : Promise.reject()).catch(() => null),
      ]);
      const out: PersonaBullet[] = [];
      const econRows = econRes ?? [];
      const fragItems = fragRes?.items ?? [];
      const fragByCap = new Map(fragItems.map(f => [f.capabilityId, f]));

      // Top AI-exposure capabilities (highest score = most displaceable)
      const aiRanked = econRows
        .filter(r => r.aiExposureScore != null)
        .map(r => ({ row: r, frag: fragByCap.get(r.capabilityId) }))
        .filter(x => !!x.frag)
        .sort((a, b) => (b.row.aiExposureScore ?? 0) - (a.row.aiExposureScore ?? 0));

      const topAi = aiRanked[0];
      if (topAi && topAi.frag) {
        const score = Math.round((topAi.row.aiExposureScore ?? 0) * 100) / 100;
        const subs = (topAi.row.aiSubstitutes ?? []).slice(0, 2).join(", ");
        out.push({
          label: `Highest AI exposure: ${topAi.frag.capabilityName}`,
          detail: `${topAi.frag.industryName} — AI exposure ${score}${topAi.row.aiTimeToDisplacementMonths ? `, ~${Math.round(topAi.row.aiTimeToDisplacementMonths)}mo to displacement` : ""}${subs ? ` (${subs})` : ""}`,
        });
      }
      const topAi2 = aiRanked[1];
      if (topAi2 && topAi2.frag) {
        const score = Math.round((topAi2.row.aiExposureScore ?? 0) * 100) / 100;
        out.push({
          label: `Runner-up AI exposure: ${topAi2.frag.capabilityName}`,
          detail: `${topAi2.frag.industryName} — exposure ${score}; queue for stack-optimizer review`,
        });
      }

      // Most fragile capabilities (stack-replacement candidates)
      const critical = fragItems.filter(f => f.severity === "critical").slice(0, 3);
      if (critical.length > 0) {
        const first = critical[0]!;
        out.push({
          label: `${critical.length} critical-fragility capabilit${critical.length === 1 ? "y" : "ies"}`,
          detail: `Top: ${first.capabilityName} (${first.industryName}) — fragility ${first.fragilityScore}/100; stack-optimizer can propose substitutes`,
        });
      } else if (fragItems.length > 0) {
        const worst = fragItems[0]!;
        out.push({
          label: `Most fragile: ${worst.capabilityName}`,
          detail: `${worst.industryName} — fragility ${worst.fragilityScore}/100 (${worst.severity})${worst.halfLifeMonths ? `, ${Math.round(worst.halfLifeMonths)}mo half-life` : ""}`,
        });
      }

      // Aggregate AI exposure across portfolio
      if (aiRanked.length >= 3) {
        const avgExposure = aiRanked.reduce((s, x) => s + (x.row.aiExposureScore ?? 0), 0) / aiRanked.length;
        out.push({
          label: `Portfolio avg AI exposure: ${(Math.round(avgExposure * 100) / 100)}`,
          detail: `${aiRanked.length} capabilities scored — anything > 0.5 belongs on the stack-substitution roadmap this quarter`,
        });
      }

      if (!cancelled) {
        if (out.length === 0) setEmpty(true);
        else setBullets(out);
        setLoading(false);
      }
    }

    async function loadCHRO() {
      const talentRes = await fetch(`${API_BASE}/alpha/talent`).then(r => r.ok ? r.json() as Promise<{ items: TalentItem[] }> : Promise.reject()).catch(() => null);
      if (!talentRes || !talentRes.items || talentRes.items.length === 0) {
        // Endpoint exists but empty (no company mappings yet) — keep page intact with placeholder.
        if (!cancelled) {
          setPlaceholder("Talent-bottleneck data populates once company-capability mappings are enriched. Falling back to role focus until then.");
          setLoading(false);
        }
        return;
      }
      const items = talentRes.items;
      const out: PersonaBullet[] = [];

      const bottlenecks = items.filter(i => i.status === "bottleneck");
      if (bottlenecks.length > 0) {
        const worst = bottlenecks[0]!;
        out.push({
          label: `Top skills gap: ${worst.capabilityName}`,
          detail: `${worst.industryName} — bottleneck ${worst.bottleneckScore}/100 across ${worst.companies} firms; only ${worst.coreCount} have core mastery`,
        });
        if (bottlenecks.length > 1) {
          out.push({
            label: `${bottlenecks.length} bottleneck capabilities portfolio-wide`,
            detail: `Hiring/upskilling priorities — high competition × low mastery means market for these skills is liquid but expensive`,
          });
        }
      }

      const saturated = items.filter(i => i.status === "saturated").slice(0, 1);
      if (saturated.length > 0) {
        const s = saturated[0]!;
        out.push({
          label: `Saturated talent pool: ${s.capabilityName}`,
          detail: `${s.industryName} — ${Math.round(s.masteryRatio * 100)}% mastery rate across ${s.companies} firms; commodity skill, manage to market`,
        });
      }

      const emerging = items.filter(i => i.status === "emerging").slice(0, 1);
      if (emerging.length > 0) {
        const e = emerging[0]!;
        out.push({
          label: `Emerging skill frontier: ${e.capabilityName}`,
          detail: `${e.industryName} — only ${e.companies} firms in market; early-mover talent strategy advantage`,
        });
      }

      // Average mastery as portfolio-wide signal
      const avgMastery = items.reduce((s, i) => s + i.masteryRatio, 0) / items.length;
      out.push({
        label: `Portfolio talent mastery: ${Math.round(avgMastery * 100)}%`,
        detail: `${items.length} capabilities mapped — below 50% means workforce capability lags strategy on most lines`,
      });

      if (!cancelled) {
        if (out.length === 0) setEmpty(true);
        else setBullets(out);
        setLoading(false);
      }
    }

    if (slug === "ceo") void loadCEO();
    else if (slug === "cfo") void loadCFO();
    else if (slug === "cto") void loadCTO();
    else if (slug === "chro") void loadCHRO();
    else { setLoading(false); /* Other personas keep default page content only */ }

    return () => { cancelled = true; };
  }, [slug]);

  return { bullets, loading, empty, placeholder };
}

function useRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/csuite`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<Role[]>; })
      .then(data => { setRoles(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  return { roles, loading, error };
}

function usePerspective(slug: string | null) {
  const [perspective, setPerspective] = useState<Perspective | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(false);
    fetch(`${API_BASE}/csuite/${slug}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<{ role: Role; perspective: Perspective | null }>; })
      .then(data => { setPerspective(data.perspective); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [slug]);

  return { perspective, loading, error };
}

export default function CSuite() {
  const { roles, loading: rolesLoading, error: rolesError } = useRoles();
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    if (roles.length > 0 && !activeSlug) setActiveSlug(roles[0].slug);
  }, [roles, activeSlug]);

  const activeRole = roles.find(r => r.slug === activeSlug) ?? null;
  const activeIndex = activeRole ? roles.findIndex(r => r.slug === activeRole.slug) : -1;
  const { perspective, loading: perspLoading, error: perspError } = usePerspective(activeSlug);
  const personaFocus = usePersonaFocus(activeSlug);
  const hasPersonaSpecific = activeSlug === "ceo" || activeSlug === "cfo" || activeSlug === "cto" || activeSlug === "chro";

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead */}
      <header className="border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-12 pb-12 lg:pt-16 lg:pb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="grid lg:grid-cols-[1fr_auto] gap-10 lg:gap-16 items-end"
          >
            <div>
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Vol. I — C-Suite Perspectives</span>
              </div>
              <h1 className="font-serif text-5xl lg:text-7xl leading-[0.95] tracking-tight max-w-4xl">
                The framework,<br /><span className="italic text-foreground/70">by the seat.</span>
              </h1>
            </div>
            <p className="font-serif italic text-lg lg:text-xl text-foreground/60 leading-relaxed max-w-md">
              Capability economics isn't just for finance. Each executive role pulls a different lever — same framework, different question.
            </p>
          </motion.div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12 lg:py-16">
        {rolesLoading && (
          <div className="flex items-center justify-center py-32">
            <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        )}

        {rolesError && (
          <div className="border border-dashed border-border/60 py-16 text-center">
            <AlertTriangle className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Could not load roles</p>
          </div>
        )}

        {!rolesLoading && !rolesError && roles.length > 0 && (
          <div className="grid lg:grid-cols-[280px_1fr] gap-10 lg:gap-16">
            {/* Index sidebar */}
            <aside>
              <div className="lg:sticky lg:top-24">
                <div className="inline-flex items-center gap-2 mb-4 pb-3 border-b border-border/40 w-full">
                  <span className="h-px w-4 bg-accent" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-accent">Index</span>
                </div>
                <ol>
                  {roles.map((role, i) => {
                    const isActive = activeSlug === role.slug;
                    return (
                      <li key={role.slug}>
                        <button
                          onClick={() => setActiveSlug(role.slug)}
                          data-testid={`role-selector-${role.slug}`}
                          className={`w-full grid grid-cols-[36px_1fr] gap-3 py-3.5 border-b border-border/40 text-left transition-colors group ${
                            isActive ? "bg-muted/30" : "hover:bg-muted/20"
                          }`}
                        >
                          <span className={`font-mono text-[9px] tabular-nums tracking-[0.22em] pt-0.5 ${isActive ? "text-accent" : "text-muted-foreground/60"}`}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>
                            <span className={`font-serif text-lg leading-tight block ${isActive ? "text-foreground" : "text-foreground/65 group-hover:text-foreground"}`}>
                              {role.title}
                            </span>
                            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5 block">
                              {role.name}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </aside>

            {/* Active role panel */}
            <main>
              <AnimatePresence mode="wait">
                {activeRole && (
                  <motion.div
                    key={activeRole.slug}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {/* Role header */}
                    <div className="pb-12 border-b border-border/40">
                      <div className="inline-flex items-center gap-2 mb-5">
                        <span className="h-px w-5 bg-accent" />
                        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
                          {String(activeIndex + 1).padStart(2, "0")} — {activeRole.title}
                        </span>
                      </div>
                      <h2 className="font-serif text-5xl lg:text-6xl leading-[0.95] tracking-tight mb-6">
                        {activeRole.name}
                      </h2>
                      <div className="font-serif italic text-lg lg:text-xl text-foreground/60 leading-relaxed max-w-2xl">
                        Primary focus — <span className="not-italic text-foreground/80">{activeRole.focus}</span>
                      </div>
                    </div>

                    {perspLoading && (
                      <div className="flex items-center gap-3 py-16 text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Loading perspective…</span>
                      </div>
                    )}

                    {!perspLoading && (perspError || !perspective) && (
                      <div className="border border-dashed border-border/60 py-16 text-center mt-12">
                        <div className="inline-flex items-center gap-2 mb-3">
                          <RefreshCw className="w-4 h-4 text-muted-foreground/60 animate-spin" />
                          <Brain className="w-5 h-5 text-muted-foreground/50" />
                        </div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Regenerating perspective</p>
                        <p className="text-xs text-muted-foreground max-w-md mx-auto">
                          The agent is preparing this {activeRole.title} viewpoint with fresh research. New perspectives publish automatically as the agent finishes — refresh in a moment.
                        </p>
                      </div>
                    )}

                    {/* Persona-specific synthesis — only renders for CEO/CFO/CTO/CHRO.
                        Each pulls a different lens (moat, EVaR, AI exposure, talent
                        bottlenecks) so the same framework speaks differently to each
                        seat instead of showing identical data with different chrome. */}
                    {hasPersonaSpecific && (
                      <div className="py-12 border-b border-border/40">
                        <div className="inline-flex items-center gap-2 mb-5">
                          <span className="h-px w-5 bg-accent" />
                          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
                            § What the {activeRole.title} should focus on this quarter
                          </span>
                        </div>

                        {personaFocus.loading && (
                          <div className="flex items-center gap-3 py-4 text-muted-foreground">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Composing focus brief…</span>
                          </div>
                        )}

                        {!personaFocus.loading && personaFocus.placeholder && (
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground italic max-w-2xl">
                            Placeholder — {personaFocus.placeholder}
                          </p>
                        )}

                        {!personaFocus.loading && personaFocus.empty && !personaFocus.placeholder && (
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground italic max-w-2xl">
                            Placeholder — focus brief publishes once underlying enrichment data lands for this lens.
                          </p>
                        )}

                        {!personaFocus.loading && personaFocus.bullets.length > 0 && (
                          <ul className="space-y-0 max-w-3xl">
                            {personaFocus.bullets.map((b, i) => (
                              <li
                                key={i}
                                className="grid grid-cols-[36px_1fr] gap-3 py-4 border-b border-border/40 last:border-b-0"
                                data-testid={`persona-focus-bullet-${i}`}
                              >
                                <span className="font-mono text-[9px] tabular-nums tracking-[0.22em] text-accent pt-1">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span>
                                  <span className="font-serif text-lg leading-snug text-foreground/90 block">
                                    {b.label}
                                  </span>
                                  <span className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground leading-relaxed mt-1 block">
                                    {b.detail}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {!perspLoading && perspective && (
                      <>
                        {/* Scenario pull-quote */}
                        <div className="py-12 border-b border-border/40">
                          <div className="inline-flex items-center gap-2 mb-5">
                            <span className="h-px w-5 bg-accent" />
                            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ In action — a scenario</span>
                          </div>
                          <p className="font-serif text-2xl lg:text-3xl leading-[1.25] tracking-tight text-foreground/85 max-w-3xl">
                            {perspective.scenario}
                          </p>
                        </div>

                        {/* Capabilities + Radar */}
                        <div className="grid lg:grid-cols-[1fr_360px] gap-12 lg:gap-16 py-12 border-b border-border/40">
                          <div>
                            <div className="inline-flex items-center gap-2 mb-6">
                              <span className="h-px w-5 bg-accent" />
                              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Key capabilities managed</span>
                            </div>
                            <ul className="space-y-0">
                               {perspective.capabilities.map((cap, i) => (
                                 <li key={i} className="grid grid-cols-[36px_1fr] gap-3 py-3 border-b border-border/40 last:border-b-0">
                                   <span className="font-mono text-[9px] tabular-nums tracking-[0.22em] text-muted-foreground/60 pt-0.5">
                                     {String(i + 1).padStart(2, "0")}
                                   </span>
                                   <span className="font-serif text-lg leading-snug text-foreground/80">{cap}</span>
                                 </li>
                               ))}
                            </ul>

                            <div className="inline-flex items-center gap-2 mt-10 mb-4">
                              <span className="h-px w-5 bg-accent" />
                              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Economic metrics tracked</span>
                            </div>
                            <div className="flex flex-wrap gap-x-1 gap-y-2">
                              {perspective.metrics.map((metric, i) => (
                                <span
                                  key={i}
                                  className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/80 px-2.5 py-1 border border-border/60"
                                >
                                  {metric}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="inline-flex items-center gap-2 mb-4">
                              <span className="h-px w-4 bg-border/60" />
                              <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground">Capability radar</span>
                            </div>
                            <div className="h-[280px] w-full border border-border/40 p-2">
                              <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="72%" data={perspective.chartData}>
                                  <PolarGrid stroke="hsl(var(--muted-foreground) / 0.18)" />
                                  <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                  <Radar
                                    name={activeRole.title}
                                    dataKey="A"
                                    stroke="hsl(var(--accent))"
                                    fill="hsl(var(--accent))"
                                    fillOpacity={0.18}
                                    strokeWidth={1.5}
                                  />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>

                        {/* Questions they ask */}
                        <div className="py-12">
                          <div className="inline-flex items-center gap-2 mb-6">
                            <span className="h-px w-5 bg-accent" />
                            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Key questions they ask</span>
                          </div>
                          <ul className="space-y-0 max-w-3xl">
                            {perspective.questions.map((q, i) => (
                              <li key={i} className="grid grid-cols-[36px_1fr] gap-3 py-5 border-b border-border/40 last:border-b-0">
                                <span className="font-mono text-[9px] tabular-nums tracking-[0.22em] text-muted-foreground/60 pt-1">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className="font-serif italic text-lg lg:text-xl leading-relaxed text-foreground/85">
                                  &ldquo;{q}&rdquo;
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
