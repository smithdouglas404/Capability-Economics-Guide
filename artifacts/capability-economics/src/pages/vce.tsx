import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2, Send, Sparkles, Inbox, FileText, CheckCircle2, XCircle, Mic, Upload, Type, RefreshCw, Trash2, Play } from "lucide-react";

const apiBase = import.meta.env.VITE_API_URL || "";

type Industry = { id: number; name: string; slug: string };
type Assessment = {
  id: number;
  clientName: string;
  industryId: number | null;
  valueCase: string;
  valueCaseSource: string;
  status: string;
  executiveSummary: string | null;
  finalReport: FinalReport | null;
  createdAt: string;
  updatedAt: string;
};
type Question = { id: number; assessmentId: number; question: string; rationale: string | null; answer: string | null; displayOrder: number; askedAt: string; answeredAt: string | null };
type ResearchItem = {
  id: number;
  assessmentId: number;
  kind: string;
  title: string;
  summary: string;
  body: string;
  sources: { url: string; title: string }[];
  confidenceScore: number;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewerNotes: string | null;
  includeInReport: boolean;
  createdAt: string;
  reviewedAt: string | null;
};
type InboxItem = ResearchItem & { clientName: string };
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
  recommendation: "bg-blue-100 text-blue-800 border-blue-200",
  risk: "bg-amber-100 text-amber-800 border-amber-200",
  insight: "bg-violet-100 text-violet-800 border-violet-200",
  benchmark: "bg-slate-100 text-slate-800 border-slate-200",
};

export default function VCEPage() {
  const [tab, setTab] = useState<"new" | "active" | "inbox">("active");
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadAll() {
    const [a, i, ind] = await Promise.all([
      fetch(`${apiBase}/api/vce/assessments`).then(r => r.json()).catch(() => []),
      fetch(`${apiBase}/api/vce/inbox`).then(r => r.json()).catch(() => []),
      fetch(`${apiBase}/api/industries`).then(r => r.json()).catch(() => []),
    ]);
    setAssessments(Array.isArray(a) ? a : []);
    setInbox(Array.isArray(i) ? i : []);
    setIndustries(Array.isArray(ind) ? ind : []);
  }
  useEffect(() => { loadAll(); }, []);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white">
                <Sparkles className="w-5 h-5" />
              </div>
              <h1 className="font-serif text-3xl font-bold">Virtual Capability Engineer</h1>
            </div>
            <p className="text-muted-foreground max-w-3xl">
              Submit a client value case (typed, voice transcript, or uploaded). The VCE asks clarifying questions, runs autonomous research, and routes findings to the consultant inbox for review before assembling the final assessment.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList className="grid grid-cols-3 w-full max-w-2xl mb-6">
            <TabsTrigger value="new"><Send className="w-4 h-4 mr-2" />New Assessment</TabsTrigger>
            <TabsTrigger value="active"><FileText className="w-4 h-4 mr-2" />Active ({assessments.length})</TabsTrigger>
            <TabsTrigger value="inbox"><Inbox className="w-4 h-4 mr-2" />Consultant Inbox ({inbox.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="new">
            <NewAssessmentForm
              industries={industries}
              onCreated={async (a) => { await loadAll(); setSelectedId(a.id); setTab("active"); }}
              setLoading={setLoading}
            />
          </TabsContent>

          <TabsContent value="active">
            <div className="grid lg:grid-cols-[300px_1fr] gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">All Assessments</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {assessments.length === 0 && <p className="text-sm text-muted-foreground">No assessments yet. Create one in the "New Assessment" tab.</p>}
                  {assessments.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      className={`w-full text-left p-3 rounded-md border transition ${selectedId === a.id ? "border-violet-400 bg-violet-50" : "hover:bg-muted/50"}`}
                    >
                      <div className="font-medium text-sm truncate">{a.clientName}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <StatusBadge status={a.status} />
                        <span className="text-xs text-muted-foreground">{new Date(a.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
              <div>
                {selectedId ? <AssessmentDetail id={selectedId} onChanged={loadAll} /> : (
                  <Card><CardContent className="py-16 text-center text-muted-foreground">Select an assessment to view its intake, research, and final report.</CardContent></Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="inbox">
            <ConsultantInbox items={inbox} onChanged={loadAll} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    intake: "bg-slate-100 text-slate-700 border-slate-200",
    researching: "bg-blue-100 text-blue-700 border-blue-200",
    review: "bg-amber-100 text-amber-700 border-amber-200",
    finalized: "bg-emerald-100 text-emerald-700 border-emerald-200",
  };
  return <Badge variant="outline" className={`${map[status] ?? ""} text-xs`}>{status}</Badge>;
}

function NewAssessmentForm({ industries, onCreated, setLoading }: {
  industries: Industry[];
  onCreated: (a: Assessment) => void;
  setLoading: (b: boolean) => void;
}) {
  const [clientName, setClientName] = useState("");
  const [industryId, setIndustryId] = useState<string>("none");
  const [valueCase, setValueCase] = useState("");
  const [source, setSource] = useState<"typed" | "uploaded" | "voice_transcript">("typed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setValueCase(text.slice(0, 30000));
    setSource("uploaded");
  }

  async function submit() {
    setBusy(true); setLoading(true); setError(null);
    try {
      const resp = await fetch(`${apiBase}/api/vce/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          industryId: industryId !== "none" ? Number(industryId) : undefined,
          valueCase: valueCase.trim(),
          valueCaseSource: source,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Create failed");
      onCreated(data.assessment);
      setClientName(""); setValueCase(""); setIndustryId("none");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); setLoading(false); }
  }

  const ready = clientName.trim().length >= 2 && valueCase.trim().length >= 40;

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Submit Client Value Case</CardTitle>
        <p className="text-sm text-muted-foreground">The VCE will read this, generate clarifying questions, then go off and research before producing findings for your review.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Client name</Label>
            <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Newcrest Mining" />
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
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Value case</Label>
            <div className="flex items-center gap-1 text-xs">
              <button type="button" onClick={() => setSource("typed")} className={`px-2 py-1 rounded inline-flex items-center gap-1 ${source === "typed" ? "bg-violet-100 text-violet-700" : "text-muted-foreground"}`}><Type className="w-3 h-3" />Typed</button>
              <label className={`px-2 py-1 rounded inline-flex items-center gap-1 cursor-pointer ${source === "uploaded" ? "bg-violet-100 text-violet-700" : "text-muted-foreground"}`}>
                <Upload className="w-3 h-3" />Upload
                <input type="file" className="hidden" accept=".txt,.md,.json,.csv" onChange={onFile} />
              </label>
              <button type="button" onClick={() => setSource("voice_transcript")} className={`px-2 py-1 rounded inline-flex items-center gap-1 ${source === "voice_transcript" ? "bg-violet-100 text-violet-700" : "text-muted-foreground"}`}><Mic className="w-3 h-3" />Voice transcript</button>
            </div>
          </div>
          <Textarea
            value={valueCase}
            onChange={e => setValueCase(e.target.value)}
            placeholder="Describe the client situation, the value at stake, the strategic question they need answered, any context on incumbents, threats, opportunities, capabilities they think they have or lack..."
            className="min-h-[220px] font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">{valueCase.length} chars · min 40</p>
        </div>

        {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

        <Button onClick={submit} disabled={!ready || busy} className="w-full">
          {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating intake questions…</> : <><Sparkles className="w-4 h-4 mr-2" />Submit & Generate Questions</>}
        </Button>
      </CardContent>
    </Card>
  );
}

function AssessmentDetail({ id, onChanged }: { id: number; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<{ assessment: Assessment; questions: Question[]; researchItems: ResearchItem[] } | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`${apiBase}/api/vce/assessments/${id}`);
    const j = await r.json();
    setData(j);
    const a: Record<number, string> = {};
    for (const q of j.questions ?? []) a[q.id] = q.answer ?? "";
    setAnswers(a);
  }
  useEffect(() => { load(); }, [id]);

  if (!data) return <Card><CardContent className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>;
  const { assessment, questions, researchItems } = data;
  const allAnswered = questions.length > 0 && questions.every(q => (answers[q.id] ?? "").trim().length > 0);
  const approvedCount = researchItems.filter(r => r.status === "approved").length;

  async function saveAnswers() {
    setBusy("answers"); setError(null);
    try {
      const payload = questions.filter(q => (answers[q.id] ?? "").trim().length > 0).map(q => ({ questionId: q.id, answer: answers[q.id].trim() }));
      const r = await fetch(`${apiBase}/api/vce/assessments/${id}/answer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function runResearch() {
    setBusy("research"); setError(null);
    try {
      const r = await fetch(`${apiBase}/api/vce/assessments/${id}/research`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Research failed");
      await load(); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Research failed"); }
    finally { setBusy(null); }
  }

  async function finalize() {
    setBusy("finalize"); setError(null);
    try {
      const r = await fetch(`${apiBase}/api/vce/assessments/${id}/finalize`, { method: "POST" });
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
              <div className="flex items-center gap-2 mt-2">
                <StatusBadge status={assessment.status} />
                <Badge variant="outline" className="text-xs">{assessment.valueCaseSource}</Badge>
                <span className="text-xs text-muted-foreground">Created {new Date(assessment.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Value case ({assessment.valueCase.length} chars)</summary>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{assessment.valueCase}</p>
          </details>
        </CardContent>
      </Card>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Intake Questions ({questions.length})</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={saveAnswers} disabled={busy !== null}>
                {busy === "answers" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Answers"}
              </Button>
              <Button size="sm" onClick={runResearch} disabled={busy !== null || !allAnswered}>
                {busy === "research" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Researching… (may take 1-3 min)</> : <><Play className="w-4 h-4 mr-2" />Run Autonomous Research</>}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {questions.length === 0 && <p className="text-sm text-muted-foreground">No questions yet.</p>}
          {questions.map((q, idx) => (
            <div key={q.id} className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-xs font-mono text-muted-foreground mt-1">Q{idx + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{q.question}</p>
                  {q.rationale && <p className="text-xs text-muted-foreground italic mt-0.5">Why: {q.rationale}</p>}
                </div>
              </div>
              <Textarea
                value={answers[q.id] ?? ""}
                onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}
                placeholder="Your answer…"
                className="text-sm min-h-[70px]"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {researchItems.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Research Findings ({researchItems.length}) · {approvedCount} approved</CardTitle>
              <Button size="sm" onClick={finalize} disabled={busy !== null || approvedCount === 0}>
                {busy === "finalize" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Assembling…</> : <><FileText className="w-4 h-4 mr-2" />Assemble Final Report</>}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {researchItems.map(item => (
              <ResearchItemCard key={item.id} item={item} onChanged={load} />
            ))}
          </CardContent>
        </Card>
      )}

      {assessment.finalReport && <FinalReportView report={assessment.finalReport} clientName={assessment.clientName} />}
    </div>
  );
}

function ResearchItemCard({ item, onChanged }: { item: ResearchItem; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);
  const [summary, setSummary] = useState(item.summary);
  const [notes, setNotes] = useState(item.reviewerNotes ?? "");
  const [busy, setBusy] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    setBusy(true);
    await fetch(`${apiBase}/api/vce/research/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await onChanged(); setBusy(false); setEditing(false);
  }

  return (
    <div className="border rounded-md p-4 hover:bg-muted/30 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className={`text-xs ${KIND_COLORS[item.kind] ?? ""}`}>{item.kind.replace(/_/g, " ")}</Badge>
            <Badge variant="outline" className="text-xs">{Math.round(item.confidenceScore * 100)}% confidence</Badge>
            {item.status === "approved" && <Badge className="text-xs bg-emerald-600">Approved</Badge>}
            {item.status === "rejected" && <Badge variant="destructive" className="text-xs">Rejected</Badge>}
            {item.status === "edited" && <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700">Edited</Badge>}
          </div>
          <h4 className="font-semibold text-sm">{item.title}</h4>
        </div>
        {item.status === "pending" && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => patch({ status: "approved" })} disabled={busy} title="Approve">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => patch({ status: "rejected" })} disabled={busy} title="Reject">
              <XCircle className="w-4 h-4 text-rose-600" />
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea value={summary} onChange={e => setSummary(e.target.value)} className="text-sm" />
          <Textarea value={body} onChange={e => setBody(e.target.value)} className="text-sm min-h-[160px]" />
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reviewer notes (optional)" className="text-xs" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => patch({ summary, body, reviewerNotes: notes, status: "edited" })} disabled={busy}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm mt-2">{item.summary}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">Full detail</summary>
            <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed">{item.body}</p>
            {item.sources.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Sources</p>
                <ul className="text-xs space-y-0.5">
                  {item.sources.map((s, i) => (
                    <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate inline-block max-w-full">{s.title || s.url}</a></li>
                  ))}
                </ul>
              </div>
            )}
            {item.reviewerNotes && <p className="text-xs italic mt-2 text-muted-foreground">Reviewer: {item.reviewerNotes}</p>}
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function ConsultantInbox({ items, onChanged }: { items: InboxItem[]; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  async function patch(id: number, status: "approved" | "rejected") {
    setBusyId(id);
    await fetch(`${apiBase}/api/vce/research/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    await onChanged(); setBusyId(null);
  }
  const grouped = useMemo(() => {
    const m: Record<string, InboxItem[]> = {};
    for (const it of items) { (m[it.clientName] ??= []).push(it); }
    return m;
  }, [items]);

  if (items.length === 0) return <Card><CardContent className="py-16 text-center text-muted-foreground">Inbox is empty. Pending research findings will appear here for review.</CardContent></Card>;

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([client, list]) => (
        <Card key={client}>
          <CardHeader><CardTitle className="text-base">{client} <span className="text-muted-foreground font-normal text-sm">— {list.length} pending</span></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {list.map(it => (
              <div key={it.id} className="border rounded-md p-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-xs ${KIND_COLORS[it.kind] ?? ""}`}>{it.kind.replace(/_/g, " ")}</Badge>
                    <Badge variant="outline" className="text-xs">{Math.round(it.confidenceScore * 100)}%</Badge>
                  </div>
                  <h4 className="font-semibold text-sm">{it.title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{it.summary}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => patch(it.id, "approved")} disabled={busyId === it.id}>
                    {busyId === it.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => patch(it.id, "rejected")} disabled={busyId === it.id}>
                    <XCircle className="w-4 h-4 text-rose-600" />
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
    <Card className="border-emerald-200 bg-gradient-to-br from-white to-emerald-50/40">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center"><FileText className="w-5 h-5" /></div>
          <div>
            <CardTitle className="font-serif text-2xl">Final Capability Economics Assessment</CardTitle>
            <p className="text-sm text-muted-foreground">{clientName} · Assembled from approved findings</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <h3 className="font-serif text-lg font-semibold mb-2">Executive Summary</h3>
          <p className="text-sm leading-relaxed">{report.executiveSummary}</p>
        </section>

        {report.capabilityGaps?.length > 0 && (
          <section>
            <h3 className="font-serif text-lg font-semibold mb-3">Capability Gaps</h3>
            <div className="space-y-2">
              {report.capabilityGaps.map((g, i) => (
                <div key={i} className="border-l-2 border-rose-400 pl-3 py-1">
                  <p className="text-sm font-medium">{g.name}</p>
                  <p className="text-xs text-muted-foreground">Gap: {g.gap}</p>
                  <p className="text-xs text-muted-foreground">Impact: {g.impact}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {report.recommendations?.length > 0 && (
          <section>
            <h3 className="font-serif text-lg font-semibold mb-3">Recommendations</h3>
            <div className="space-y-3">
              {report.recommendations.map((r, i) => (
                <div key={i} className="border rounded-md p-3 bg-white">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{r.title}</p>
                    <Badge variant="outline" className="text-xs">{r.horizon}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Rationale: {r.rationale}</p>
                  <p className="text-xs text-emerald-700 mt-1">Impact: {r.impact}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {report.quadrantInsights && (
          <section>
            <h3 className="font-serif text-lg font-semibold mb-3">Capability Quadrant Insights</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <QuadrantBlock label="Hot" color="bg-amber-50 border-amber-200 text-amber-900" items={report.quadrantInsights.hot} />
              <QuadrantBlock label="Emerging" color="bg-blue-50 border-blue-200 text-blue-900" items={report.quadrantInsights.emerging} />
              <QuadrantBlock label="Cooling" color="bg-slate-50 border-slate-200 text-slate-700" items={report.quadrantInsights.cooling} />
              <QuadrantBlock label="Table-Stakes" color="bg-zinc-50 border-zinc-200 text-zinc-700" items={report.quadrantInsights.tableStakes} />
            </div>
          </section>
        )}

        {report.risks?.length > 0 && (
          <section>
            <h3 className="font-serif text-lg font-semibold mb-2">Risks</h3>
            <ul className="space-y-1 text-sm list-disc pl-5">
              {report.risks.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </section>
        )}

        {report.nextSteps?.length > 0 && (
          <section>
            <h3 className="font-serif text-lg font-semibold mb-2">Next Steps</h3>
            <ol className="space-y-1 text-sm list-decimal pl-5">
              {report.nextSteps.map((r, i) => <li key={i}>{r}</li>)}
            </ol>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function QuadrantBlock({ label, color, items }: { label: string; color: string; items: string[] }) {
  return (
    <div className={`rounded-md border p-3 ${color}`}>
      <p className="font-semibold text-xs uppercase tracking-wide mb-2">{label}</p>
      {items?.length > 0 ? <ul className="text-xs space-y-1 list-disc pl-4">{items.map((i, k) => <li key={k}>{i}</li>)}</ul> : <p className="text-xs italic opacity-60">None</p>}
    </div>
  );
}
