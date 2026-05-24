/**
 * /disruption-simulator — time-axis disruption simulator.
 *
 * Three modes (tab-switched):
 *   1. MANUAL — define a hypothetical entrant capability + target incumbents,
 *      tune adoption + capital + regulation + horizon sliders, see the
 *      trajectory + cascade + defender options live.
 *   2. PITCH — paste a pitch; LLM extracts all 9 inputs and runs the
 *      simulation in one round-trip.
 *   3. SAVED — list of my saved simulations; click to load, fork, or delete.
 *
 * Renders DisruptionTrajectoryChart (incumbent vs entrant lines + crossover
 * marker + cumulative $ shadow) + DisruptionCascadeList (per-dependent-cap
 * impact at horizon end) + a defender-options panel showing the counter-
 * factuals the engine computed alongside the primary run.
 */
import { useEffect, useMemo, useState } from "react";
import { useUser, SignInButton } from "@clerk/react";
import {
  Rocket, MessageSquare, BookmarkIcon, Save, Loader2, AlertCircle, X, Plus,
  Sparkles, Trash2, GitFork, Search, Calendar, DollarSign, TrendingUp, Shield,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { PageHeader, PersonaDescription } from "@/components/page-header";
import { DisruptionTrajectoryChart, DisruptionCascadeList } from "@/components/disruption-trajectory-chart";

const API_BASE = "/api";

interface Capability { id: number; name: string; industryId: number; industryName?: string; isLeaf?: boolean }
interface Tech { id: number; name: string; category: string; maturityYear: number }
interface TrajectoryPoint { month: number; entrantStrength: number; incumbentCvi: number; entrantMarketShare: number; cumulativeDollarsDisruptedMm: number }
interface CascadePoint { capabilityId: number; capabilityName: string; baselineCvi: number; finalCvi: number; deltaPct: number }
interface DefenderOption { action: string; description: string; newCrossoverMonth: number | null; estimatedCostUsdMm: number | null }
interface SimResult {
  trajectory: TrajectoryPoint[];
  cascade: CascadePoint[];
  defenderOptions: DefenderOption[];
  crossoverMonth: number | null;
  finalEntrantShare: number;
  totalDollarsDisruptedMm: number;
  context: {
    targets: Array<{ id: number; name: string; baselineCvi: number; revenueExposureMm: number | null }>;
    techNames: string[];
    curveParams: { description: string };
    topPlaybookName: string | null;
    topPlaybookSimilarity: number;
  };
}

interface SavedScenario {
  id: number;
  name: string;
  description: string | null;
  entrantName: string;
  targetCapabilityIds: number[];
  targetCapabilityNames: string[];
  adoptionCurve: string;
  capitalTier: string;
  horizonMonths: number;
  crossoverMonth: number | null;
  finalEntrantShare: number;
  totalDollarsDisruptedMm: number;
  topPlaybookName: string | null;
  origin: string;
  createdAt: string;
}

const ADOPTION_LABEL: Record<string, string> = {
  slow_burn: "Slow burn (PE rollup)",
  standard_b2b_saas: "Standard B2B SaaS",
  viral_b2c: "Viral B2C (Airbnb / Uber)",
  stripe_dev: "Stripe-dev (bottom-up)",
};
const CAPITAL_LABEL: Record<string, string> = {
  bootstrap: "Bootstrap",
  seed: "Seed",
  series_b: "Series B+",
  mega_fund: "Mega fund",
};
const DEFENDER_LABEL: Record<string, string> = {
  none: "No response",
  acquire: "Acquire the entrant",
  build: "Build in-house",
  lobby_regulatory: "Lobby for regulation",
};

export default function DisruptionSimulatorPage() {
  const { isSignedIn } = useUser();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [mode, setMode] = useState<"manual" | "pitch" | "saved">("manual");
  const [error, setError] = useState<string | null>(null);

  // Inputs
  const [entrantName, setEntrantName] = useState("");
  const [entrantJtbd, setEntrantJtbd] = useState("");
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [techIds, setTechIds] = useState<number[]>([]);
  const [adoptionCurve, setAdoptionCurve] = useState("standard_b2b_saas");
  const [capitalTier, setCapitalTier] = useState("seed");
  const [horizonMonths, setHorizonMonths] = useState(36);
  const [regFriction, setRegFriction] = useState(0);
  const [substitutionFactor, setSubstitutionFactor] = useState(0.7);
  const [defenderResponse, setDefenderResponse] = useState("none");
  const [capSearch, setCapSearch] = useState("");

  // Pitch
  const [pitch, setPitch] = useState("");
  const [pitching, setPitching] = useState(false);
  const [extraction, setExtraction] = useState<Record<string, unknown> | null>(null);

  // Output
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);

  // Save
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // Load catalogs
  useEffect(() => {
    fetch(`${API_BASE}/capabilities`)
      .then((r) => r.json())
      .then((rows: Capability[]) => setCapabilities(rows.filter((c) => c.isLeaf !== false).slice(0, 500)))
      .catch(() => {});
    fetch(`${API_BASE}/disruption-index/enabling-tech`)
      .then((r) => r.json())
      .then((d: { enablingTech: Tech[] }) => setTechs(d.enablingTech ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!isSignedIn) return;
    fetch(`${API_BASE}/disruption-simulator/scenarios`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d: { scenarios: SavedScenario[] }) => setSaved(d.scenarios ?? []))
      .catch(() => {});
  }, [isSignedIn]);

  const filteredCaps = useMemo(() => {
    const q = capSearch.toLowerCase().trim();
    if (!q) return capabilities.slice(0, 100);
    return capabilities.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50);
  }, [capabilities, capSearch]);

  const runSimulation = async () => {
    if (!entrantName.trim()) { setError("Entrant name required"); return; }
    if (!entrantJtbd.trim()) { setError("Entrant JTBD required"); return; }
    if (targetIds.length === 0) { setError("Pick at least one incumbent target"); return; }
    setRunning(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/disruption-simulator/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entrantName: entrantName.trim(), entrantJtbd: entrantJtbd.trim(),
          entrantTechIds: techIds, targetCapabilityIds: targetIds,
          adoptionCurve, capitalTier, regulatoryFrictionMonths: regFriction,
          horizonMonths, substitutionFactor, defenderResponse,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "run failed");
    } finally {
      setRunning(false);
    }
  };

  const runPitch = async () => {
    if (pitch.trim().length < 30) { setError("Pitch must be at least 30 characters."); return; }
    setPitching(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/disruption-simulator/from-pitch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitch }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setExtraction(d.extraction);
      // Apply extraction → state
      setEntrantName(d.input.entrantName);
      setEntrantJtbd(d.input.entrantJtbd);
      setTechIds(d.input.entrantTechIds);
      setTargetIds(d.input.targetCapabilityIds);
      setAdoptionCurve(d.input.adoptionCurve);
      setCapitalTier(d.input.capitalTier);
      setRegFriction(d.input.regulatoryFrictionMonths);
      setHorizonMonths(d.input.horizonMonths);
      setSubstitutionFactor(d.input.substitutionFactor);
      setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "pitch extraction failed");
    } finally {
      setPitching(false);
    }
  };

  const saveScenario = async () => {
    if (!isSignedIn || !saveName.trim() || !result) return;
    setSaving(true);
    try {
      const body = {
        name: saveName.trim(),
        description: saveDesc.trim() || null,
        entrantName, entrantJtbd, entrantTechIds: techIds, targetCapabilityIds: targetIds,
        adoptionCurve, capitalTier, regulatoryFrictionMonths: regFriction,
        horizonMonths, substitutionFactor, defenderResponse,
        pitchSource: mode === "pitch" ? pitch : null,
        origin: mode === "pitch" ? "pitch" : "manual",
      };
      const r = await fetch(`${API_BASE}/disruption-simulator/scenarios`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setSaveName(""); setSaveDesc("");
      const list = await fetch(`${API_BASE}/disruption-simulator/scenarios`, { credentials: "include" }).then((x) => x.json());
      setSaved(list.scenarios ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const loadSaved = async (id: number) => {
    const r = await fetch(`${API_BASE}/disruption-simulator/scenarios/${id}`, { credentials: "include" });
    const d = await r.json();
    if (!r.ok) return;
    const s = d.scenario;
    setMode("manual");
    setEntrantName(s.entrantName); setEntrantJtbd(s.entrantJtbd);
    setTargetIds(s.targetCapabilityIds); setTechIds(s.entrantTechIds);
    setAdoptionCurve(s.adoptionCurve); setCapitalTier(s.capitalTier);
    setHorizonMonths(s.horizonMonths); setRegFriction(s.regulatoryFrictionMonths);
    setSubstitutionFactor(s.substitutionFactor); setDefenderResponse(s.defenderResponse);
    setResult({
      trajectory: s.trajectory, cascade: s.cascade, defenderOptions: s.defenderOptions,
      crossoverMonth: s.crossoverMonth, finalEntrantShare: s.finalEntrantShare,
      totalDollarsDisruptedMm: s.totalDollarsDisruptedMm,
      context: { targets: [], techNames: [], curveParams: { description: "" }, topPlaybookName: null, topPlaybookSimilarity: 0 },
    });
  };

  const forkSaved = async (id: number) => {
    const r = await fetch(`${API_BASE}/disruption-simulator/scenarios/${id}/fork`, { method: "POST", credentials: "include" });
    const d = await r.json();
    if (!r.ok) return;
    const p = d.prefill;
    setMode("manual");
    setEntrantName(p.entrantName); setEntrantJtbd(p.entrantJtbd);
    setTargetIds(p.targetCapabilityIds); setTechIds(p.entrantTechIds);
    setAdoptionCurve(p.adoptionCurve); setCapitalTier(p.capitalTier);
    setHorizonMonths(p.horizonMonths); setRegFriction(p.regulatoryFrictionMonths);
    setSubstitutionFactor(p.substitutionFactor); setDefenderResponse(p.defenderResponse);
    setSaveName(p.name);
  };

  const deleteSaved = async (id: number) => {
    await fetch(`${API_BASE}/disruption-simulator/scenarios/${id}`, { method: "DELETE", credentials: "include" });
    setSaved(saved.filter((s) => s.id !== id));
  };

  const toggleTarget = (id: number) => setTargetIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 5));
  const toggleTech = (id: number) => setTechIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 8));

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Time-axis simulator"
        title="Disruption Simulator"
        descriptions={{
          default: "Define a hypothetical disruptive capability, layer on enabling techs, set adoption + capital + regulatory parameters, and forward-project 12-60 months. See when the new entrant crosses over and replaces the incumbent, how much $ is at risk, what the dependency cascade looks like, and how a defender's response shifts the crossover month.",
          vc: "Stress-test theses. Define the capability a portfolio company is building, choose Stripe-dev or viral-B2C adoption, set Series B capital. See the projected market share + crossover month vs the incumbent capability. Pair with /disruption-lab to dial in the entrant's playbook fingerprint.",
          pe: "Defender's war-room. Pick your portfolio company's capability as the target, model an attacker with realistic enabling tech + capital tier, see the crossover month and total $ at risk. Compare 'no response' to 'acquire' / 'build' / 'lobby' counterfactuals — engine returns the cost + new crossover for each.",
          f500: "Pre-mortem your moat. Define the disruptor you think is coming for you (or your industry's most-likely entrant), see how fast they replace you under realistic conditions. The defender-options panel shows what each strategic response costs and how much time it buys.",
          student: "Build intuition for Bass diffusion + S-curves + reflexive margin compression. Try the same entrant under bootstrap vs mega-fund capital — see how the crossover month shifts. Try with vs without regulatory friction. Try low vs high substitution factor.",
        }}
      />

      {error && (
        <Card className="rounded-none border-rose-500/40 bg-rose-500/[0.04]">
          <CardContent className="p-3 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-500" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><X className="w-3 h-3" /></button>
          </CardContent>
        </Card>
      )}

      <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="w-full">
        <TabsList>
          <TabsTrigger value="manual"><Rocket className="w-3.5 h-3.5 mr-1.5" /> Manual</TabsTrigger>
          <TabsTrigger value="pitch"><MessageSquare className="w-3.5 h-3.5 mr-1.5" /> Pitch</TabsTrigger>
          <TabsTrigger value="saved"><BookmarkIcon className="w-3.5 h-3.5 mr-1.5" /> Saved ({saved.length})</TabsTrigger>
        </TabsList>

        {/* ─── MANUAL MODE ──────────────────────────────────────────────── */}
        <TabsContent value="manual" className="space-y-4 mt-4">
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 space-y-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Step 1 — define the disruptive capability</div>
              <Input value={entrantName} onChange={(e) => setEntrantName(e.target.value)} placeholder="e.g. Real-time LLM-mediated claims adjudication" className="rounded-none" />
              <Textarea value={entrantJtbd} onChange={(e) => setEntrantJtbd(e.target.value)} placeholder="Job-to-be-done in one sentence: e.g. 'Settle an auto-insurance claim in under 5 minutes from photo upload, with no human adjuster.'" className="min-h-[80px] rounded-none" />
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Step 2 — incumbent capabilities the entrant replaces (1-5)</div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={capSearch} onChange={(e) => setCapSearch(e.target.value)} placeholder="Search capabilities…" className="rounded-none pl-8" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {targetIds.map((id) => {
                  const c = capabilities.find((x) => x.id === id);
                  return c ? (
                    <Badge key={id} className="rounded-none gap-1 cursor-pointer" onClick={() => toggleTarget(id)}>
                      {c.name} <X className="w-3 h-3" />
                    </Badge>
                  ) : null;
                })}
              </div>
              <div className="max-h-44 overflow-y-auto border border-border/40 p-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                {filteredCaps.filter((c) => !targetIds.includes(c.id)).slice(0, 40).map((c) => (
                  <button key={c.id} onClick={() => toggleTarget(c.id)} className="text-left text-xs px-2 py-1 hover:bg-muted truncate">
                    <Plus className="w-3 h-3 inline mr-1" />{c.name}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Step 3 — enabling tech stack the entrant uses (3-8)</div>
              <div className="flex flex-wrap gap-1.5">
                {techs.map((t) => {
                  const active = techIds.includes(t.id);
                  return (
                    <button key={t.id} onClick={() => toggleTech(t.id)} title={t.name} className={`px-2.5 py-1 text-xs border rounded-none ${active ? "bg-accent text-accent-foreground border-accent" : "border-border hover:bg-muted text-muted-foreground"}`}>
                      {active ? <X className="w-3 h-3 inline mr-1" /> : <Plus className="w-3 h-3 inline mr-1" />}
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Adoption curve</label>
                <Select value={adoptionCurve} onValueChange={setAdoptionCurve}>
                  <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ADOPTION_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Capital tier</label>
                <Select value={capitalTier} onValueChange={setCapitalTier}>
                  <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CAPITAL_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Horizon: {horizonMonths} months</label>
                <Slider value={[horizonMonths]} onValueChange={(v) => setHorizonMonths(v[0])} min={12} max={60} step={6} />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Regulatory friction: {regFriction} months</label>
                <Slider value={[regFriction]} onValueChange={(v) => setRegFriction(v[0])} min={0} max={36} step={3} />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Substitution factor: {substitutionFactor.toFixed(2)}</label>
                <Slider value={[substitutionFactor]} onValueChange={(v) => setSubstitutionFactor(v[0])} min={0.1} max={1} step={0.05} />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Defender response</label>
                <Select value={defenderResponse} onValueChange={setDefenderResponse}>
                  <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(DEFENDER_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Button onClick={runSimulation} disabled={running} size="lg" className="rounded-none">
            {running ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
            Run simulation
          </Button>
        </TabsContent>

        {/* ─── PITCH MODE ──────────────────────────────────────────────── */}
        <TabsContent value="pitch" className="mt-4 space-y-3">
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 space-y-3">
              <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block">Paste a pitch — LLM extracts all 9 simulator inputs + runs the simulation</label>
              <Textarea value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="We're building an LLM-powered intake + adjudication tool for auto insurance claims. Submit a photo of the damage, our vision model assesses, our LLM proposes a settlement amount in under 2 minutes. Seed funded, targeting US-only first to avoid international regulatory complexity…" className="min-h-[200px] rounded-none font-mono text-sm" />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">{pitch.length} / 8000 chars</p>
                <Button onClick={runPitch} disabled={pitching || pitch.trim().length < 30} className="rounded-none">
                  {pitching ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
                  Extract + simulate
                </Button>
              </div>
              {extraction && (
                <div className="border border-accent/40 bg-accent/[0.04] p-3 text-xs space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Extraction</div>
                  <div className="text-muted-foreground italic">{String(extraction.rationale ?? "")}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── SAVED MODE ──────────────────────────────────────────────── */}
        <TabsContent value="saved" className="mt-4">
          {!isSignedIn ? (
            <Card className="rounded-none border-border/60"><CardContent className="p-6 text-center space-y-3">
              <p className="text-sm">Sign in to view + save scenarios.</p>
              <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
            </CardContent></Card>
          ) : saved.length === 0 ? (
            <Card className="rounded-none border-border/60"><CardContent className="p-6 text-sm text-muted-foreground text-center">No saved scenarios yet. Run + save one on the Manual or Pitch tab.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {saved.map((s) => (
                <Card key={s.id} className="rounded-none border-border/60">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button onClick={() => loadSaved(s.id)} className="text-sm font-medium hover:underline text-left">{s.name}</button>
                        <div className="text-xs text-muted-foreground truncate">{s.entrantName}</div>
                        <div className="text-xs text-muted-foreground truncate">vs {s.targetCapabilityNames.join(" · ")}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => forkSaved(s.id)} className="text-muted-foreground hover:text-foreground"><GitFork className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteSaved(s.id)} className="text-muted-foreground hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {s.crossoverMonth !== null && <Badge variant="outline" className="rounded-none font-mono"><Calendar className="w-3 h-3 mr-1" />Crossover M{s.crossoverMonth}</Badge>}
                      <Badge variant="outline" className="rounded-none font-mono"><DollarSign className="w-3 h-3 mr-1" />${s.totalDollarsDisruptedMm.toFixed(0)}M</Badge>
                      <Badge variant="outline" className="rounded-none font-mono"><TrendingUp className="w-3 h-3 mr-1" />{(s.finalEntrantShare * 100).toFixed(0)}% share</Badge>
                      {s.topPlaybookName && <Badge variant="outline" className="rounded-none font-mono text-[10px]">{s.topPlaybookName.split(" (")[0]}</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ─── RESULT (shared across all modes) ─────────────────────────── */}
      {result && (
        <>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="border border-border/60 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Crossover</div>
                  <div className="font-mono text-2xl tabular-nums">{result.crossoverMonth !== null ? `M${result.crossoverMonth}` : "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">{result.crossoverMonth === null ? "No crossover in horizon" : "Entrant > incumbent"}</div>
                </div>
                <div className="border border-border/60 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Total $ disrupted</div>
                  <div className="font-mono text-2xl tabular-nums">${result.totalDollarsDisruptedMm.toFixed(0)}M</div>
                  <div className="text-xs text-muted-foreground mt-1">cumulative over horizon</div>
                </div>
                <div className="border border-border/60 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Final entrant share</div>
                  <div className="font-mono text-2xl tabular-nums">{(result.finalEntrantShare * 100).toFixed(0)}%</div>
                  <div className="text-xs text-muted-foreground mt-1">at horizon end</div>
                </div>
                <div className="border border-border/60 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Playbook match</div>
                  <div className="font-mono text-sm">{result.context.topPlaybookName?.split(" (")[0] ?? "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">{result.context.topPlaybookSimilarity > 0 ? `${(result.context.topPlaybookSimilarity * 100).toFixed(0)}% match` : ""}</div>
                </div>
              </div>
              <DisruptionTrajectoryChart trajectory={result.trajectory} crossoverMonth={result.crossoverMonth} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="rounded-none border-border/60">
              <CardContent className="p-4 space-y-2">
                <h3 className="font-serif text-base">Second-order cascade</h3>
                <p className="text-xs text-muted-foreground">Dependent capabilities and how their CVI shifts at horizon end.</p>
                <DisruptionCascadeList cascade={result.cascade} />
              </CardContent>
            </Card>
            <Card className="rounded-none border-border/60">
              <CardContent className="p-4 space-y-2">
                <h3 className="font-serif text-base flex items-center gap-2"><Shield className="w-4 h-4" /> Defender counterfactuals</h3>
                <p className="text-xs text-muted-foreground">What if the incumbent responds? Engine re-runs under each option + reports cost + new crossover.</p>
                {result.defenderOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Defender response is already set on the primary run — counterfactuals only computed when defender_response = none.</p>
                ) : (
                  <ul className="space-y-2">
                    {result.defenderOptions.map((o) => (
                      <li key={o.action} className="border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-medium">{DEFENDER_LABEL[o.action] ?? o.action}</span>
                          {o.estimatedCostUsdMm !== null && <Badge variant="outline" className="rounded-none font-mono text-[10px]">~${o.estimatedCostUsdMm}M</Badge>}
                          {o.newCrossoverMonth !== null && <Badge variant="outline" className="rounded-none font-mono text-[10px]">Crossover M{o.newCrossoverMonth}</Badge>}
                          {o.newCrossoverMonth === null && <Badge variant="outline" className="rounded-none font-mono text-[10px] text-emerald-500">No crossover</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{o.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {isSignedIn ? (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Scenario name" className="rounded-none" />
                <Input value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)} placeholder="Description (optional)" className="rounded-none" />
                <Button onClick={saveScenario} disabled={saving || !saveName.trim()} className="rounded-none">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Save className="w-3.5 h-3.5 mr-2" />}
                  Save scenario
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">Sign in to save this simulation, fork it, or share via permalink.</p>
                <SignInButton mode="modal"><Button variant="outline" className="rounded-none">Sign in</Button></SignInButton>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <PersonaDescription
        descriptions={{
          default: "Sim ≠ Lab. The /disruption-lab answers 'what's the DI right now under this stack' — point-in-time. The Simulator answers 'how does that DI play out over 36 months' — time-axis. Any lab scenario can become the starting state for a simulator run.",
        }}
      />
    </div>
  );
}
