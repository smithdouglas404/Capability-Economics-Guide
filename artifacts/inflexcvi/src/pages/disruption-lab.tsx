/**
 * /disruption-lab — interactive workbench for the Capability Disruption Index.
 *
 * Three modes (tab-switched):
 *   1. CAPABILITY MODE — pick a capability, layer on enabling-tech pills,
 *      watch the DI recompute live. The fishbone re-renders + the playbook
 *      match updates + the candidate-disruptor list updates.
 *
 *   2. PITCH MODE — paste a pitch / value-prop / "I'm thinking about a
 *      startup that..." text. The LLM extracts target capability + applied
 *      tech stack + a rationale. The extraction populates the canvas. User
 *      can correct the extraction and re-run.
 *
 *   3. COMPARE MODE — pick two capabilities side-by-side, see which is
 *      more disruptable and why (sub-score deltas).
 *
 * Saved scenarios live in a drawer on the right rail — fork, share via
 * permalink, delete.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import {
  Flame, Plus, X, Sparkles, MessageSquare, GitCompare, Loader2, Save,
  BookmarkIcon, Trash2, Search, AlertCircle, ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PersonaDescription } from "@/components/page-header";

const API_BASE = "/api";

interface CatalogCapability { id: number; name: string; industryId: number; industryName?: string }
interface EnablingTech {
  id: number;
  slug: string;
  name: string;
  category: string;
  maturityYear: number;
  description: string;
}
interface ScenarioResult {
  capabilityId: number;
  appliedTechIds: number[];
  subscores: {
    assetFriction: number;
    jtbdAbstractability: number;
    enablingTechStrength: number;
    trustReplaceability: number;
    latentSupplyMultiplier: number;
    marginAsymmetry: number;
  };
  compositeDi: number;
  topPlaybookName: string | null;
  topPlaybookSimilarity: number;
  playbookSimilarities: Array<{ playbookId: number; slug: string; name: string; similarity: number }>;
  topEnablingTech: Array<{ id: number; slug: string; name: string; weight: number }>;
}
interface SavedScenario {
  id: number;
  name: string;
  description: string | null;
  targetCapabilityId: number;
  appliedTechIds: number[];
  resolvedCompositeDi: number;
  resolvedTopPlaybookId: number | null;
  origin: string;
  createdAt: string;
  capabilityName: string;
  industryName: string;
  playbookName: string | null;
}

function diTone(score: number): string {
  if (score >= 75) return "text-rose-500 border-rose-500/40 bg-rose-500/5";
  if (score >= 50) return "text-amber-500 border-amber-500/40 bg-amber-500/5";
  if (score >= 25) return "text-blue-500 border-blue-500/40 bg-blue-500/5";
  return "text-emerald-500 border-emerald-500/40 bg-emerald-500/5";
}

export default function DisruptionLabPage() {
  const { isSignedIn } = useUser();
  const [capabilities, setCapabilities] = useState<CatalogCapability[]>([]);
  const [techs, setTechs] = useState<EnablingTech[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);

  // Mode state
  const [mode, setMode] = useState<"capability" | "pitch" | "compare">("capability");

  // Capability + compare modes
  const [primaryCapId, setPrimaryCapId] = useState<number | null>(null);
  const [compareCapId, setCompareCapId] = useState<number | null>(null);
  const [appliedTechIds, setAppliedTechIds] = useState<number[]>([]);
  const [scenario, setScenario] = useState<ScenarioResult | null>(null);
  const [compareScenario, setCompareScenario] = useState<ScenarioResult | null>(null);
  const [scoring, setScoring] = useState(false);
  const [capSearch, setCapSearch] = useState("");

  // Pitch mode
  const [pitchText, setPitchText] = useState("");
  const [pitchExtraction, setPitchExtraction] = useState<{ targetCapabilityName?: string; targetIndustryName?: string; appliedTechNames?: string[]; rationale?: string } | null>(null);
  const [pitching, setPitching] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState("");
  const [savingDesc, setSavingDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // Load catalogs.
  useEffect(() => {
    fetch(`${API_BASE}/capabilities`)
      .then((r) => r.json())
      .then((rows: Array<{ id: number; name: string; industryId: number; isLeaf?: boolean }>) => {
        setCapabilities(rows.filter((c) => c.isLeaf !== false).slice(0, 500));
      })
      .catch(() => {});
    fetch(`${API_BASE}/disruption-index/enabling-tech`)
      .then((r) => r.json())
      .then((d: { enablingTech: EnablingTech[] }) => setTechs(d.enablingTech ?? []))
      .catch(() => {});
  }, []);

  // Load saved scenarios (auth-gated).
  useEffect(() => {
    if (!isSignedIn) return;
    fetch(`${API_BASE}/disruption-lab/scenarios`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d: { scenarios: SavedScenario[] }) => setSavedScenarios(d.scenarios ?? []))
      .catch(() => {});
  }, [isSignedIn]);

  // Recompute scenario when primary cap or tech selection changes (in capability mode).
  useEffect(() => {
    if (mode !== "capability" && mode !== "compare") return;
    if (!primaryCapId) { setScenario(null); return; }
    let cancelled = false;
    setScoring(true);
    setError(null);
    fetch(`${API_BASE}/disruption-lab/recompute-scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capabilityId: primaryCapId, appliedTechIds }),
    })
      .then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error ?? `HTTP ${r.status}`))))
      .then((d: ScenarioResult) => { if (!cancelled) setScenario(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "score failed"); })
      .finally(() => { if (!cancelled) setScoring(false); });
    return () => { cancelled = true; };
  }, [primaryCapId, appliedTechIds, mode]);

  // Compare mode — score the second cap with the SAME applied techs.
  useEffect(() => {
    if (mode !== "compare" || !compareCapId) { setCompareScenario(null); return; }
    let cancelled = false;
    fetch(`${API_BASE}/disruption-lab/recompute-scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capabilityId: compareCapId, appliedTechIds }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d: ScenarioResult) => { if (!cancelled) setCompareScenario(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [compareCapId, appliedTechIds, mode]);

  const filteredCaps = useMemo(() => {
    const q = capSearch.toLowerCase().trim();
    if (!q) return capabilities.slice(0, 100);
    return capabilities.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50);
  }, [capabilities, capSearch]);

  const runPitch = async () => {
    if (pitchText.trim().length < 30) { setError("Pitch must be at least 30 characters."); return; }
    setPitching(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/disruption-lab/from-pitch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitch: pitchText }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setPitchExtraction(d.extraction);
      setPrimaryCapId(d.extraction.targetCapabilityId);
      setAppliedTechIds(d.extraction.appliedTechIds);
      setScenario(d.scenario);
    } catch (e) {
      setError(e instanceof Error ? e.message : "pitch extraction failed");
    } finally {
      setPitching(false);
    }
  };

  const saveScenario = async () => {
    if (!isSignedIn) return;
    if (!savingName.trim() || !primaryCapId) return;
    setSaving(true);
    try {
      const body = {
        name: savingName.trim(),
        description: savingDesc.trim() || null,
        targetCapabilityId: primaryCapId,
        appliedTechIds,
        pitchSource: mode === "pitch" ? pitchText : null,
        origin: mode === "pitch" ? "pitch" : "manual",
      };
      const r = await fetch(`${API_BASE}/disruption-lab/scenarios`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      // Refresh saved scenarios list
      setSavingName(""); setSavingDesc("");
      const list = await fetch(`${API_BASE}/disruption-lab/scenarios`, { credentials: "include" }).then((x) => x.json());
      setSavedScenarios(list.scenarios ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const loadScenario = (s: SavedScenario) => {
    setMode("capability");
    setPrimaryCapId(s.targetCapabilityId);
    setAppliedTechIds(s.appliedTechIds ?? []);
  };

  const deleteScenario = async (id: number) => {
    if (!isSignedIn) return;
    await fetch(`${API_BASE}/disruption-lab/scenarios/${id}`, { method: "DELETE", credentials: "include" });
    setSavedScenarios(savedScenarios.filter((s) => s.id !== id));
  };

  const toggleTech = (id: number) => {
    setAppliedTechIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const primaryCap = capabilities.find((c) => c.id === primaryCapId) ?? null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Interactive workbench"
        title="Disruption Lab"
        descriptions={{
          default: "Drop a capability. Layer on enabling technologies (LLMs, mobile, ratings, marketplace stack, EO satellites). Watch the Disruption Index recompute live + the playbook match update. Or paste a startup pitch and let the LLM extract the target capability + applied stack for you.",
          vc: "Stress-test theses. Pick a capability you're considering investing around, drag-drop the enabling techs the founder is using, see the DI + playbook match. Compare two capabilities side-by-side to triage your pipeline.",
          pe: "Defense planning. Pick your portfolio company's capability, layer on the techs an attacker would use, see the DI escalate. The playbook match tells you who's likely coming.",
          f500: "Pre-mortem your moat. Pick the capability you're most protective of, apply the techs the disruptor would. If the DI jumps past 75, you have ~24 months to build a counter-position.",
          student: "Build intuition. Try Telehealth × LLM + mobile + ratings — see why Hims+Hers and Ro broke the dermatology gate. Then try Insurance Underwriting × LLM + satellite EO — see what Hippo and Cape Analytics are attacking.",
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
        <TabsList className="grid grid-cols-3 max-w-xl">
          <TabsTrigger value="capability"><Flame className="w-3.5 h-3.5 mr-1.5" /> Capability</TabsTrigger>
          <TabsTrigger value="pitch"><MessageSquare className="w-3.5 h-3.5 mr-1.5" /> Pitch</TabsTrigger>
          <TabsTrigger value="compare"><GitCompare className="w-3.5 h-3.5 mr-1.5" /> Compare</TabsTrigger>
        </TabsList>

        {/* ─── Capability + Pitch + Compare share the same canvas; tabs just swap inputs ─── */}
        <TabsContent value="capability" className="mt-6">
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4">
              <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Pick a capability</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="relative md:col-span-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={capSearch} onChange={(e) => setCapSearch(e.target.value)} placeholder="Search…" className="rounded-none pl-8" />
                </div>
                <Select value={primaryCapId ? String(primaryCapId) : ""} onValueChange={(v) => setPrimaryCapId(Number(v))}>
                  <SelectTrigger className="rounded-none md:col-span-2"><SelectValue placeholder={`${capabilities.length} capabilities available`} /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {filteredCaps.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pitch" className="mt-6">
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 space-y-3">
              <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block">
                Paste a pitch / value prop / "I'm thinking about a startup that..." text
              </label>
              <Textarea
                value={pitchText}
                onChange={(e) => setPitchText(e.target.value)}
                placeholder="We're building an LLM-powered intake + adjudication tool for auto insurance claims. Submit a photo of the damage, our vision model assesses, our LLM proposes a settlement amount in under 2 minutes…"
                className="min-h-[160px] rounded-none font-mono text-sm"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-muted-foreground">{pitchText.length} / 8000 chars. LLM extracts target cap + tech stack.</p>
                <Button onClick={runPitch} disabled={pitching || pitchText.trim().length < 30} className="rounded-none">
                  {pitching ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
                  Extract + score
                </Button>
              </div>
              {pitchExtraction && (
                <div className="border border-accent/40 bg-accent/[0.04] p-3 text-xs space-y-1.5">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Extraction</div>
                  <div><strong>Target capability:</strong> {pitchExtraction.targetCapabilityName} ({pitchExtraction.targetIndustryName})</div>
                  <div><strong>Applied tech:</strong> {pitchExtraction.appliedTechNames?.join(" · ") || "(none picked)"}</div>
                  <div className="text-muted-foreground italic mt-1">{pitchExtraction.rationale}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compare" className="mt-6">
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Capability A</label>
                <Select value={primaryCapId ? String(primaryCapId) : ""} onValueChange={(v) => setPrimaryCapId(Number(v))}>
                  <SelectTrigger className="rounded-none"><SelectValue placeholder="Pick A" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {capabilities.slice(0, 100).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-1">Capability B</label>
                <Select value={compareCapId ? String(compareCapId) : ""} onValueChange={(v) => setCompareCapId(Number(v))}>
                  <SelectTrigger className="rounded-none"><SelectValue placeholder="Pick B" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {capabilities.slice(0, 100).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Enabling tech pills (rail) ──────────────────────────────────── */}
      <Card className="rounded-none border-border/60">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Apply enabling tech</label>
            {appliedTechIds.length > 0 && <Button variant="ghost" size="sm" onClick={() => setAppliedTechIds([])} className="rounded-none h-6 px-2 text-xs">Clear</Button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {techs.map((t) => {
              const active = appliedTechIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTech(t.id)}
                  title={`${t.name} — ${t.category}, mature ${t.maturityYear}`}
                  className={`px-2.5 py-1 text-xs border rounded-none transition-colors ${
                    active
                      ? "bg-accent text-accent-foreground border-accent"
                      : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {active ? <X className="w-3 h-3 inline mr-1" /> : <Plus className="w-3 h-3 inline mr-1" />}
                  {t.name}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ─── Canvas: live-recomputed scenario card(s) ────────────────────── */}
      {scoring && <Card className="rounded-none"><CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Recomputing DI…</CardContent></Card>}

      {scenario && primaryCap && (
        <div className={mode === "compare" ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}>
          <ScenarioCard label="A" capName={primaryCap.name} result={scenario} appliedTechCount={appliedTechIds.length} />
          {mode === "compare" && compareScenario && (
            <ScenarioCard label="B" capName={capabilities.find((c) => c.id === compareCapId)?.name ?? "Unknown"} result={compareScenario} appliedTechCount={appliedTechIds.length} />
          )}
        </div>
      )}

      {/* ─── Save current scenario ───────────────────────────────────────── */}
      {scenario && (
        isSignedIn ? (
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <Input value={savingName} onChange={(e) => setSavingName(e.target.value)} placeholder="Scenario name" className="rounded-none" />
              <Input value={savingDesc} onChange={(e) => setSavingDesc(e.target.value)} placeholder="Description (optional)" className="rounded-none" />
              <Button onClick={saveScenario} disabled={saving || !savingName.trim()} className="rounded-none">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Save className="w-3.5 h-3.5 mr-2" />}
                Save scenario
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">Sign in to save this scenario, fork it, or share via permalink.</p>
              <SignInButton mode="modal"><Button variant="outline" className="rounded-none">Sign in</Button></SignInButton>
            </CardContent>
          </Card>
        )
      )}

      {/* ─── Saved scenarios drawer ─────────────────────────────────────── */}
      {isSignedIn && savedScenarios.length > 0 && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-2">
              <BookmarkIcon className="w-3.5 h-3.5" /> Saved scenarios ({savedScenarios.length})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {savedScenarios.map((s) => (
                <div key={s.id} className="border border-border/60 p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button onClick={() => loadScenario(s)} className="text-sm font-medium hover:underline text-left">{s.name}</button>
                    <div className="text-xs text-muted-foreground truncate">{s.capabilityName} ({s.industryName})</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className={`rounded-none font-mono text-[10px] ${diTone(s.resolvedCompositeDi)}`}>DI {s.resolvedCompositeDi.toFixed(0)}</Badge>
                      {s.playbookName && <Badge variant="outline" className="rounded-none font-mono text-[10px]">{s.playbookName}</Badge>}
                      {s.origin === "pitch" && <Badge variant="outline" className="rounded-none font-mono text-[10px]">pitch</Badge>}
                    </div>
                  </div>
                  <button onClick={() => deleteScenario(s.id)} className="text-muted-foreground hover:text-rose-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <PersonaDescription
        descriptions={{
          default: "The DI here is the SAME formula running in /disruption-index. The lab lets you override the inferred enabling-tech stack — useful for stress-testing what an attacker WOULD use vs what the catalog currently infers. Saved scenarios snapshot the DI at save time + can be shared.",
        }}
      />
    </div>
  );
}

function ScenarioCard({ label, capName, result, appliedTechCount }: { label: string; capName: string; result: ScenarioResult; appliedTechCount: number }) {
  const sub = result.subscores;
  return (
    <Card className="rounded-none border-border/60">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Scenario {label}</div>
            <h3 className="font-serif text-lg">{capName}</h3>
            <div className="text-xs text-muted-foreground mt-0.5">{appliedTechCount} enabling tech{appliedTechCount === 1 ? "" : "s"} applied</div>
          </div>
          <div className={`px-3 py-2 border ${diTone(result.compositeDi)} text-center min-w-[90px]`}>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">DI</div>
            <div className="font-mono text-2xl tabular-nums font-bold">{result.compositeDi.toFixed(0)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            ["Asset", sub.assetFriction],
            ["JTBD", sub.jtbdAbstractability],
            ["Tech", sub.enablingTechStrength],
            ["Trust", sub.trustReplaceability],
            ["Supply", sub.latentSupplyMultiplier],
            ["Margin", sub.marginAsymmetry],
          ].map(([label, val]) => (
            <div key={label as string} className={`px-2 py-1.5 border ${diTone(val as number)} text-center`}>
              <div className="font-mono text-[9px] uppercase tracking-wider opacity-70">{label}</div>
              <div className="font-mono text-sm tabular-nums">{(val as number).toFixed(0)}</div>
            </div>
          ))}
        </div>

        {result.topPlaybookName && (
          <div className="border-t border-border/40 pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Playbook match</div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="rounded-none font-mono text-[11px]">{result.topPlaybookName} · {(result.topPlaybookSimilarity * 100).toFixed(0)}%</Badge>
              {result.playbookSimilarities.slice(1, 3).map((p) => (
                <Badge key={p.playbookId} variant="outline" className="rounded-none font-mono text-[10px] text-muted-foreground">{p.name} · {(p.similarity * 100).toFixed(0)}%</Badge>
              ))}
            </div>
          </div>
        )}

        {result.topEnablingTech.length > 0 && (
          <div className="border-t border-border/40 pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Top enabling techs</div>
            <ul className="text-xs space-y-0.5">
              {result.topEnablingTech.map((t) => <li key={t.id}>{t.name} <span className="text-muted-foreground">(weight {t.weight})</span></li>)}
            </ul>
          </div>
        )}

        <div className="border-t border-border/40 pt-2">
          <Link href={`/capability/${result.capabilityId}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            See the full fishbone + narrative on the capability detail <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
