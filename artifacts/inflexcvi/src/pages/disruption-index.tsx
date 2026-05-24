/**
 * /disruption-index — the listing screen for the Capability Disruption Index.
 *
 * Sortable, filterable table view of every capability whose DI has been
 * computed. Each row drills into /capability/:id where the DisruptionFishbone
 * renders the full per-cap detail.
 *
 * Two reader modes (matched to PE/F500 vs VC/entrepreneur):
 *   - Defender mode: filter to your industry → see your portfolio's risk
 *   - Hunter mode:   filter to a playbook archetype → see capabilities
 *                    where Uber/Airbnb/OpenAI-class disruption is likeliest
 *
 * Persona-tailored hero descriptions for PE / VC / F500 / student / professor.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowUpDown, GitBranch, Layers, Sparkles, ShieldCheck, TrendingDown, ScaleIcon, Flame, Loader2, Search, LayoutGrid, List as ListIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, PersonaDescription } from "@/components/page-header";

const API_BASE = "/api";

interface DiRow {
  id: number;
  capabilityId: number;
  capabilityName: string;
  capabilitySlug: string;
  industryId: number;
  industryName: string;
  assetFriction: number;
  jtbdAbstractability: number;
  enablingTechStrength: number;
  trustReplaceability: number;
  latentSupplyMultiplier: number;
  marginAsymmetry: number;
  compositeDi: number;
  topPlaybookId: number | null;
  topPlaybookSimilarity: number | null;
  topPlaybookName: string | null;
  topPlaybookSlug: string | null;
  topEnablingTechIds: number[];
  computedAt: string;
  dominantForce: string;
}

interface Industry { id: number; name: string }
interface Archetype { id: number; slug: string; name: string; summary: string }

interface PlaybookMatch { playbookId: number; slug: string; name: string; similarity: number }
interface IndustryGroupCap {
  capabilityId: number;
  capabilityName: string;
  capabilitySlug: string;
  compositeDi: number;
  subscores: Record<string, number>;
  topPlaybook: { id: number; name: string; slug: string; similarity: number } | null;
  top5PlaybookMatches: PlaybookMatch[];
  rank: number;
}
interface IndustryGroup {
  industryId: number;
  industryName: string;
  industrySlug: string;
  capabilities: IndustryGroupCap[];
}

const SORTABLE: Array<{ key: string; label: string }> = [
  { key: "composite_di", label: "Composite DI" },
  { key: "asset_friction", label: "Asset Friction" },
  { key: "enabling_tech_strength", label: "Enabling Tech" },
  { key: "jtbd_abstractability", label: "JTBD" },
  { key: "trust_replaceability", label: "Trust Replace." },
  { key: "latent_supply_multiplier", label: "Supply ×" },
  { key: "margin_asymmetry", label: "Margin Asym." },
];

const DOMINANT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  assetFriction: Layers,
  jtbdAbstractability: GitBranch,
  enablingTechStrength: Sparkles,
  trustReplaceability: ShieldCheck,
  latentSupplyMultiplier: TrendingDown,
  marginAsymmetry: ScaleIcon,
};

const DOMINANT_LABEL: Record<string, string> = {
  assetFriction: "Asset",
  jtbdAbstractability: "JTBD",
  enablingTechStrength: "Tech",
  trustReplaceability: "Trust",
  latentSupplyMultiplier: "Supply",
  marginAsymmetry: "Margin",
};

function diTone(score: number): string {
  if (score >= 75) return "text-rose-500 bg-rose-500/10 border-rose-500/40";
  if (score >= 50) return "text-amber-500 bg-amber-500/10 border-amber-500/40";
  if (score >= 25) return "text-blue-500 bg-blue-500/10 border-blue-500/40";
  return "text-emerald-500 bg-emerald-500/10 border-emerald-500/40";
}

export default function DisruptionIndexPage() {
  const [rows, setRows] = useState<DiRow[]>([]);
  const [total, setTotal] = useState(0);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [byIndustry, setByIndustry] = useState<IndustryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"per-industry" | "table">("per-industry");

  // Filters
  const [industryId, setIndustryId] = useState<string>("all");
  const [playbookSlug, setPlaybookSlug] = useState<string>("all");
  const [minDi, setMinDi] = useState<number>(0);
  const [searchText, setSearchText] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("composite_di");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Load filter sources once.
  useEffect(() => {
    fetch(`${API_BASE}/industries`).then((r) => r.json()).then((r: Industry[]) => setIndustries(r)).catch(() => {});
    fetch(`${API_BASE}/disruption-index/archetypes`).then((r) => r.json()).then((d: { archetypes: Archetype[] }) => setArchetypes(d.archetypes ?? [])).catch(() => {});
  }, []);

  // Load grouped-by-industry view (top-5 per industry).
  useEffect(() => {
    fetch(`${API_BASE}/disruption-index/by-industry?topPerIndustry=5&minDi=${minDi}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d: { industries: IndustryGroup[] }) => setByIndustry(d.industries ?? []))
      .catch(() => {});
  }, [minDi]);

  // Load DI list on filter change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      limit: "100",
      sortBy,
      sortDir,
      minDi: String(minDi),
    });
    if (industryId !== "all") params.set("industryId", industryId);
    if (playbookSlug !== "all") params.set("playbookSlug", playbookSlug);
    fetch(`${API_BASE}/disruption-index?${params.toString()}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { rows: DiRow[]; total: number }) => {
        if (!cancelled) { setRows(d.rows ?? []); setTotal(d.total ?? 0); }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [industryId, playbookSlug, minDi, sortBy, sortDir]);

  const filtered = useMemo(() => {
    if (!searchText.trim()) return rows;
    const q = searchText.toLowerCase();
    return rows.filter((r) => r.capabilityName.toLowerCase().includes(q) || r.industryName.toLowerCase().includes(q));
  }, [rows, searchText]);

  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(key); setSortDir("desc"); }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Forward-looking signal"
        title="Capability Disruption Index"
        descriptions={{
          default: "Which capabilities are next? Each row scores how disruptable a capability is across 6 forces (asset friction, JTBD abstractability, enabling tech, trust replaceability, supply expansion, margin asymmetry), then matches it to the closest of 8 disruption-playbook archetypes (Uber, Airbnb, Google, Amazon, Stripe, OpenAI, Tesla, Netflix).",
          pe: "Diligence radar. Sort by your portfolio's industries → see which incumbent capabilities are most exposed to imminent disruption + which playbook the disruptor would likely follow. Pair with /vcr for a deep dive on any candidate.",
          vc: "Opportunity radar. Filter by playbook archetype to find capabilities ripe for the model you're already pattern-matching on. Sort by supply multiplier to find latent-capacity plays; sort by enabling-tech to find LLM-era + AI-vision plays.",
          f500: "Risk + defense map. Filter to your industry, sort by composite DI desc — the top-10 are your incumbent positions most likely to face a credible new entrant in the next 18-36 months. Each row drills to a fishbone showing the forces driving the risk + candidate disruptors already on our radar.",
          student: "Where will the next Uber/Airbnb come from? Each row is a capability + the playbook that would attack it. Read a few rows and try the /disruption-lab — drop a capability, layer on enabling tech, watch the DI recompute.",
          professor: "Citable scoring. The 6-force decomposition (Christensen JTBD × Iansiti enabling tech × Eisenmann marketplace trust replacement) + cosine-matched playbook archetype framework is documented in /methodology. The /disruption-lab page is built for student exercises.",
        }}
      />

      {/* Filters bar */}
      <Card className="rounded-none border-border/60">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Industry</label>
            <Select value={industryId} onValueChange={setIndustryId}>
              <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All industries</SelectItem>
                {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Playbook archetype</label>
            <Select value={playbookSlug} onValueChange={setPlaybookSlug}>
              <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All playbooks</SelectItem>
                {archetypes.map((a) => <SelectItem key={a.slug} value={a.slug}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Min composite DI</label>
            <Input type="number" min={0} max={100} value={minDi} onChange={(e) => setMinDi(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="rounded-none font-mono tabular-nums" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="capability or industry…" className="rounded-none pl-8" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View toggle + Result count + lab CTA */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList>
            <TabsTrigger value="per-industry"><LayoutGrid className="w-3.5 h-3.5 mr-1.5" /> Top 5 per industry</TabsTrigger>
            <TabsTrigger value="table"><ListIcon className="w-3.5 h-3.5 mr-1.5" /> Full table</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          <div className="font-mono text-[11px] text-muted-foreground">
            {loading ? "Loading…" : view === "table" ? `${filtered.length} of ${total} capabilities` : `${byIndustry.length} industries`}
          </div>
          <Link href="/disruption-lab">
            <Button variant="outline" size="sm" className="rounded-none font-mono text-[11px] uppercase tracking-wider">
              <Flame className="w-3.5 h-3.5 mr-2" /> Open the Disruption Lab
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <Card className="rounded-none border-rose-500/40 bg-rose-500/[0.04]">
          <CardContent className="p-4 text-sm text-rose-500 font-mono">{error}</CardContent>
        </Card>
      )}

      {view === "per-industry" && (
        byIndustry.length === 0 ? (
          <Card className="rounded-none border-border/60"><CardContent className="p-8 text-center text-sm text-muted-foreground">No industries scored yet — the disruption-vector agent runs every 6 hours.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {byIndustry.map((ind) => (
              <Card key={ind.industryId} className="rounded-none border-border/60">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="font-serif text-base">{ind.industryName}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">top {ind.capabilities.length}</span>
                  </div>
                  <ol className="space-y-2.5">
                    {ind.capabilities.map((cap) => (
                      <li key={cap.capabilityId} className="border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <Link href={`/capability/${cap.capabilityId}`} className="text-sm font-medium hover:underline">
                              <span className="text-muted-foreground mr-1.5 font-mono">{cap.rank}.</span>
                              {cap.capabilityName}
                            </Link>
                          </div>
                          <span className={`inline-block px-2 py-0.5 text-xs font-mono tabular-nums font-medium border ${diTone(cap.compositeDi)} shrink-0`}>{cap.compositeDi.toFixed(0)}</span>
                        </div>
                        {cap.top5PlaybookMatches.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-1.5">
                            {cap.top5PlaybookMatches.map((m, i) => (
                              <Badge
                                key={m.playbookId}
                                variant="outline"
                                className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${i === 0 ? "border-accent text-accent" : "text-muted-foreground"}`}
                                title={`${m.name} — ${(m.similarity * 100).toFixed(0)}% pattern match`}
                              >
                                {m.name.split(" (")[0]} {(m.similarity * 100).toFixed(0)}%
                              </Badge>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {view === "table" && (
        loading ? (
        <Card className="rounded-none border-border/60"><CardContent className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card className="rounded-none border-amber-500/40 bg-amber-500/[0.04]">
          <CardContent className="p-6 space-y-3 text-center max-w-xl mx-auto">
            <p className="font-serif text-base">No capabilities match these filters yet</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Either the disruption-vector agent hasn't scored these capabilities yet (runs every 6 hours, cycle-budget of 8 caps), or you've filtered too aggressively. Try lowering Min DI or removing the playbook filter.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border/60">
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <th className="px-4 py-3">Capability</th>
                    <th className="px-3 py-3">Industry</th>
                    {SORTABLE.map((s) => (
                      <th key={s.key} className="px-3 py-3 text-right cursor-pointer hover:text-foreground" onClick={() => toggleSort(s.key)}>
                        <span className="inline-flex items-center gap-1">{s.label} <ArrowUpDown className="w-3 h-3 opacity-50" /></span>
                      </th>
                    ))}
                    <th className="px-3 py-3">Dominant</th>
                    <th className="px-3 py-3">Top playbook</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const Icon = DOMINANT_ICONS[r.dominantForce] ?? Layers;
                    return (
                      <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <Link href={`/capability/${r.capabilityId}`} className="font-medium hover:underline">{r.capabilityName}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.industryName}</td>
                        <td className={`px-3 py-2.5 text-right`}>
                          <span className={`inline-block px-2 py-0.5 text-xs font-mono tabular-nums font-medium border ${diTone(r.compositeDi)}`}>{r.compositeDi.toFixed(0)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">{r.assetFriction.toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">{r.enablingTechStrength.toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">{r.jtbdAbstractability.toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">{r.trustReplaceability.toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">{r.latentSupplyMultiplier.toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs">{r.marginAsymmetry.toFixed(0)}</td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            <Icon className="w-3 h-3" /> {DOMINANT_LABEL[r.dominantForce] ?? r.dominantForce}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {r.topPlaybookName && (
                            <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                              {r.topPlaybookName} · {r.topPlaybookSimilarity ? (r.topPlaybookSimilarity * 100).toFixed(0) : "?"}%
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground italic">
        DI rows refresh every 6 hours via the disruption-vector-agent. Admins can force a recompute on a single capability via{" "}
        <code className="font-mono text-xs bg-muted px-1.5">POST /api/admin/disruption-index/recompute/&lt;id&gt;</code>.
      </p>
      <PersonaDescription
        descriptions={{
          default: "DI ≠ DVX. The Disruption Velocity Index (DVX) measures how fast a capability is being disrupted right now. The Disruption Index (DI) predicts how disruptable it is going forward. A capability can have high DVX (currently being commoditized) but low DI (the disruption has already happened), or vice versa.",
        }}
      />
    </div>
  );
}
