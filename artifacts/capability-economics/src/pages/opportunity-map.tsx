import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Map, Flame, Sparkles, Snowflake, Anchor, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type QuadrantPoint = {
  id: number;
  name: string;
  stage: string | null;
  isLeaf: boolean;
  score: number;
  velocity: number;
  confidence: number;
  quadrant: "hot" | "emerging" | "cooling" | "table_stakes";
};

const QUADRANT_META = {
  emerging: {
    label: "Emerging",
    sublabel: "Founder sweet spot",
    description: "Low saturation, accelerating velocity. White space waiting for a focused entrant.",
    icon: Sparkles,
    accent: "from-emerald-500/20 via-emerald-500/5 to-transparent border-emerald-500/40",
    badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/40",
    headerClass: "text-emerald-600",
    highlight: true,
  },
  hot: {
    label: "Hot",
    sublabel: "High saturation, still climbing",
    description: "Crowded but growing. Differentiation matters more than category creation.",
    icon: Flame,
    accent: "from-rose-500/15 via-rose-500/5 to-transparent border-rose-500/30",
    badgeClass: "bg-rose-500/10 text-rose-600 border-rose-500/30",
    headerClass: "text-rose-600",
    highlight: false,
  },
  cooling: {
    label: "Cooling",
    sublabel: "Mature, decelerating",
    description: "High saturation but velocity turning negative. Risk of disruption from below.",
    icon: Snowflake,
    accent: "from-sky-500/15 via-sky-500/5 to-transparent border-sky-500/30",
    badgeClass: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    headerClass: "text-sky-600",
    highlight: false,
  },
  table_stakes: {
    label: "Table Stakes",
    sublabel: "Low velocity, low score",
    description: "Necessary but undifferentiated. Hard to win on this alone.",
    icon: Anchor,
    accent: "from-muted-foreground/10 via-muted-foreground/5 to-transparent border-muted-foreground/20",
    badgeClass: "bg-muted text-muted-foreground border-muted-foreground/20",
    headerClass: "text-muted-foreground",
    highlight: false,
  },
} as const;

export default function OpportunityMap() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [points, setPoints] = useState<QuadrantPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/industries`)
      .then((r) => r.json())
      .then((d) => {
        const list: Industry[] = d.industries ?? d ?? [];
        setIndustries(list);
        if (list.length && industryId === null) setIndustryId(list[0].id);
      });
  }, []);

  useEffect(() => {
    if (industryId === null) return;
    setLoading(true);
    fetch(`${API_BASE}/workbench/quadrant/${industryId}`)
      .then((r) => r.json())
      .then((d) => {
        setPoints((d.points ?? []).filter((p: QuadrantPoint) => p.isLeaf !== false));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [industryId]);

  const grouped = useMemo(() => {
    const buckets: Record<QuadrantPoint["quadrant"], QuadrantPoint[]> = {
      emerging: [],
      hot: [],
      cooling: [],
      table_stakes: [],
    };
    for (const p of points) buckets[p.quadrant].push(p);
    for (const k of Object.keys(buckets) as Array<keyof typeof buckets>) {
      buckets[k].sort((a, b) => b.velocity - a.velocity);
    }
    return buckets;
  }, [points]);

  const order: QuadrantPoint["quadrant"][] = ["emerging", "hot", "cooling", "table_stakes"];

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Discover · Opportunity Map</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Map className="w-8 h-8 text-primary" />
          Opportunity Map
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Where the white space is. Capabilities sorted by saturation versus velocity — the Emerging quadrant is
          the founder sweet spot: room to win, demand still climbing.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="min-w-[260px]">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Industry</p>
            <Select value={industryId ? String(industryId) : ""} onValueChange={(v) => setIndustryId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Pick an industry" /></SelectTrigger>
              <SelectContent>
                {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            {loading ? (
              <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</span>
            ) : (
              <span>{points.length} leaf capabilities mapped</span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {order.map((q) => {
          const meta = QUADRANT_META[q];
          const Icon = meta.icon;
          const items = grouped[q];
          return (
            <Card
              key={q}
              className={`relative overflow-hidden bg-gradient-to-br ${meta.accent} ${meta.highlight ? "ring-2 ring-emerald-500/30" : ""}`}
            >
              {meta.highlight && (
                <div className="absolute top-3 right-3">
                  <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">Sweet spot</Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className={`flex items-center gap-2 font-serif text-2xl ${meta.headerClass}`}>
                  <Icon className="w-5 h-5" />
                  {meta.label}
                </CardTitle>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{meta.sublabel}</p>
                <p className="text-sm text-muted-foreground">{meta.description}</p>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No capabilities in this quadrant.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((p) => (
                      <Badge
                        key={p.id}
                        variant="outline"
                        className={`${meta.badgeClass} font-mono text-[11px]`}
                        title={`Score ${p.score} · velocity ${p.velocity > 0 ? "+" : ""}${p.velocity.toFixed(2)} · conf ${(p.confidence * 100).toFixed(0)}%`}
                      >
                        {p.name}
                        <span className="ml-1.5 opacity-60">{p.score.toFixed(0)}</span>
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
