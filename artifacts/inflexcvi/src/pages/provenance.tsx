/**
 * /provenance — "where does our data come from"
 *
 * Move 9 of the strategic UX overhaul. The user's strategic note 2026-05-19:
 * "I don't want everything based on Perplexity. Anybody can build a site
 * off Perplexity." This page is the public answer — every primary source
 * the platform routes through, what it powers, and how we tier confidence.
 *
 * Structure mirrors the SOURCE_GROUPS from lib/data-sources.ts so the
 * page and the registry stay in lockstep — adding a new source updates
 * both the page and the SourceBadge palette in one edit.
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Database, ExternalLink, ArrowLeft, ShieldCheck, AlertCircle, Activity, RefreshCw, AlertOctagon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PersonaDescription } from "@/components/page-header";
import { DATA_SOURCES, SOURCE_GROUPS, type DataSource } from "@/lib/data-sources";

interface SourceStats {
  totalSources: number;
  queriedLast7d: number;
  mostActiveSource: string | null;
  mostActiveSourceCount: number;
  contradictedLast7d: number;
}

const TRUST_TONE: Record<DataSource["trust"], string> = {
  high: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  low: "bg-rose-500/10 text-rose-500 border-rose-500/30",
};

export default function ProvenancePage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <div>
        <Link href="/methodology" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Methodology
        </Link>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ Data sources</span>
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">Where our data comes from</h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-3xl leading-relaxed">
          We are not a Perplexity wrapper. The Capability Value Index is computed from a stack of authoritative data feeds —
          World Bank for GDP weights, Palantir Foundry for pipeline ingest, World Economic Forum frameworks for scoring
          calibration, BEA for US sector splits, USPTO and SEC EDGAR for real-time signals. Language models are used only
          where they earn their keep: narrative synthesis, structured extraction, and cited-research augmentation — with
          confidence tiers that downweight model output relative to primary data.
        </p>
        <PersonaDescription
          descriptions={{
            default: "Each source below shows what it powers, its trust tier in our scoring engine, and a link to the upstream feed.",
            pe: "Trust tiers matter for diligence. Scores cited from high-trust feeds (World Bank, Foundry, EDGAR) are weighted more heavily than LLM-augmented research; the column flagged 'low trust' should be treated as a research lead, not a fact.",
            vc: "When you cite a CVI number in a partner meeting, the badge next to it tells you whether the underlying source is primary data or LLM-augmented research. Press the badge for the citation surface.",
            f500: "Audit-friendly. Every score in the platform can be traced to a source listed here — your data-governance team can review the upstream feeds for inclusion in board materials.",
            student: "The trust tiers explain why some scores have wider confidence intervals than others. Read /methodology for the math; this page is the data layer underneath.",
            professor: "Citable. Each source has a homepage link suitable for footnote citation. Tier breakdown lets students argue about source weights as part of an assignment.",
          }}
          className="mt-6"
        />
      </div>

      <SourceStatsPanel />

      {SOURCE_GROUPS.map(group => (
        <section key={group.heading}>
          <div className="mb-4">
            <h2 className="font-serif text-2xl tracking-tight">{group.heading}</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{group.description}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {group.slugs.map(slug => {
              const s = DATA_SOURCES[slug];
              return (
                <Card key={slug}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <Database className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">{s.label}</span>
                      </div>
                      <Badge className={`rounded-full text-[10px] uppercase tracking-wider border ${TRUST_TONE[s.trust]}`}>
                        {s.trust === "high" ? <ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> : s.trust === "low" ? <AlertCircle className="w-2.5 h-2.5 mr-0.5" /> : null}
                        {s.trust} trust
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">{s.description}</p>
                    {s.surfaceExamples && s.surfaceExamples.length > 0 && (
                      <div className="mt-2">
                        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground-soft mb-1">Shows up in</div>
                        <ul className="text-[11px] text-foreground/80 space-y-0.5">
                          {s.surfaceExamples.map(ex => (
                            <li key={ex} className="before:content-['—'] before:text-muted-foreground before:mr-1.5">{ex}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {s.homepage && (
                      <div className="mt-2.5 pt-2 border-t border-border/40">
                        <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                          <ExternalLink className="w-2.5 h-2.5" />
                          {new URL(s.homepage).hostname}
                        </a>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      <Separator />

      <Card className="bg-muted/20">
        <CardContent className="p-5 text-sm leading-relaxed">
          <h3 className="font-serif text-lg tracking-tight mb-2">How trust tiers affect scoring</h3>
          <p className="text-muted-foreground">
            Primary-data sources (World Bank, Foundry, EDGAR, USPTO) are weighted at their face value in the Bayesian
            posterior. LLM-augmented research (Perplexity-seeded, Claude-synthesized) is downweighted by a configurable
            factor in <Link href="/methodology" className="text-primary hover:underline">our methodology</Link>; the
            confidence interval widens accordingly. This is why two scores with the same number can have very different
            CI bars — the underlying source mix is different.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Live source-quality stats — pulls aggregate counts from
 * /api/source-quality/stats (backed by the source_triangulations table).
 * Surfaced at the top of /provenance so the static source registry below
 * has a verifiable, real-time counterpart: how many sources, how active
 * have they been this week, which one is doing the heaviest lifting, and
 * how often do they disagree with each other.
 */
function SourceStatsPanel() {
  const { data, isLoading, isError } = useQuery<SourceStats>({
    queryKey: ["source-quality-stats"],
    queryFn: async () => {
      const res = await fetch("/api/source-quality/stats");
      if (!res.ok) throw new Error(`/api/source-quality/stats → ${res.status}`);
      return res.json();
    },
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    retry: 1,
  });

  const tile = (label: string, value: React.ReactNode, icon: React.ReactNode, sub?: string) => (
    <div className="border border-border/60 rounded-none p-3 bg-muted/20">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="font-serif text-2xl tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div>
          <h3 className="font-serif text-lg tracking-tight">Source query / contradict stats</h3>
          <p className="text-xs text-muted-foreground">
            Aggregate activity across <code>source_triangulations</code> — refreshed every 5 minutes from the live database.
          </p>
        </div>
        {isLoading && <p className="text-xs text-muted-foreground">Loading source stats…</p>}
        {isError && <p className="text-xs text-rose-500">Couldn&apos;t reach /api/source-quality/stats.</p>}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tile("Total sources", data.totalSources.toLocaleString(), <Database className="w-3.5 h-3.5 text-muted-foreground" />, "all-time triangulations")}
            {tile("Queried (7d)", data.queriedLast7d.toLocaleString(), <RefreshCw className="w-3.5 h-3.5 text-blue-500" />, "rows added this week")}
            {tile(
              "Most active source",
              <span className="text-base">{data.mostActiveSource ?? "—"}</span>,
              <Activity className="w-3.5 h-3.5 text-emerald-500" />,
              data.mostActiveSource ? `${data.mostActiveSourceCount.toLocaleString()} queries (7d)` : "no activity",
            )}
            {tile("Contradicted (7d)", data.contradictedLast7d.toLocaleString(), <AlertOctagon className="w-3.5 h-3.5 text-amber-500" />, ">25-pt disagreement vs peer mean")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
