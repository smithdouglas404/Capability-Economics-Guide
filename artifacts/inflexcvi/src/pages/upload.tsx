/**
 * /upload — drag a business plan / pitch deck / strategy memo, get back
 * a capability-gap analysis matched against our live graph.
 *
 * Move 6 of the strategic UX overhaul — the actual differentiator. Anyone
 * can wrap Perplexity; nobody else has the capability graph the user's
 * plan can be matched against. Free tier capped at 3 analyses/month per
 * signed-in user.
 *
 * Three intake paths:
 *   1. Drag-and-drop PDF / docx / txt
 *   2. File picker (same)
 *   3. Paste raw text (skips file storage)
 *
 * On submit → progress bar with stage labels (extracting → matching →
 * composing) → markdown report renders inline + download button hooks
 * into the Move 3 export menu.
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { useCompletion } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Upload, FileText, Loader2, AlertCircle, CheckCircle2, Sparkles, Download, History, Zap, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/page-header";
import { SourceRow } from "@/components/source-badge";
import { downloadFile } from "@/lib/exports";

const STAGE_LABELS: Record<string, string> = {
  extracting: "Reading the document…",
  matching: "Matching to our capability graph…",
  composing: "Composing the analysis…",
  complete: "Done",
};

interface AnalysisListItem {
  id: number;
  filename: string;
  fileType: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

interface AnalyzeResult {
  ok: true;
  id: number;
  report: string;
}

export default function UploadPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reportId, setReportId] = useState<number | null>(null);
  const [history, setHistory] = useState<AnalysisListItem[]>([]);
  const [usage, setUsage] = useState<{ used: number; cap: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Anonymized peer-upload total — drives the social-proof tile near the
  // intake area. Public endpoint (no auth), just a single COUNT(*).
  const [peerCount, setPeerCount] = useState<number | null>(null);
  useEffect(() => {
    fetch("/api/upload-analyses/count")
      .then(r => r.ok ? r.json() : null)
      .then((d: { count?: number } | null) => {
        if (typeof d?.count === "number") setPeerCount(d.count);
      })
      .catch(() => {});
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const r = await fetch("/api/upload-analysis");
      if (!r.ok) return;
      const data = await r.json() as { analyses: AnalysisListItem[]; monthlyUsage: { used: number; cap: number } };
      setHistory(data.analyses);
      setUsage(data.monthlyUsage);
    } catch { /* non-fatal */ }
  }, [isSignedIn]);

  // ── Vercel AI SDK streaming (paste-text path) ────────────────────────
  // useCompletion is the streaming-text equivalent of useChat. We point it
  // at our /api/upload-analysis/text-stream endpoint, which streams the
  // composed markdown report token-by-token via the AI SDK protocol. The
  // `completion` field below is the live, growing string — re-renders on
  // every chunk so the report appears progressively (ChatGPT-style),
  // making the SDK's presence visible instead of hiding behind a fake
  // progress bar.
  const {
    completion: streamingReport,
    complete: streamReport,
    isLoading: streaming,
    error: streamError,
  } = useCompletion({
    api: "/api/upload-analysis/text-stream",
    streamProtocol: "text",
    onFinish: () => { void refreshHistory(); },
  });

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  const submit = async (): Promise<void> => {
    setError(null);
    setReport(null);
    setReportId(null);

    // ── Paste-text path → streaming via Vercel AI SDK ──────────────
    // Skips the local progress-bar / fake-tick UX in favor of useCompletion's
    // live `streamingReport` string. The body chunks render token-by-token
    // in the report card below as they arrive.
    if (mode === "paste") {
      if (pasteText.trim().length < 100) {
        setError("Paste at least 100 characters.");
        return;
      }
      void streamReport(pasteText, { body: { title: pasteTitle || "Pasted text" } });
      return;
    }

    // ── File path → one-shot (multipart isn't streamable cheaply) ──
    setSubmitting(true);
    setProgress(10);
    const interval = setInterval(() => {
      setProgress(p => (p < 85 ? p + 5 : p));
    }, 800);

    try {
      if (!file) throw new Error("Pick a file first.");
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/upload-analysis", { method: "POST", body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json() as AnalyzeResult;
      setReport(data.report);
      setReportId(data.id);
      setProgress(100);
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(interval);
      setSubmitting(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); setMode("file"); }
  };

  const downloadReport = (): void => {
    if (!report || !reportId) return;
    const today = new Date().toISOString().slice(0, 10);
    downloadFile(`capability-analysis-${reportId}-${today}.md`, report, "text/markdown;charset=utf-8");
  };

  if (!isLoaded) return null;

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Workbench"
        title="Upload → Capability Analysis"
        descriptions={{
          default: "Drag in your business plan, pitch deck, or strategy memo. We extract the capability claims, match them to our live graph, and tell you which are defensible, which are commodified, and what's missing.",
          pe: "Pre-IC due diligence. Drop in the CIM or pitch deck; the report flags capability claims with active disruption (DVX > 70), commodified table-stakes (high CVI, low velocity), and the standard capabilities the target failed to claim. Counter-questions for the management meeting included.",
          vc: "Pre-meeting screen. Upload the deck; in 90 seconds you'll have a capability map matched to the live graph, the questions your associate should ask the founder, and which claims are aligned with rising CVI vs heading into the disruption zone.",
          f500: "Pressure-test your strategy doc. Upload your three-year plan or M&A target's CIM; the report tells you whether your build/buy/partner posture aligns with where capability value is concentrating.",
          student: "Try it with a public S-1 or 10-K. The capability extraction + match output is a worked example of how to think about a company's defensibility in capability-graph terms — exactly the analytical move we teach at /methodology.",
          professor: "Assign students to upload a competing pair of business plans; have them defend why one's vulnerable claims should be downweighted relative to the other's strongest claims. Citable rubric grounded in CVI / DVX.",
        }}
      />

      <SourceRow sources={["internal", "anthropic", "world-bank", "edgar"]} label="Powered by" />

      {/* Social-proof tile — peer upload count, anonymized. Hides on first
          run (count === null) and when count is 0 to avoid showing "0 peers". */}
      {peerCount !== null && peerCount > 0 && (
        <Card className="border-accent/30 bg-accent/[0.04]">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Users className="w-4 h-4 text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm">
                <span className="font-mono tabular-nums font-medium">{peerCount.toLocaleString()}</span>
                {" "}similar upload{peerCount === 1 ? "" : "s"} from peers — anonymized
              </div>
              <div className="text-[11px] text-muted-foreground">
                Aggregate across all users. We never share file contents or identities.
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0">Live</Badge>
          </CardContent>
        </Card>
      )}

      {!isSignedIn ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Sparkles className="w-8 h-8 text-accent mx-auto" />
            <h3 className="font-serif text-xl">Sign in to upload</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              We need a user account to scope analyses to you and apply the free-tier monthly limit. No payment required to start.
            </p>
            <SignInButton mode="modal">
              <Button>Sign in</Button>
            </SignInButton>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Intake card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">New analysis</CardTitle>
                {usage && (
                  <Badge variant="outline" className="rounded-full text-[10px]">
                    {usage.used}/{usage.cap} this month
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 text-sm">
                <button
                  onClick={() => setMode("file")}
                  className={`px-3 py-1.5 border rounded-md ${mode === "file" ? "border-accent bg-accent/10 text-accent" : "border-border/60 hover:border-accent"}`}
                >
                  Upload file
                </button>
                <button
                  onClick={() => setMode("paste")}
                  className={`px-3 py-1.5 border rounded-md ${mode === "paste" ? "border-accent bg-accent/10 text-accent" : "border-border/60 hover:border-accent"}`}
                >
                  Paste text
                </button>
              </div>

              {mode === "file" ? (
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    isDragging ? "border-accent bg-accent/5" : "border-border/60 hover:border-accent/50"
                  }`}
                >
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <div className="text-sm">
                    {file ? (
                      <span className="font-medium">{file.name}</span>
                    ) : (
                      <>
                        <span className="font-medium">Drop a file</span> or{" "}
                        <label className="text-accent hover:underline cursor-pointer">
                          browse
                          <input
                            type="file"
                            accept=".pdf,.docx,.txt,.md"
                            onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }}
                            className="hidden"
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">PDF · DOCX · TXT · MD · max 8MB</div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="Title (optional, e.g. 'Acme Q3 strategy memo')"
                    value={pasteTitle}
                    onChange={e => setPasteTitle(e.target.value)}
                  />
                  <Textarea
                    placeholder="Paste your business plan, pitch deck text, or strategy memo here. Minimum 100 characters."
                    rows={10}
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <div className="text-[10px] text-muted-foreground text-right">
                    {pasteText.length.toLocaleString()} chars
                  </div>
                </div>
              )}

              {submitting && (
                <div className="space-y-1">
                  <Progress value={progress} />
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {progress < 30 ? STAGE_LABELS.extracting : progress < 70 ? STAGE_LABELS.matching : STAGE_LABELS.composing}
                  </div>
                </div>
              )}

              {(error || streamError) && (
                <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 rounded text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error || streamError?.message}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-accent" />
                  Streaming via Vercel AI SDK · Claude Sonnet · Free tier: {usage?.cap ?? 3}/month
                </p>
                <Button
                  onClick={submit}
                  disabled={submitting || streaming || (mode === "file" ? !file : pasteText.trim().length < 100)}
                >
                  {submitting || streaming ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Analyze
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Live streaming report (paste-text path, Vercel AI SDK useCompletion).
              Renders the markdown as tokens arrive so the user sees the
              analysis being written instead of waiting for a single payload. */}
          {(streaming || streamingReport) && mode === "paste" && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  {streaming ? <Loader2 className="w-4 h-4 text-accent animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  <CardTitle className="text-base">
                    {streaming ? "Writing your analysis…" : "Analysis report"}
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                    <Zap className="w-2.5 h-2.5 mr-0.5" /> Streaming · Vercel AI SDK
                  </Badge>
                </div>
                {!streaming && streamingReport && (
                  <Button variant="outline" size="sm" onClick={() => downloadFile(`capability-analysis-${new Date().toISOString().slice(0,10)}.md`, streamingReport, "text/markdown;charset=utf-8")}>
                    <Download className="w-4 h-4 mr-1" /> Download Markdown
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingReport || ""}</ReactMarkdown>
                  {streaming && (
                    <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-1" aria-hidden />
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* One-shot file-upload report (non-streaming path). */}
          {report && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <CardTitle className="text-base">Analysis report</CardTitle>
                </div>
                <Button variant="outline" size="sm" onClick={downloadReport}>
                  <Download className="w-4 h-4 mr-1" /> Download Markdown
                </Button>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {/* History */}
          {history.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Your past analyses
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/40">
                {history.map(h => (
                  <Link key={h.id} href={`/upload/${h.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-muted/30 -mx-2 px-2 rounded cursor-pointer">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{h.filename}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{h.status}</Badge>
                      <span>{new Date(h.createdAt).toISOString().slice(0, 10)}</span>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
