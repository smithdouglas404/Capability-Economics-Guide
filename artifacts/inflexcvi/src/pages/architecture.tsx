/**
 * /architecture — "Five Interconnected Modules" pentagram overview.
 *
 * Spec: deck p4. Five circles arranged in a pentagram (CVI Index top,
 * Capability Assessment upper-right, Insights & Alerts lower-right,
 * C-Suite Intelligence lower-left, Knowledge Graph upper-left), connected
 * with dashed edges. Each circle is clickable → its module page. Tagline
 * underneath: "All modules share a unified capability ontology and
 * research memory layer."
 *
 * Implemented as absolute-positioned divs over a relative-positioned
 * container with SVG lines drawn between centers. Responsive: collapses
 * to a vertical stack on small screens.
 */
import { Link } from "wouter";
import { ArrowLeft, Activity, ScanSearch, Lightbulb, Users, Network, CheckCircle2, AlertTriangle, MinusCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useServiceHealth, type ServiceStatus } from "@/hooks/use-service-health";

interface Module {
  slug: string;
  label: string;
  sub: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Polar coordinates: (angleDeg, radiusPct). 12 o'clock is 90°, going CCW. */
  pos: { angle: number; radius: number };
  tone: "blue" | "amber" | "violet" | "emerald" | "rose";
}

const MODULES: Module[] = [
  { slug: "cvi",       label: "CVI",             sub: "Index",            href: "/cvi",             icon: Activity,    pos: { angle: 90,  radius: 38 }, tone: "blue" },
  { slug: "capability",label: "Capability",      sub: "Assessment",       href: "/assess",          icon: ScanSearch,  pos: { angle: 18,  radius: 38 }, tone: "blue" },
  { slug: "insights",  label: "Insights",        sub: "& Alerts",         href: "/insights",        icon: Lightbulb,   pos: { angle: -54, radius: 38 }, tone: "emerald" },
  { slug: "c-suite",   label: "C-Suite",         sub: "Intelligence",     href: "/c-suite",         icon: Users,       pos: { angle: 234, radius: 38 }, tone: "violet" },
  { slug: "knowledge", label: "Knowledge",       sub: "Graph",            href: "/knowledge-graph", icon: Network,     pos: { angle: 162, radius: 38 }, tone: "amber" },
];

const TONE: Record<Module["tone"], { ring: string; bg: string; label: string; dot: string }> = {
  blue:    { ring: "border-primary/60",    bg: "bg-primary/10",    label: "text-primary",    dot: "bg-primary" },
  amber:   { ring: "border-amber-500/60",   bg: "bg-amber-500/10",   label: "text-amber-500",   dot: "bg-amber-500" },
  violet:  { ring: "border-violet-500/60",  bg: "bg-violet-500/10",  label: "text-violet-500",  dot: "bg-violet-500" },
  emerald: { ring: "border-emerald-500/60", bg: "bg-emerald-500/10", label: "text-emerald-500", dot: "bg-emerald-500" },
  rose:    { ring: "border-rose-500/60",    bg: "bg-rose-500/10",    label: "text-rose-500",    dot: "bg-rose-500" },
};

/** Convert (angle°, radius%) into a (left%, top%) pair for absolute positioning
 *  inside a square container. Angle 90° puts the node at the top, 0° on the right. */
function polarToCss(angle: number, radius: number): { left: string; top: string } {
  const rad = (angle * Math.PI) / 180;
  const x = 50 + radius * Math.cos(rad);
  const y = 50 - radius * Math.sin(rad);
  return { left: `${x.toFixed(2)}%`, top: `${y.toFixed(2)}%` };
}

export default function ArchitecturePage() {
  // Edge list — full graph: every module connected to every other so the
  // "unified ontology" message is visually obvious.
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < MODULES.length; i++) {
    for (let j = i + 1; j < MODULES.length; j++) edges.push([i, j]);
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>

      <PageHeader
        eyebrow="Architecture"
        title="Five Interconnected Modules"
        descriptions={{
          default: "Every module shares a unified capability ontology and research-memory layer — pull a thread anywhere and it shows up everywhere.",
          pe: "One ontology, five entry points. The diligence flow walks CVI → Capability Assessment → C-Suite Intelligence. Insights ride alongside; Knowledge Graph backs everything.",
          vc: "Pick your entry: Knowledge Graph if you're mapping a sector, CVI if you're tracking a trend, Capability Assessment if you're prepping a meeting.",
          f500: "Same five modules, different starting point per role. CFO usually starts at CVI; CTO at Knowledge Graph; CHRO at C-Suite Intelligence.",
          student: "These are the five primitives behind every screen on the site. Methodology + math at /methodology; sources at /provenance.",
          professor: "Architectural overview — each circle is a citable module. The unified-ontology claim is the methodological backbone for cross-industry pattern comparison.",
        }}
      />

      {/* Pentagram diagram */}
      <Card>
        <CardContent className="p-6">
          <div className="relative w-full max-w-2xl mx-auto aspect-square">
            {/* SVG edges layer */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" preserveAspectRatio="none" role="img" aria-label="Pentagram diagram showing the five core Inflexcvi modules connected by shared ontology and memory edges">
              <title>Inflexcvi platform module map</title>
              <desc>Five interconnected modules — Capability Value Index, Disruption Watch, VCR (research), Alpha, Knowledge Graph — sharing a unified capability ontology + research memory layer.</desc>
              {edges.map(([a, b], i) => {
                const A = polarToCss(MODULES[a].pos.angle, MODULES[a].pos.radius);
                const B = polarToCss(MODULES[b].pos.angle, MODULES[b].pos.radius);
                return (
                  <line
                    key={i}
                    x1={parseFloat(A.left)} y1={parseFloat(A.top)}
                    x2={parseFloat(B.left)} y2={parseFloat(B.top)}
                    stroke="currentColor"
                    strokeWidth="0.25"
                    strokeDasharray="0.8 0.8"
                    className="text-muted-foreground/40"
                  >
                    <title>{MODULES[a].label} ↔ {MODULES[b].label}</title>
                  </line>
                );
              })}
            </svg>
            {/* Module circles */}
            {MODULES.map(m => {
              const t = TONE[m.tone];
              const pos = polarToCss(m.pos.angle, m.pos.radius);
              const Icon = m.icon;
              return (
                <Link
                  key={m.slug}
                  href={m.href}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group"
                  style={{ left: pos.left, top: pos.top }}
                >
                  <div className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full border-2 ${t.ring} ${t.bg} flex flex-col items-center justify-center text-center px-2 transition-transform group-hover:scale-110 backdrop-blur-sm`}>
                    <Icon className={`w-4 h-4 mb-1 ${t.label}`} />
                    <div className={`font-medium text-sm ${t.label}`}>{m.label}</div>
                    <div className="text-[10px] text-foreground/70">{m.sub}</div>
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-4 italic">
            All modules share a unified capability ontology and research memory layer.
          </p>
        </CardContent>
      </Card>

      {/* Module list — accessible alternative + quick links */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MODULES.map(m => {
          const t = TONE[m.tone];
          const Icon = m.icon;
          return (
            <Link key={m.slug} href={m.href}>
              <Card className={`hover:${t.ring} hover:bg-muted/30 transition-colors cursor-pointer h-full`}>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full ${t.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${t.label}`} />
                  </div>
                  <div>
                    <div className={`font-medium text-sm ${t.label}`}>{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.sub}</div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground-soft mt-1.5">{m.href}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <LiveModuleStatus />
    </div>
  );
}

const STATUS_TONE: Record<ServiceStatus, { icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
  ok:              { icon: CheckCircle2, cls: "text-emerald-500", label: "ok" },
  degraded:        { icon: AlertTriangle, cls: "text-amber-500",   label: "degraded" },
  down:            { icon: AlertTriangle, cls: "text-rose-500",    label: "down" },
  not_configured:  { icon: MinusCircle,   cls: "text-muted-foreground", label: "not configured" },
  initializing:    { icon: Loader2,       cls: "text-primary",    label: "initializing" },
};

/**
 * Live module status — pulls /api/health/services so the static "Five
 * Interconnected Modules" diagram above has a verifiable, real-time
 * counterpart. Refreshes every 60s via the shared useServiceHealth hook.
 */
function LiveModuleStatus() {
  const { data, isLoading, isError } = useServiceHealth();
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-serif text-lg tracking-tight">Live module status</h3>
            <p className="text-xs text-muted-foreground">
              Real-time health of the upstream services that back every module above. Refreshes every 60 seconds.
            </p>
          </div>
          {data && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              overall: {data.overall.replace("_", " ")}
            </Badge>
          )}
        </div>
        {isLoading && <p className="text-xs text-muted-foreground">Loading service status…</p>}
        {isError && <p className="text-xs text-rose-500">Couldn&apos;t reach /api/health/services.</p>}
        {data && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.services.map(s => {
              const tone = STATUS_TONE[s.status];
              const Icon = tone.icon;
              return (
                <div key={s.service} className="flex items-center justify-between gap-2 border border-border/60 rounded-none px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${tone.cls} ${s.status === "initializing" ? "animate-spin" : ""}`} />
                    <span className="text-sm font-medium truncate">{s.service}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{tone.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground-soft tabular-nums">
                      {s.latencyMs != null ? `${s.latencyMs}ms` : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
