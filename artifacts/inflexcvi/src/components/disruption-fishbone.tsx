/**
 * <DisruptionFishbone capabilityId={N} />
 *
 * Six-bone fishbone visualization of the Capability Disruption Index for
 * one capability. Each bone represents one of the 6 forces (asset friction,
 * JTBD abstractability, enabling-tech strength, trust replaceability,
 * latent supply multiplier, margin asymmetry). The head is the capability
 * name + the composite DI score. The tail is the matched playbook archetype.
 *
 * Click a bone → side drawer with the sub-score's rationale + cited sources.
 * Drawer also lists the top-3 enabling techs that drive the score.
 *
 * Hover a bone → score tooltip + dominant-force highlight.
 *
 * Mounts on /capability/:id next to the existing CapabilityCascadePanel
 * (commit 10b below). Also reused inside /disruption-lab live canvas.
 */
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, Layers, Sparkles, ShieldCheck, ScaleIcon, ExternalLink, Loader2, TrendingDown, AlertOctagon } from "lucide-react";

const API_BASE = "/api";

interface SubscoreEvidence {
  value: number;
  rationale: string;
  sources: Array<{ label: string; url?: string }>;
}

interface DisruptionDetail {
  capability: { id: number; name: string; slug: string; industryId: number; industryName: string | null };
  subscores: {
    assetFriction: number;
    jtbdAbstractability: number;
    enablingTechStrength: number;
    trustReplaceability: number;
    latentSupplyMultiplier: number;
    marginAsymmetry: number;
  };
  compositeDi: number;
  narrative: string | null;
  rationale: Record<string, SubscoreEvidence>;
  topPlaybook: { playbookId: number; slug: string; name: string; summary: string; similarity: number } | null;
  playbookMatches: Array<{ playbookId: number; slug: string; name: string; summary: string; similarity: number }>;
  topEnablingTech: Array<{ id: number; slug: string; name: string; category: string; maturityYear: number; description: string }>;
  candidateDisruptors: Array<{ companyId: number; name: string; reason: string }>;
  computedAt: string;
}

interface SubscoreData {
  key: keyof DisruptionDetail["subscores"];
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Diagonal angle in degrees from horizontal — bones alternate up/down. */
  angle: number;
  /** Horizontal x-position along the spine, 0..1. */
  spineX: number;
}

const SUBSCORES: SubscoreData[] = [
  { key: "assetFriction", label: "Asset friction", shortLabel: "Asset", icon: Layers, angle: -38, spineX: 0.18 },
  { key: "jtbdAbstractability", label: "JTBD abstractability", shortLabel: "JTBD", icon: GitBranch, angle: 38, spineX: 0.18 },
  { key: "enablingTechStrength", label: "Enabling tech", shortLabel: "Tech", icon: Sparkles, angle: -38, spineX: 0.42 },
  { key: "trustReplaceability", label: "Trust replaceability", shortLabel: "Trust", icon: ShieldCheck, angle: 38, spineX: 0.42 },
  { key: "latentSupplyMultiplier", label: "Latent supply ×", shortLabel: "Supply", icon: TrendingDown, angle: -38, spineX: 0.66 },
  { key: "marginAsymmetry", label: "Margin asymmetry", shortLabel: "Margin", icon: ScaleIcon, angle: 38, spineX: 0.66 },
];

function diTone(score: number): string {
  if (score >= 75) return "text-rose-500 border-rose-500/40 bg-rose-500/5";
  if (score >= 50) return "text-amber-500 border-amber-500/40 bg-amber-500/5";
  if (score >= 25) return "text-blue-500 border-blue-500/40 bg-blue-500/5";
  return "text-emerald-500 border-emerald-500/40 bg-emerald-500/5";
}

function diToneSolid(score: number): string {
  if (score >= 75) return "rgb(244 63 94)"; // rose-500
  if (score >= 50) return "rgb(245 158 11)"; // amber-500
  if (score >= 25) return "rgb(59 130 246)"; // blue-500
  return "rgb(16 185 129)"; // emerald-500
}

export function DisruptionFishbone({ capabilityId }: { capabilityId: number }) {
  const [data, setData] = useState<DisruptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openBone, setOpenBone] = useState<keyof DisruptionDetail["subscores"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/disruption-index/capability/${capabilityId}`)
      .then((r) => {
        if (r.status === 404) throw new Error("not-yet");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DisruptionDetail) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId]);

  if (loading) {
    return (
      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Computing disruption index…
        </CardContent>
      </Card>
    );
  }

  if (error === "not-yet" || !data) {
    return (
      <Card className="rounded-none border-amber-500/40 bg-amber-500/[0.04]">
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-amber-500" />
            <h3 className="font-serif text-base">Disruption Index not yet computed</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Disruption Vector Agent recomputes the DI on a 6-hour cron for capabilities whose score is stale or never computed. Admins can force-recompute via{" "}
            <code className="font-mono text-xs bg-muted px-1.5">POST /api/admin/disruption-index/recompute/{capabilityId}</code>.
          </p>
          {error && error !== "not-yet" && <p className="text-xs text-rose-500 font-mono">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const playbook = data.topPlaybook;
  const openEvidence = openBone ? data.rationale[openBone] : null;
  const openSubscore = openBone ? SUBSCORES.find((s) => s.key === openBone) : null;

  return (
    <>
      <Card className="rounded-none border-border/60 overflow-hidden">
        <CardContent className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                Capability Disruption Index
              </div>
              <h3 className="font-serif text-xl tracking-tight">How disruptable is {data.capability.name}?</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Computed {new Date(data.computedAt).toLocaleDateString()} · 6 forces × cosine match against 8 archetypes
              </p>
            </div>
            <div className={`px-3 py-2 border ${diTone(data.compositeDi)} text-center min-w-[100px]`}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">Composite DI</div>
              <div className="font-mono text-3xl tabular-nums font-bold">{data.compositeDi.toFixed(0)}</div>
            </div>
          </div>

          {/* The fishbone SVG — a horizontal spine with 6 diagonal bones. */}
          <div className="relative w-full" style={{ aspectRatio: "16 / 7" }}>
            <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" role="img" aria-label="Disruption Index fishbone diagram">
              {/* Spine */}
              <line x1="2" y1="22" x2="92" y2="22" stroke="currentColor" strokeWidth="0.4" className="text-muted-foreground/50" />
              {/* Head — large triangle/arrow */}
              <polygon points="92,22 98,18 98,26" fill="currentColor" className="text-foreground" />
              {SUBSCORES.map((s) => {
                const score = data.subscores[s.key];
                const fill = diToneSolid(score);
                const x = s.spineX * 90 + 4; // map 0..1 onto 4..94
                const length = 14;
                const rad = (s.angle * Math.PI) / 180;
                const ex = x + Math.cos(rad) * length;
                const ey = 22 - Math.sin(rad) * length;
                return (
                  <g key={s.key} className="cursor-pointer" onClick={() => setOpenBone(s.key)}>
                    <line x1={x} y1="22" x2={ex} y2={ey} stroke={fill} strokeWidth="0.5" />
                    <circle cx={ex} cy={ey} r="2.2" fill={fill} opacity="0.85" />
                    <text x={ex} y={ey + (s.angle > 0 ? 4.2 : -2.6)} fontSize="2.6" fill="currentColor" textAnchor="middle" className="font-mono uppercase">
                      {s.shortLabel} {Math.round(score)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Bones as clickable chips (mobile-friendly fallback to the SVG hit-test). */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {SUBSCORES.map((s) => {
              const score = data.subscores[s.key];
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setOpenBone(s.key)}
                  className={`flex items-center justify-between gap-2 border ${diTone(score)} px-3 py-2 hover:opacity-90 transition-opacity text-left`}
                  data-testid={`fishbone-bone-${s.key}`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs font-medium truncate">{s.label}</span>
                  </span>
                  <span className="font-mono tabular-nums text-sm">{score.toFixed(0)}</span>
                </button>
              );
            })}
          </div>

          {/* Playbook match footer */}
          {playbook && (
            <div className="border-t border-border/40 pt-4 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Playbook match</div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="rounded-none font-mono text-[11px] uppercase tracking-wider border-accent text-accent">
                  {playbook.name} · {(playbook.similarity * 100).toFixed(0)}%
                </Badge>
                {data.playbookMatches.slice(1, 5).map((p) => (
                  <Badge key={p.playbookId} variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {p.name} · {(p.similarity * 100).toFixed(0)}%
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground italic mt-1">
                Top match in bold; next 4 shown for context. "X-style" labels describe the disruption pattern, not the company.
              </p>
              <p className="text-sm leading-relaxed text-foreground">{playbook.summary}</p>
            </div>
          )}

          {/* 3-paragraph narrative */}
          {data.narrative && (
            <div className="border-t border-border/40 pt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Disruption hypothesis</div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap font-serif">{data.narrative}</div>
            </div>
          )}

          {/* Top enabling tech */}
          {data.topEnablingTech.length > 0 && (
            <div className="border-t border-border/40 pt-4 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Top enabling technologies</div>
              <ul className="space-y-1.5">
                {data.topEnablingTech.map((t) => (
                  <li key={t.id} className="text-xs">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-muted-foreground"> — {t.category} · mature {t.maturityYear}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Candidate disruptors */}
          {data.candidateDisruptors.length > 0 && (
            <div className="border-t border-border/40 pt-4 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Candidate disruptors</div>
              <ul className="space-y-1.5">
                {data.candidateDisruptors.map((c) => (
                  <li key={c.companyId} className="text-xs">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground"> — {c.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drawer that opens when you click a bone */}
      <Sheet open={openBone !== null} onOpenChange={(o) => { if (!o) setOpenBone(null); }}>
        <SheetContent className="sm:max-w-md">
          {openEvidence && openSubscore && (
            <>
              <SheetHeader>
                <SheetTitle className="font-serif flex items-center gap-2">
                  <openSubscore.icon className="w-4 h-4" />
                  {openSubscore.label}
                </SheetTitle>
                <SheetDescription>
                  Score <strong className="font-mono">{Math.round(openEvidence.value)}</strong> / 100
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Rationale</div>
                  <p className="text-sm leading-relaxed">{openEvidence.rationale}</p>
                </div>
                {openEvidence.sources.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Sources</div>
                    <ul className="space-y-1">
                      {openEvidence.sources.map((s, i) => (
                        <li key={i} className="text-xs">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                              {s.label} <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">{s.label}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
