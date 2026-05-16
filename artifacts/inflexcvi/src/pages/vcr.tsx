import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2, Send, Sparkles, Inbox, FileText, CheckCircle2, XCircle, Mic, Upload, Type, RefreshCw, Play, Calendar, Activity, MessageCircle, Bot } from "lucide-react";

const apiBase = import.meta.env.VITE_API_URL || "";

type Industry = { id: number; name: string; slug: string };
type Assessment = {
  id: number;
  clientName: string;
  industryId: number | null;
  valueCase: string;
  valueCaseSource: string;
  status: string;
  objective: string | null;
  durationDays: number;
  totalCycles: number;
  currentCycle: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  executiveSummary: string | null;
  finalReport: FinalReport | null;
  createdAt: string;
  updatedAt: string;
};
type Cycle = {
  id: number;
  assessmentId: number;
  cycleNumber: number;
  status: string;
  objective: string | null;
  summary: string | null;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  itemsCreated: number;
  questionsCreated: number;
  toolCalls: number;
  errors: string[] | null;
};
type Question = { id: number; assessmentId: number; cycleId: number | null; question: string; rationale: string | null; answer: string | null; status: string; priority: number; displayOrder: number; askedAt: string; answeredAt: string | null };
type ResearchItem = {
  id: number;
  assessmentId: number;
  cycleId: number | null;
  kind: string;
  title: string;
  summary: string;
  body: string;
  sources: { url: string; title: string }[];
  evidenceCount: number;
  crossValidated: boolean;
  contradictions: string[];
  confidenceScore: number;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewerNotes: string | null;
  includeInReport: boolean;
  createdAt: string;
  reviewedAt: string | null;
};
type InboxFinding = ResearchItem & { type: "finding"; clientName: string };
type InboxQuestion = Question & { type: "question"; clientName: string };
type InboxResponse = { findings: InboxFinding[]; questions: InboxQuestion[]; counts: { findings: number; questions: number } };
type FinalReport = {
  executiveSummary: string;
  capabilityGaps: { name: string; gap: string; impact: string }[];
  recommendations: { title: string; rationale: string; impact: string; horizon: string }[];
  quadrantInsights: { hot: string[]; emerging: string[]; cooling: string[]; tableStakes: string[] };
  risks: string[];
  nextSteps: string[];
};

const KIND_COLORS: Record<string, string> = {
  capability_gap: "bg-rose-100 text-rose-800 border-rose-200",
  opportunity: "bg-emerald-100 text-emerald-800 border-emerald-200",
  recommendation: "bg-primary/10 text-primary border-primary/20",
  risk: "bg-amber-100 text-amber-800 border-amber-200",
  insight: "bg-accent/10 text-accent-foreground border-accent/20",
  benchmark: "bg-muted/50 text-muted-foreground border-border/40",
  evidence_gap: "bg-orange-100 text-orange-800 border-orange-200",
  contradiction: "bg-red-100 text-red-800 border-red-200",
};

const CYCLE_STATUS_COLOR: Record<string, string> = {
  scheduled: "bg-muted/50 text-muted-foreground",
  planning: "bg-primary/10 text-primary animate-pulse",
  researching: "bg-primary/10 text-primary animate-pulse",
  critiquing: "bg-amber-100 text-amber-700 animate-pulse",
  synthesizing: "bg-primary/10 text-primary animate-pulse",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
};

export default function VCRPage() {
  const [tab, setTab] = useState<"new" | "active" | "inbox">("active");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [inbox, setInbox] = useState<InboxResponse>({ findings: [], questions: [], counts: { findings: 0, questions: 0 } });
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [a, i, ind] = await Promise.all([
      fetch(`${apiBase}/api/vcr/assessments`).then(r => r.json()).catch(() => []),
      fetch(`${apiBase}/api/vcr/inbox`).then(r => r.json()).catch(() => ({ findings: [], questions: [], counts: { findings: 0, questions: 0 } })),
      fetch(`${apiBase}/api/industries`).then(r => r.json()).catch(() => []),
    ]);
    const list = Array.isArray(a) ? a : [];
    setAssessments(list);
    setInbox(i);
    setIndustries(Array.isArray(ind) ? ind : []);
    setSelectedId(prev => prev ?? (list[0]?.id ?? null));
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  const inboxTotal = inbox.counts.findings + inbox.counts.questions;

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="h-px w-5 bg-accent" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">AI Agent</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-foreground flex items-center justify-center text-background">
                <Bot className="w-5 h-5" />
              </div>
              <h1 className="font-serif text-3xl tracking-tight">Virtual Capability Engineer</h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              A LangGraph-orchestrated agent that runs a multi-day research campaign — planning each cycle, executing PhD-grade web research with Perplexity sonar-deep-research, cross-validating findings with GLM 5.1, and proposing follow-up questions to the client. Findings and questions land in a single review pane.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList className="grid grid-cols-3 w-full max-w-2xl mb-6">
            <TabsTrigger value="new"><Send className="w-4 h-4 mr-2" />New Campaign</TabsTrigger>
            <TabsTrigger value="active"><FileText className="w-4 h-4 mr-2" />Campaigns ({assessments.length})</TabsTrigger>
            <TabsTrigger value="inbox"><Inbox className="w-4 h-4 mr-2" />Single Pane ({inboxTotal})</TabsTrigger>
          </TabsList>

          <TabsContent value="new">
            <NewCampaignForm
              industries={industries}
              onCreated={async (a) => { await loadAll(); setSelectedId(a.id); setTab("active"); }}
            />
          </TabsContent>

          <TabsContent value="active">
            <div className="grid lg:grid-cols-[300px_1fr] gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">All Campaigns</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {assessments.length === 0 && <p className="text-sm text-muted-foreground">No campaigns yet.</p>}
                  {assessments.map(a => {
                    const pct = a.totalCycles > 0 ? Math.min(100, (a.currentCycle / a.totalCycles) * 100) : 0;
                    return (
                      <button
                        key={a.id}
                        onClick={() => setSelectedId(a.id)}
                        className={`w-full text-left p-3 rounded-none border transition ${selectedId === a.id ? "border-primary bg-primary/5 shadow-sm" : "hover:bg-muted/50"}`}
                      >
                        <div className="font-medium text-sm truncate">{a.clientName}</div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <StatusBadge status={a.status} />
                          <span className="text-xs text-muted-foreground">Day {a.currentCycle}/{a.totalCycles}</span>
                        </div>
                        <div className="mt-2 h-1.5 bg-muted rounded-none overflow-hidden">
                          <div className="h-full bg-primary rounded-none transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
              <div>
                {selectedId ? <CampaignDetail id={selectedId} onChanged={loadAll} /> : (
                  assessments.length === 0 ? (
                    <Card>
                      <CardContent className="py-16 text-center space-y-3">
                        <Bot className="w-10 h-10 mx-auto text-muted-foreground/40" />
                        <p className="text-sm font-medium">No research campaigns yet</p>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">Launch a new campaign from the New Campaign tab. The agent will generate intake questions, then run one research cycle per day until the campaign ends.</p>
                        <Button size="sm" variant="outline" onClick={() => setTab("new")}><Send className="w-4 h-4 mr-2" />Start a campaign</Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card><CardContent className="py-16 text-center text-muted-foreground">Select a campaign on the left to view its cycle timeline, intake Q&amp;A, and findings.</CardContent></Card>
                  )
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="inbox">
            <SinglePaneInbox inbox={inbox} onChanged={loadAll} />
          </TabsContent>
        </Tabs>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    planning: "bg-muted/50 text-muted-foreground",
    active: "bg-primary/10 text-primary",
    paused: "bg-amber-100 text-amber-700",
    review: "bg-primary/10 text-primary",
    finalized: "bg-emerald-100 text-emerald-700",
    cancelled: "bg-rose-100 text-rose-700",
  };
  return <Badge variant="outline" className={`${map[status] ?? ""} text-xs border-transparent`}>{status}</Badge>;
}

// SAMPLE_BRIEF used to be a hardcoded "Atlas Copper Holdings" mining case
// hardwired into the bundle. Now loaded from /api/vcr/sample-brief at click
// time, which returns an anonymized real completed assessment. See
// docs/Must Fix/PLAN.md item #8.
type SampleBrief = { clientName: string; valueCase: string };

function NewCampaignForm({ industries, onCreated }: { industries: Industry[]; onCreated: (a: Assessment) => void }) {
  const { isSignedIn } = useAuth();
  const [clientName, setClientName] = useState("");
  const [industryId, setIndustryId] = useState<string>("none");
  const [valueCase, setValueCase] = useState("");
  const [source, setSource] = useState<"typed" | "uploaded" | "voice_transcript">("typed");
  const [durationDays, setDurationDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sampleLoading, setSampleLoading] = useState(false);
  async function loadSample() {
    setSampleLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/vcr/sample-brief`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("No sample brief available yet — once any real assessment completes, this button will load it for testing.");
        } else {
          setError(`Failed to load sample (${res.status})`);
        }
        return;
      }
      const data = (await res.json()) as SampleBrief;
      setClientName(data.clientName);
      setValueCase(data.valueCase);
      setSource("typed");
    } catch {
      setError("Network error loading sample brief");
    } finally {
      setSampleLoading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setValueCase(text.slice(0, 30000));
    setSource("uploaded");
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const resp = await fetch(`${apiBase}/api/vcr/assessments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          industryId: industryId !== "none" ? Number(industryId) : undefined,
          valueCase: valueCase.trim(),
          valueCaseSource: source,
          durationDays,
          totalCycles: durationDays,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Create failed");
      onCreated(data.assessment);
      setClientName(""); setValueCase(""); setIndustryId("none");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  const ready = clientName.trim().length >= 2 && valueCase.trim().length >= 40;

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Launch Research Campaign</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">A multi-day agent plans each cycle, runs deep web research, cross-validates every claim against its sources, and asks the client follow-up questions. Findings and questions all land in the single-pane inbox for review.</p>
          </div>
          {isSignedIn ? (
            <Button type="button" size="sm" variant="outline" onClick={loadSample} disabled={sampleLoading} className="flex-shrink-0">
              {sampleLoading
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              Try with sample brief
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Client name</Label>
            <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Company or division being assessed" />
          </div>
          <div>
            <Label>Industry (optional)</Label>
            <Select value={industryId} onValueChange={setIndustryId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Campaign duration (days)</Label>
            <Input type="number" min={1} max={30} value={durationDays} onChange={e => setDurationDays(Math.max(1, Math.min(30, parseInt(e.target.value) || 7)))} />
            <p className="text-xs text-muted-foreground mt-1">One cycle per day, 4 deep research queries per cycle.</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Value case</Label>
            <div className="flex items-center gap-1 text-xs">
              <button type="button" onClick={() => setSource("typed")} className={`px-2 py-1 rounded-none inline-flex items-center gap-1 ${source === "typed" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}><Type className="w-3 h-3" />Typed</button>
              <label className={`px-2 py-1 rounded-none inline-flex items-center gap-1 cursor-pointer ${source === "uploaded" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                <Upload className="w-3 h-3" />Upload
                <input type="file" className="hidden" accept=".txt,.md,.json,.csv" onChange={onFile} />
              </label>
              <button type="button" onClick={() => setSource("voice_transcript")} className={`px-2 py-1 rounded-none inline-flex items-center gap-1 ${source === "voice_transcript" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}><Mic className="w-3 h-3" />Voice transcript</button>
            </div>
          </div>
          <Textarea value={valueCase} onChange={e => setValueCase(e.target.value)} className="min-h-[220px] font-mono text-sm" placeholder={`Paste a partner-level brief on the situation. The richer this is, the sharper the research.

Cover at minimum:
• Where the business is today — scale, geography, current capability stack
• The strategic question on the table — the decision that needs to be made
• What's at stake — the dollar value, time horizon, and downside if you're wrong
• What they've already tried, ruled out, or believe to be true
• Constraints — capital, talent, regulatory, political, timing

Numbers and named competitors make the agent dramatically more useful than vague prose.`} />
          <p className="text-xs text-muted-foreground mt-1">{valueCase.length} characters · minimum 40 · no upper limit, but ~3,000-8,000 characters tends to produce the strongest research plans</p>
        </div>

        {error && <div className="rounded-none border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        <Button onClick={submit} disabled={!ready || busy} className="w-full">
          {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Launching campaign & generating intake…</> : <><Sparkles className="w-4 h-4 mr-2" />Launch {durationDays}-Day Campaign</>}
        </Button>
      </CardContent>
    </Card>
  );
}

function CampaignDetail({ id, onChanged }: { id: number; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<{ assessment: Assessment; cycles: Cycle[]; questions: Question[]; researchItems: ResearchItem[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`${apiBase}/api/vcr/assessments/${id}`);
    setData(await r.json());
  }
  useEffect(() => { load(); }, [id]);

  if (!data) return <Card><CardContent className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>;
  const { assessment, cycles, questions, researchItems } = data;
  const intakeQs = questions.filter(q => q.cycleId === null);
  const allIntakeAnswered = intakeQs.length > 0 && intakeQs.every(q => (q.answer ?? "").trim().length > 0);
  const nextCycle = cycles.find(c => c.status === "scheduled");
  const approvedCount = researchItems.filter(r => r.status === "approved").length;

  async function runNext() {
    if (!nextCycle) return;
    setBusy("cycle"); setError(null);
    try {
      const r = await fetch(`${apiBase}/api/vcr/assessments/${id}/cycles/run-next`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Cycle failed");
      await load(); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Cycle failed"); }
    finally { setBusy(null); }
  }

  async function finalize() {
    setBusy("finalize"); setError(null);
    try {
      const r = await fetch(`${apiBase}/api/vcr/assessments/${id}/finalize`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Finalize failed");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Finalize failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="font-serif text-2xl">{assessment.clientName}</CardTitle>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <StatusBadge status={assessment.status} />
                <Badge variant="outline" className="text-xs">{assessment.valueCaseSource}</Badge>
                <Badge variant="outline" className="text-xs"><Calendar className="w-3 h-3 mr-1" />Day {assessment.currentCycle} of {assessment.totalCycles}</Badge>
                {assessment.scheduledStart && <span className="text-xs text-muted-foreground">{new Date(assessment.scheduledStart).toLocaleDateString()} → {assessment.scheduledEnd ? new Date(assessment.scheduledEnd).toLocaleDateString() : "?"}</span>}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" onClick={runNext} disabled={busy !== null || !nextCycle || (!allIntakeAnswered && intakeQs.length > 0)} title={!allIntakeAnswered ? "Answer intake questions first" : ""}>
                {busy === "cycle" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running cycle…</> : <><Play className="w-4 h-4 mr-2" />Run Next Cycle</>}
              </Button>
              <Button size="sm" variant="outline" onClick={finalize} disabled={busy !== null || approvedCount === 0}>
                {busy === "finalize" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileText className="w-4 h-4 mr-2" />Finalize ({approvedCount})</>}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {assessment.objective && (
            <div className="bg-primary/5 border border-primary/20 rounded-none p-3">
              <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-1">Campaign Objective</p>
              <p className="text-sm">{assessment.objective}</p>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Value case ({assessment.valueCase.length} chars)</summary>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{assessment.valueCase}</p>
          </details>
        </CardContent>
      </Card>

      {error && <div className="rounded-none border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      {/* Cycle timeline */}
      <Card>
        <CardHeader><CardTitle className="text-base"><Activity className="w-4 h-4 inline mr-2" />Cycle Timeline</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {cycles.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-3 border rounded-none">
                <div className="text-xs font-mono text-muted-foreground w-12">D{c.cycleNumber}</div>
                <Badge className={`${CYCLE_STATUS_COLOR[c.status] ?? ""} text-xs border-transparent`}>{c.status}</Badge>
                <div className="flex-1 min-w-0">
                  {c.objective ? <p className="text-sm truncate">{c.objective}</p> : <p className="text-sm text-muted-foreground italic">{c.scheduledFor ? `Scheduled ${new Date(c.scheduledFor).toLocaleDateString()}` : "Scheduled"}</p>}
                  {c.summary && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.summary}</p>}
                </div>
                <div className="text-xs text-right text-muted-foreground hidden sm:block">
                  {c.itemsCreated > 0 && <div>{c.itemsCreated} findings</div>}
                  {c.questionsCreated > 0 && <div>{c.questionsCreated} questions</div>}
                  {c.toolCalls > 0 && <div>{c.toolCalls} tool calls</div>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Intake Q&A */}
      {intakeQs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base"><MessageCircle className="w-4 h-4 inline mr-2" />Intake Questions ({intakeQs.length})</CardTitle></CardHeader>
          <CardContent>
            <IntakeQA questions={intakeQs} assessmentId={id} onSaved={load} />
          </CardContent>
        </Card>
      )}

      {/* All findings (drilldown — primary review happens in single pane) */}
      {researchItems.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">All Findings ({researchItems.length}) · {approvedCount} approved</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {researchItems.map(item => <FindingCard key={item.id} item={item} onChanged={load} />)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">All Findings</CardTitle></CardHeader>
          <CardContent className="py-10 text-center space-y-2">
            <Bot className="w-8 h-8 mx-auto text-muted-foreground/40" />
            {cycles.some(c => c.status === "completed") ? (
              <>
                <p className="text-sm font-medium">No findings produced yet</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">The completed cycle(s) didn&apos;t yield any persistable findings — usually a research-tier outage or a parse failure that survived the repair retry. Check the cycle timeline above for error details, then run the next cycle.</p>
              </>
            ) : !nextCycle ? (
              <p className="text-sm text-muted-foreground">No cycles scheduled. Add cycles or finalize the campaign with whatever was approved.</p>
            ) : !allIntakeAnswered && intakeQs.length > 0 ? (
              <p className="text-sm text-muted-foreground">Answer the intake questions above, then click <span className="font-medium">Run Next Cycle</span> to start research.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Click <span className="font-medium">Run Next Cycle</span> above to kick off the first research pass.</p>
            )}
          </CardContent>
        </Card>
      )}

      {assessment.finalReport && <FinalReportView report={assessment.finalReport} clientName={assessment.clientName} />}
    </div>
  );
}

function IntakeQA({ questions, assessmentId, onSaved }: { questions: Question[]; assessmentId: number; onSaved: () => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<number, string>>(() => Object.fromEntries(questions.map(q => [q.id, q.answer ?? ""])));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const payload = questions.filter(q => (answers[q.id] ?? "").trim().length > 0).map(q => ({ questionId: q.id, answer: answers[q.id].trim() }));
    if (payload.length > 0) {
      await fetch(`${apiBase}/api/vcr/assessments/${assessmentId}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: payload }) });
    }
    await onSaved();
    setBusy(false);
  }
  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <div key={q.id} className="space-y-1">
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono text-muted-foreground mt-1">Q{i + 1}</span>
            <div className="flex-1">
              <p className="text-sm font-medium">{q.question}</p>
              {q.rationale && <p className="text-xs text-muted-foreground italic">Why: {q.rationale}</p>}
            </div>
            {q.answer && <Badge className="bg-emerald-100 text-emerald-700 border-transparent text-xs">answered</Badge>}
          </div>
          <Textarea value={answers[q.id] ?? ""} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Your answer…" className="text-sm min-h-[60px]" />
        </div>
      ))}
      <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Answers"}</Button>
    </div>
  );
}

function FindingCard({ item, onChanged }: { item: ResearchItem; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);
  const [summary, setSummary] = useState(item.summary);
  const [notes, setNotes] = useState(item.reviewerNotes ?? "");
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    await fetch(`${apiBase}/api/vcr/research/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await onChanged(); setBusy(false); setEditing(false);
  }

  return (
    <div className="border rounded-none p-4 hover:bg-muted/30 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className={`text-xs ${KIND_COLORS[item.kind] ?? ""}`}>{item.kind.replace(/_/g, " ")}</Badge>
            <Badge variant="outline" className="text-xs">{Math.round(item.confidenceScore * 100)}%</Badge>
            <Badge variant="outline" className="text-xs">{item.evidenceCount} sources</Badge>
            {item.crossValidated && <Badge className="text-xs bg-emerald-100 text-emerald-700 border-transparent">cross-validated</Badge>}
            {item.contradictions?.length > 0 && <Badge variant="destructive" className="text-xs">{item.contradictions.length} contradictions</Badge>}
            {item.status === "approved" && <Badge className="text-xs bg-emerald-600">Approved</Badge>}
            {item.status === "rejected" && <Badge variant="destructive" className="text-xs">Rejected</Badge>}
            {item.status === "edited" && <Badge variant="outline" className="text-xs bg-primary/10 text-primary">Edited</Badge>}
          </div>
          <h4 className="font-semibold text-sm">{item.title}</h4>
        </div>
        {item.status === "pending" && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => patch({ status: "approved" })} disabled={busy}><CheckCircle2 className="w-4 h-4 text-emerald-600" /></Button>
            <Button size="sm" variant="ghost" onClick={() => patch({ status: "rejected" })} disabled={busy}><XCircle className="w-4 h-4 text-rose-600" /></Button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea value={summary} onChange={e => setSummary(e.target.value)} className="text-sm" />
          <Textarea value={body} onChange={e => setBody(e.target.value)} className="text-sm min-h-[160px]" />
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reviewer notes" className="text-xs" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => patch({ summary, body, reviewerNotes: notes, status: "edited" })} disabled={busy}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm mt-2">{item.summary}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">Full detail · {item.sources.length} sources</summary>
            <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed">{item.body}</p>
            {item.contradictions?.length > 0 && (
              <div className="mt-3 bg-destructive/5 border border-destructive/20 rounded-none p-2">
                <p className="text-xs font-medium text-destructive mb-1">Contradictions flagged</p>
                <ul className="text-xs space-y-0.5 list-disc pl-4">{item.contradictions.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}
            {item.sources.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Sources</p>
                <ul className="text-xs space-y-0.5">
                  {item.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate inline-block max-w-full">{s.title || s.url}</a></li>)}
                </ul>
              </div>
            )}
            {item.reviewerNotes && <p className="text-xs italic mt-2 text-muted-foreground">Reviewer: {item.reviewerNotes}</p>}
            <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button></div>
          </details>
        </>
      )}
    </div>
  );
}

function SinglePaneInbox({ inbox, onChanged }: { inbox: InboxResponse; onChanged: () => Promise<void> }) {
  const [filter, setFilter] = useState<"all" | "questions" | "findings">("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [answer, setAnswer] = useState<Record<number, string>>({});

  type UnifiedItem = { _kind: "q" | "f"; id: number; clientName: string; createdAt: string; raw: InboxFinding | InboxQuestion };
  const items: UnifiedItem[] = useMemo(() => {
    const list: UnifiedItem[] = [];
    if (filter !== "questions") for (const f of inbox.findings) list.push({ _kind: "f", id: f.id, clientName: f.clientName, createdAt: f.createdAt, raw: f });
    if (filter !== "findings") for (const q of inbox.questions) list.push({ _kind: "q", id: q.id, clientName: q.clientName, createdAt: q.askedAt, raw: q });
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }, [inbox, filter]);

  const grouped = useMemo(() => {
    const m: Record<string, UnifiedItem[]> = {};
    for (const it of items) (m[it.clientName] ??= []).push(it);
    return m;
  }, [items]);

  async function patchFinding(id: number, status: "approved" | "rejected") {
    setBusyId(id);
    await fetch(`${apiBase}/api/vcr/research/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    await onChanged(); setBusyId(null);
  }
  async function answerQuestion(id: number) {
    const a = answer[id]?.trim(); if (!a) return;
    setBusyId(id);
    await fetch(`${apiBase}/api/vcr/questions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: a }) });
    await onChanged(); setBusyId(null);
    setAnswer({ ...answer, [id]: "" });
  }
  async function dismissQuestion(id: number) {
    setBusyId(id);
    await fetch(`${apiBase}/api/vcr/questions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "dismissed" }) });
    await onChanged(); setBusyId(null);
  }

  if (items.length === 0 && filter === "all") return <Card><CardContent className="py-16 text-center text-muted-foreground">Single pane is clear. Pending findings and client questions will appear here as the agent runs cycles.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All ({inbox.counts.findings + inbox.counts.questions})</Button>
        <Button size="sm" variant={filter === "questions" ? "default" : "outline"} onClick={() => setFilter("questions")}><MessageCircle className="w-4 h-4 mr-1" />Client questions ({inbox.counts.questions})</Button>
        <Button size="sm" variant={filter === "findings" ? "default" : "outline"} onClick={() => setFilter("findings")}><Bot className="w-4 h-4 mr-1" />Agent findings ({inbox.counts.findings})</Button>
      </div>
      {Object.entries(grouped).map(([client, list]) => (
        <Card key={client}>
          <CardHeader className="pb-3"><CardTitle className="text-base">{client} <span className="text-muted-foreground font-normal text-sm">— {list.length} pending</span></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {list.map(it => it._kind === "f" ? (
              <div key={`f${it.id}`} className="border rounded-none p-3 flex items-start justify-between gap-3 bg-muted/20">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-transparent"><Bot className="w-3 h-3 mr-1" />Agent finding</Badge>
                    <Badge variant="outline" className={`text-xs ${KIND_COLORS[(it.raw as InboxFinding).kind] ?? ""}`}>{(it.raw as InboxFinding).kind.replace(/_/g, " ")}</Badge>
                    <Badge variant="outline" className="text-xs">{Math.round((it.raw as InboxFinding).confidenceScore * 100)}%</Badge>
                    <Badge variant="outline" className="text-xs">{(it.raw as InboxFinding).evidenceCount} sources</Badge>
                    {(it.raw as InboxFinding).crossValidated && <Badge className="text-xs bg-emerald-100 text-emerald-700 border-transparent">cross-validated</Badge>}
                    {((it.raw as InboxFinding).contradictions?.length ?? 0) > 0 && <Badge variant="destructive" className="text-xs">{(it.raw as InboxFinding).contradictions.length} contradictions</Badge>}
                  </div>
                  <h4 className="font-semibold text-sm">{(it.raw as InboxFinding).title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{(it.raw as InboxFinding).summary}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => patchFinding(it.id, "approved")} disabled={busyId === it.id}>{busyId === it.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}</Button>
                  <Button size="sm" variant="ghost" onClick={() => patchFinding(it.id, "rejected")} disabled={busyId === it.id}><XCircle className="w-4 h-4 text-rose-600" /></Button>
                </div>
              </div>
            ) : (
              <div key={`q${it.id}`} className="border rounded-none p-3 bg-primary/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-transparent"><MessageCircle className="w-3 h-3 mr-1" />Question for client</Badge>
                      <Badge variant="outline" className="text-xs">priority {(it.raw as InboxQuestion).priority}</Badge>
                      {(it.raw as InboxQuestion).cycleId && <Badge variant="outline" className="text-xs">from cycle</Badge>}
                    </div>
                    <p className="text-sm font-medium">{(it.raw as InboxQuestion).question}</p>
                    {(it.raw as InboxQuestion).rationale && <p className="text-xs text-muted-foreground italic mt-0.5">Why: {(it.raw as InboxQuestion).rationale}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => dismissQuestion(it.id)} disabled={busyId === it.id} title="Dismiss"><XCircle className="w-4 h-4 text-muted-foreground" /></Button>
                </div>
                <div className="mt-2 flex gap-2">
                  <Textarea
                    value={answer[it.id] ?? ""}
                    onChange={e => setAnswer({ ...answer, [it.id]: e.target.value })}
                    placeholder="Client answer…"
                    className="text-sm min-h-[60px] flex-1"
                  />
                  <Button size="sm" onClick={() => answerQuestion(it.id)} disabled={busyId === it.id || !(answer[it.id]?.trim())}>
                    {busyId === it.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FinalReportView({ report, clientName }: { report: FinalReport; clientName: string }) {
  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-none bg-emerald-600 text-white flex items-center justify-center"><FileText className="w-5 h-5" /></div>
          <div>
            <CardTitle className="font-serif text-2xl">Final Inflexcvi Assessment</CardTitle>
            <p className="text-sm text-muted-foreground">{clientName} · Assembled from approved findings across all cycles</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section><h3 className="font-serif text-lg tracking-tight mb-2">Executive Summary</h3><p className="text-sm leading-relaxed">{report.executiveSummary}</p></section>
        {report.capabilityGaps?.length > 0 && (
          <section><h3 className="font-serif text-lg tracking-tight mb-3">Capability Gaps</h3>
            <div className="space-y-2">{report.capabilityGaps.map((g, i) => (
              <div key={i} className="border-l-2 border-rose-400 pl-3 py-1">
                <p className="text-sm font-medium">{g.name}</p>
                <p className="text-xs text-muted-foreground">Gap: {g.gap}</p>
                <p className="text-xs text-muted-foreground">Impact: {g.impact}</p>
              </div>
            ))}</div></section>
        )}
        {report.recommendations?.length > 0 && (
          <section><h3 className="font-serif text-lg tracking-tight mb-3">Recommendations</h3>
            <div className="space-y-3">{report.recommendations.map((r, i) => (
              <div key={i} className="border rounded-none p-3 bg-white">
                <div className="flex items-center justify-between"><p className="text-sm font-semibold">{r.title}</p><Badge variant="outline" className="text-xs">{r.horizon}</Badge></div>
                <p className="text-xs text-muted-foreground mt-1">Rationale: {r.rationale}</p>
                <p className="text-xs text-emerald-700 mt-1">Impact: {r.impact}</p>
              </div>
            ))}</div></section>
        )}
        {report.quadrantInsights && (
          <section><h3 className="font-serif text-lg tracking-tight mb-3">Capability Quadrant Insights</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <QuadrantBlock label="Hot" color="bg-amber-50 border-amber-200 text-amber-900" items={report.quadrantInsights.hot} />
              <QuadrantBlock label="Emerging" color="bg-primary/5 border-primary/20 text-foreground" items={report.quadrantInsights.emerging} />
              <QuadrantBlock label="Cooling" color="bg-muted/30 border-border text-muted-foreground" items={report.quadrantInsights.cooling} />
              <QuadrantBlock label="Table-Stakes" color="bg-muted/20 border-border text-muted-foreground" items={report.quadrantInsights.tableStakes} />
            </div></section>
        )}
        {report.risks?.length > 0 && <section><h3 className="font-serif text-lg tracking-tight mb-2">Risks</h3><ul className="space-y-1 text-sm list-disc pl-5">{report.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></section>}
        {report.nextSteps?.length > 0 && <section><h3 className="font-serif text-lg tracking-tight mb-2">Next Steps</h3><ol className="space-y-1 text-sm list-decimal pl-5">{report.nextSteps.map((r, i) => <li key={i}>{r}</li>)}</ol></section>}
      </CardContent>
    </Card>
  );
}

function QuadrantBlock({ label, color, items }: { label: string; color: string; items: string[] }) {
  return (
    <div className={`rounded-none border p-3 ${color}`}>
      <p className="font-semibold text-xs uppercase tracking-wide mb-2">{label}</p>
      {items?.length > 0 ? <ul className="text-xs space-y-1 list-disc pl-4">{items.map((i, k) => <li key={k}>{i}</li>)}</ul> : <p className="text-xs italic opacity-60">None</p>}
    </div>
  );
}
