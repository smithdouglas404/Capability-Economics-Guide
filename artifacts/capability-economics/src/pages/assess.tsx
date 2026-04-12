import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Upload, X, FileText, ArrowRight, ChevronRight,
  Building2, Loader2, CheckCircle2, AlertTriangle, TrendingUp,
  ShieldAlert, Lightbulb, ExternalLink, BarChart3, BookOpen, Search
} from "lucide-react";

import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, Legend, ResponsiveContainer, Tooltip
} from "recharts";

interface SecCompanyResult {
  entityName: string;
  cik: string;
  fileDate: string;
  period: string;
  location: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

const INDUSTRIES = [
  "Insurance", "Banking & Financial Services", "Healthcare & Life Sciences",
  "Retail & Consumer Goods", "Technology & Software", "Manufacturing",
  "Energy & Utilities", "Telecommunications", "Real Estate",
  "Transportation & Logistics", "Professional Services", "Media & Entertainment",
  "Government & Public Sector", "Education", "Other",
];

type Step = "input" | "questions" | "analyzing" | "results";

interface CapabilityMapItem {
  capability: string;
  category: string;
  wefAlignment: string;
  currentMaturity: number;
  strategicImportance: number;
  action: "INVEST" | "HOLD" | "DIVEST" | "EMERGING";
  timeHorizon: "NOW" | "12-24M" | "3YR+";
  gap: boolean;
  gapSeverity: "CRITICAL" | "MODERATE" | "LOW" | null;
}

interface GapItem {
  capability: string;
  exposure: string;
  recommendation: string;
  urgency: "IMMEDIATE" | "NEAR_TERM" | "WATCH";
}

interface RadarDataPoint {
  axis: string;
  invest: number;
  hold: number;
  divest: number;
  emerging: number;
}

interface Recommendation {
  title: string;
  rationale: string;
  impact: string;
  wefReference: string;
}

interface AnalysisResult {
  executiveSummary: string;
  capabilityMap: CapabilityMapItem[];
  gaps: GapItem[];
  radarData: RadarDataPoint[];
  topRecommendations: Recommendation[];
  secInsights: { summary: string; capabilityImplications: string[] } | null;
  confidenceScore: number;
  confidenceFactors: {
    inputRichness: number;
    industryDataQuality: number;
    secDataAvailable: boolean;
    voiceProvided: boolean;
    documentProvided: boolean;
  };
}

const actionBadge: Record<string, string> = {
  INVEST: "bg-primary/15 text-primary border border-primary/20",
  HOLD: "bg-muted text-muted-foreground border border-border",
  DIVEST: "bg-destructive/10 text-destructive border border-destructive/20",
  EMERGING: "bg-accent/15 text-accent-foreground border border-accent/30",
};

const urgencyBadge: Record<string, string> = {
  IMMEDIATE: "bg-destructive/10 text-destructive border border-destructive/20",
  NEAR_TERM: "bg-primary/10 text-primary border border-primary/20",
  WATCH: "bg-muted text-muted-foreground border border-border",
};

export default function Assess() {
  const [step, setStep] = useState<Step>("input");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [documentText, setDocumentText] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [secStatus, setSecStatus] = useState<"idle" | "searching" | "found" | "not_found">("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companySearchResults, setCompanySearchResults] = useState<SecCompanyResult[]>([]);
  const [companySearchLoading, setCompanySearchLoading] = useState(false);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [selectedCompanyCik, setSelectedCompanyCik] = useState("");
  const [selectedCompanyConfirmed, setSelectedCompanyConfirmed] = useState(false);
  const companySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const interimRef = useRef<string>("");
  const finalRef = useRef<string>("");

  const startRecording = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SRClass = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SRClass) {
      alert("Voice recording requires Chrome or Edge. Please use those browsers or type your briefing instead.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SRClass();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    finalRef.current = voiceTranscript;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = "";
      let finalParts = finalRef.current;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalParts += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }
      finalRef.current = finalParts;
      interimRef.current = interim;
      setVoiceTranscript(finalParts + interim);
    };
    rec.onerror = () => setIsRecording(false);
    rec.onend = () => setIsRecording(false);
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, [voiceTranscript]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const handleFileUpload = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError("File must be under 5MB.");
      return;
    }
    setDocumentName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setDocumentText(text.slice(0, 12000));
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleCompanyInput = (value: string) => {
    setCompanyName(value);
    setSelectedCompanyCik("");
    setSelectedCompanyConfirmed(false);
    setCompanyDropdownOpen(false);
    setCompanySearchResults([]);
    if (companySearchTimer.current) clearTimeout(companySearchTimer.current);
    if (value.trim().length < 2) return;
    companySearchTimer.current = setTimeout(async () => {
      setCompanySearchLoading(true);
      try {
        const resp = await fetch(`${API}/sec/search?q=${encodeURIComponent(value)}`);
        const data = await resp.json() as { results: SecCompanyResult[] };
        if (data.results?.length) {
          setCompanySearchResults(data.results);
          setCompanyDropdownOpen(true);
        } else {
          setCompanySearchResults([]);
          setCompanyDropdownOpen(false);
        }
      } catch {
        setCompanySearchResults([]);
      } finally {
        setCompanySearchLoading(false);
      }
    }, 450);
  };

  const selectCompany = (result: SecCompanyResult) => {
    setCompanyName(result.entityName);
    setSelectedCompanyCik(result.cik);
    setSelectedCompanyConfirmed(true);
    setCompanyDropdownOpen(false);
    setCompanySearchResults([]);
  };

  const clearCompany = () => {
    setCompanyName("");
    setSelectedCompanyCik("");
    setSelectedCompanyConfirmed(false);
    setCompanyDropdownOpen(false);
    setCompanySearchResults([]);
    companyInputRef.current?.focus();
  };

  const submitInput = async () => {
    if (!opportunity.trim()) {
      setError("Please describe the business opportunity or challenge.");
      return;
    }
    setError(null);
    setIsLoading(true);
    if (companyName.trim()) setSecStatus("searching");

    try {
      const resp = await fetch(`${API}/assess/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, companyName, companyCik: selectedCompanyCik, industry, opportunity, voiceTranscript, documentText }),
      });
      const data = await resp.json() as { questions: string[]; sessionId: string };
      setQuestions(data.questions || []);
      setStep("questions");
    } catch {
      setError("Failed to reach the assessment service. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const pollSecStatus = useCallback(async () => {
    if (secStatus !== "searching") return;
    try {
      const resp = await fetch(`${API}/assess/${sessionId}`);
      const data = await resp.json() as { secData?: { status: string } };
      const status = data.secData?.status;
      if (status === "found") setSecStatus("found");
      else if (status === "not_found" || status === "error") setSecStatus("not_found");
    } catch {}
  }, [sessionId, secStatus]);

  useEffect(() => {
    if (secStatus !== "searching") return;
    const interval = setInterval(pollSecStatus, 2000);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setSecStatus("not_found");
    }, 20000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [secStatus, pollSecStatus]);

  const submitAnalysis = async () => {
    setStep("analyzing");
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API}/assess/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answers }),
      });
      const data = await resp.json() as { analysis: AnalysisResult };
      setAnalysis(data.analysis);
      setStep("results");
    } catch {
      setError("Analysis failed. Please try again.");
      setStep("questions");
    } finally {
      setIsLoading(false);
    }
  };

  const confidenceColor = (score: number) =>
    score >= 75 ? "text-primary" : score >= 55 ? "text-foreground" : "text-muted-foreground";

  const radarColors = {
    invest: "hsl(var(--primary))",
    hold: "hsl(var(--muted-foreground))",
    divest: "hsl(var(--destructive))",
    emerging: "hsl(var(--accent))",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b py-12 bg-muted/20">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-transparent bg-primary/10 text-primary mb-4">
            Powered by Claude · WEF Framework
          </div>
          <h1 className="text-4xl font-serif text-foreground mb-2">Capability Assessment</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Share your business opportunity via voice, document, or text. Claude will triangulate your capability landscape, surface gaps, and generate a prioritized investment roadmap.
          </p>
          {/* Step indicator */}
          <div className="flex items-center gap-3 mt-8">
            {["Input", "Questions", "Analysis"].map((label, i) => {
              const active = (step === "input" && i === 0) || (step === "questions" && i === 1) || ((step === "analyzing" || step === "results") && i === 2);
              const done = (i === 0 && step !== "input") || (i === 1 && (step === "analyzing" || step === "results"));
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${done ? "bg-primary text-primary-foreground border-primary" : active ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </div>
                  <span className={`text-sm font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                  {i < 2 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 max-w-4xl py-10">
        <AnimatePresence mode="wait">

          {/* ── STEP 1: INPUT ── */}
          {step === "input" && (
            <motion.div key="input" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="space-y-8">

              <div className="grid md:grid-cols-2 gap-6">
                {/* Company name search with SEC picklist */}
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1.5">
                    Company Name <span className="text-muted-foreground font-normal">(optional — enables SEC 10-K lookup)</span>
                  </label>
                  <div className="relative">
                    <div className={`flex items-center border bg-background ${selectedCompanyConfirmed ? "border-primary/40" : "border-input"}`}>
                      <Search className="w-4 h-4 text-muted-foreground ml-3 shrink-0" />
                      <input
                        ref={companyInputRef}
                        value={companyName}
                        onChange={e => handleCompanyInput(e.target.value)}
                        onFocus={() => { if (companySearchResults.length) setCompanyDropdownOpen(true); }}
                        onBlur={() => setTimeout(() => setCompanyDropdownOpen(false), 150)}
                        placeholder="Search public company name…"
                        className="w-full h-10 px-2 bg-transparent text-foreground text-sm focus:outline-none"
                      />
                      {companySearchLoading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin mr-2 shrink-0" />}
                      {selectedCompanyConfirmed && !companySearchLoading && (
                        <CheckCircle2 className="w-4 h-4 text-primary mr-2 shrink-0" />
                      )}
                      {companyName && (
                        <button onClick={clearCompany} className="mr-2 text-muted-foreground hover:text-foreground shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Dropdown picklist */}
                    <AnimatePresence>
                      {companyDropdownOpen && companySearchResults.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute z-50 top-full left-0 right-0 mt-1 border border-border bg-background shadow-lg overflow-hidden"
                        >
                          <div className="px-3 py-1.5 border-b border-border bg-muted/30 text-xs text-muted-foreground font-medium">
                            SEC EDGAR matches — select the correct company
                          </div>
                          {companySearchResults.map((result, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseDown={() => selectCompany(result)}
                              className="w-full text-left px-3 py-2.5 hover:bg-muted/50 border-b border-border/50 last:border-0 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="text-sm font-medium text-foreground">{result.entityName}</div>
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    {result.location && <span>{result.location} · </span>}
                                    <span>10-K filed {result.fileDate ? new Date(result.fileDate).toLocaleDateString("en-US", { year: "numeric", month: "short" }) : "—"}</span>
                                    {result.period && <span> · Period ending {new Date(result.period).toLocaleDateString("en-US", { year: "numeric", month: "short" })}</span>}
                                  </div>
                                </div>
                                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                              </div>
                            </button>
                          ))}
                          <div className="px-3 py-1.5 bg-muted/20 text-xs text-muted-foreground">
                            Not listed? Type their name — private companies are still assessed using provided context.
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {selectedCompanyConfirmed && (
                      <p className="text-xs text-primary mt-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Confirmed — will pull most recent 10-K filing
                      </p>
                    )}
                    {companyName && !selectedCompanyConfirmed && !companySearchLoading && !companyDropdownOpen && (
                      <p className="text-xs text-muted-foreground mt-1">Not matched to SEC — assessment will use provided context only.</p>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1.5">Industry</label>
                  <select
                    value={industry}
                    onChange={e => setIndustry(e.target.value)}
                    className="w-full h-10 px-3 border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Select industry…</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-1.5">
                  Business Opportunity or Transformation <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={opportunity}
                  onChange={e => setOpportunity(e.target.value)}
                  rows={5}
                  placeholder="Describe the initiative, opportunity, or challenge you're facing. Be specific: What are you trying to achieve? What constraints exist? What's at stake?"
                  className="w-full px-3 py-2.5 border border-input bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Voice recording */}
              <div className="border border-border p-6">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Voice Briefing</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Speak freely — more context means better accuracy. Hit Stop when finished.</p>
                  </div>
                  <button
                    type="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${isRecording ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                  >
                    {isRecording ? <><MicOff className="w-4 h-4" /> Stop Recording</> : <><Mic className="w-4 h-4" /> Start Recording</>}
                  </button>
                </div>
                {isRecording && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                    <span className="text-xs text-muted-foreground">Recording…</span>
                  </div>
                )}
                {voiceTranscript && (
                  <div className="bg-muted/40 p-3 text-sm text-foreground leading-relaxed max-h-32 overflow-y-auto border border-border">
                    {voiceTranscript}
                    <button onClick={() => { setVoiceTranscript(""); finalRef.current = ""; }} className="ml-2 text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3 inline" />
                    </button>
                  </div>
                )}
                {!voiceTranscript && !isRecording && (
                  <div className="text-xs text-muted-foreground italic">No transcript yet. Click Start Recording and speak.</div>
                )}
              </div>

              {/* Document upload */}
              <div>
                <label className="block text-sm font-semibold text-foreground mb-1.5">Upload Supporting Document <span className="text-muted-foreground font-normal">(TXT, MD, CSV — under 5MB)</span></label>
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => document.getElementById("file-input")?.click()}
                  className="border border-dashed border-border p-8 text-center cursor-pointer hover:bg-muted/20 transition-colors"
                >
                  {documentName ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-foreground">
                      <FileText className="w-4 h-4 text-primary" />
                      {documentName}
                      <button onClick={e => { e.stopPropagation(); setDocumentName(""); setDocumentText(""); }} className="text-muted-foreground hover:text-foreground ml-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      <Upload className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">Drag & drop or click to upload</p>
                      <p className="text-xs mt-1">Strategy docs, org charts, financial summaries</p>
                    </div>
                  )}
                  <input id="file-input" type="file" accept=".txt,.md,.csv,.json" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
                </div>
              </div>

              {error && <p className="text-sm text-destructive border border-destructive/20 bg-destructive/5 px-4 py-2">{error}</p>}

              <button
                onClick={submitInput}
                disabled={isLoading}
                className="inline-flex items-center gap-2 h-12 px-8 bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Getting clarifying questions…</> : <>Get Clarifying Questions <ArrowRight className="w-4 h-4" /></>}
              </button>
            </motion.div>
          )}

          {/* ── STEP 2: QUESTIONS ── */}
          {step === "questions" && (
            <motion.div key="questions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="space-y-8">

              {/* SEC status */}
              {companyName && (
                <div className={`flex items-center gap-3 p-4 border text-sm ${secStatus === "found" ? "border-primary/20 bg-primary/5" : secStatus === "not_found" ? "border-border bg-muted/30" : "border-border bg-muted/20"}`}>
                  <Building2 className="w-4 h-4 text-primary shrink-0" />
                  {secStatus === "searching" && <><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Searching SEC EDGAR for <strong>{companyName}</strong>…</span></>}
                  {secStatus === "found" && <span className="text-foreground"><strong>{companyName}</strong> found on SEC EDGAR — most recent 10-K will be incorporated into the analysis.</span>}
                  {secStatus === "not_found" && <span className="text-muted-foreground"><strong>{companyName}</strong> not found in SEC EDGAR (private company or search incomplete). Assessment will use provided context only.</span>}
                  {secStatus === "idle" && <span className="text-muted-foreground">No company name provided — assessment based on provided context.</span>}
                </div>
              )}

              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">Claude wants to know</div>
                <h2 className="text-2xl font-serif text-foreground mb-1">A few targeted questions</h2>
                <p className="text-muted-foreground text-sm">Your answers triangulate the assessment and sharpen the confidence score. Be direct.</p>
              </div>

              <div className="space-y-6">
                {questions.map((q, i) => (
                  <div key={i} className="border border-border p-5">
                    <label className="block text-sm font-semibold text-foreground mb-3">
                      <span className="text-primary mr-2">Q{i + 1}.</span>{q}
                    </label>
                    <textarea
                      value={answers[i] || ""}
                      onChange={e => {
                        const next = [...answers];
                        next[i] = e.target.value;
                        setAnswers(next);
                      }}
                      rows={3}
                      placeholder="Your answer…"
                      className="w-full px-3 py-2 border border-input bg-background text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                ))}
              </div>

              {error && <p className="text-sm text-destructive border border-destructive/20 bg-destructive/5 px-4 py-2">{error}</p>}

              <div className="flex gap-4">
                <button
                  onClick={() => setStep("input")}
                  className="inline-flex items-center gap-2 h-10 px-6 border border-input text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={submitAnalysis}
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 h-10 px-8 bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Generate Full Assessment <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: ANALYZING ── */}
          {step === "analyzing" && (
            <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-32 gap-6 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-primary/20 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-serif text-foreground mb-2">Running Capability Assessment</h2>
                <p className="text-muted-foreground text-sm max-w-sm">Claude is mapping capabilities, identifying gaps, and cross-referencing WEF frameworks{secStatus === "found" ? " and your 10-K filing" : ""}…</p>
              </div>
            </motion.div>
          )}

          {/* ── STEP 4: RESULTS ── */}
          {step === "results" && analysis && (
            <motion.div key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-10">

              {/* Executive Summary + Confidence */}
              <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 border border-border p-6">
                  <div className="text-xs font-bold uppercase tracking-wider text-primary mb-3">Executive Summary</div>
                  <p className="text-foreground text-base leading-relaxed font-serif">{analysis.executiveSummary}</p>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {companyName && <span className="text-xs border border-border px-2 py-0.5 text-muted-foreground">{companyName}</span>}
                    {industry && <span className="text-xs border border-border px-2 py-0.5 text-muted-foreground">{industry}</span>}
                    {analysis.confidenceFactors.secDataAvailable && <span className="text-xs border border-primary/20 bg-primary/5 text-primary px-2 py-0.5">SEC 10-K Incorporated</span>}
                    {analysis.confidenceFactors.voiceProvided && <span className="text-xs border border-border px-2 py-0.5 text-muted-foreground">Voice Briefing</span>}
                  </div>
                </div>
                <div className="border border-border p-6 flex flex-col items-center justify-center text-center">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Confidence Score</div>
                  <div className={`text-6xl font-serif font-medium mb-1 ${confidenceColor(analysis.confidenceScore)}`}>
                    {analysis.confidenceScore}
                  </div>
                  <div className="text-xs text-muted-foreground">out of 100</div>
                  <div className="mt-4 w-full bg-muted h-1.5">
                    <div className="h-full bg-primary transition-all" style={{ width: `${analysis.confidenceScore}%` }} />
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground space-y-1 text-left w-full">
                    {analysis.confidenceFactors.secDataAvailable && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> SEC 10-K data</div>}
                    {analysis.confidenceFactors.voiceProvided && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> Voice briefing</div>}
                    {analysis.confidenceFactors.documentProvided && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> Supporting document</div>}
                  </div>
                </div>
              </div>

              {/* Radar Chart */}
              {analysis.radarData?.length > 0 && (
                <div className="border border-border p-6">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-primary" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Capability Investment Radar</h3>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-semibold text-primary">WEF GCI 4.0 Aligned</div>
                      <div className="text-xs text-muted-foreground">Global Competitiveness Index 4.0 · Future of Jobs 2025</div>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-3 gap-6 items-start">
                    <div className="md:col-span-2">
                      <ResponsiveContainer width="100%" height={340}>
                        <RadarChart data={analysis.radarData}>
                          <PolarGrid stroke="hsl(var(--border))" />
                          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                          <Radar name="Invest" dataKey="invest" stroke={radarColors.invest} fill={radarColors.invest} fillOpacity={0.25} strokeWidth={2} />
                          <Radar name="Hold" dataKey="hold" stroke={radarColors.hold} fill={radarColors.hold} fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 2" />
                          <Radar name="Divest" dataKey="divest" stroke={radarColors.divest} fill={radarColors.divest} fillOpacity={0.1} strokeWidth={1} />
                          <Radar name="Emerging (3yr+)" dataKey="emerging" stroke={radarColors.emerging} fill={radarColors.emerging} fillOpacity={0.15} strokeWidth={1.5} strokeDasharray="2 2" />
                          <Legend iconSize={10} />
                          <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="space-y-5">
                      {/* Investment signal legend */}
                      <div className="space-y-2.5">
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Signal</div>
                        {[
                          { label: "Invest", color: "bg-primary", desc: "Increase resources now" },
                          { label: "Hold", color: "bg-muted-foreground", desc: "Maintain current level" },
                          { label: "Divest", color: "bg-destructive", desc: "Reduce or exit" },
                          { label: "Emerging (3yr+)", color: "bg-accent", desc: "Watch & prepare" },
                        ].map(({ label, color, desc }) => (
                          <div key={label} className="flex items-start gap-2">
                            <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${color} opacity-80`} />
                            <div>
                              <div className="text-xs font-semibold text-foreground">{label}</div>
                              <div className="text-xs text-muted-foreground">{desc}</div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* WEF axis source mapping */}
                      <div className="border-t border-border pt-4 space-y-1.5">
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Axis Framework Source</div>
                        {[
                          { axis: "ICT Adoption", ref: "GCI 4.0 Pillar 3" },
                          { axis: "Talent & Skills", ref: "GCI 4.0 Pillar 6 · HCI" },
                          { axis: "Business Dynamism", ref: "GCI 4.0 Pillar 11" },
                          { axis: "Innovation Capability", ref: "GCI 4.0 Pillar 12" },
                          { axis: "Market Agility", ref: "GCI 4.0 Pillars 7-8" },
                          { axis: "Financial System", ref: "GCI 4.0 Pillar 9" },
                          { axis: "Institutional Resilience", ref: "GCI 4.0 Pillar 1" },
                        ].map(({ axis, ref }) => (
                          <div key={axis} className="flex items-baseline justify-between gap-1 text-xs">
                            <span className="text-foreground font-medium shrink-0">{axis}</span>
                            <span className="text-muted-foreground text-right italic">{ref}</span>
                          </div>
                        ))}
                        <div className="pt-2 text-xs text-muted-foreground border-t border-border/50 mt-2">
                          World Economic Forum Global Competitiveness Index 4.0 · Human Capital Index · Future of Jobs Report 2025
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Capability Map */}
              {analysis.capabilityMap?.length > 0 && (
                <div className="border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Capability Map</h3>
                    <span className="ml-auto text-xs text-muted-foreground">Aligned to WEF GCI 4.0 & Future of Jobs</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/10">
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Capability</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">WEF Alignment</th>
                          <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Maturity</th>
                          <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Importance</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Action</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Horizon</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.capabilityMap.map((cap, i) => (
                          <tr key={i} className={`border-b border-border hover:bg-muted/20 transition-colors ${cap.gap && cap.gapSeverity === "CRITICAL" ? "bg-destructive/5" : ""}`}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-foreground">{cap.capability}</div>
                              <div className="text-xs text-muted-foreground">{cap.category}</div>
                              {cap.gap && cap.gapSeverity && (
                                <div className={`inline-flex items-center gap-1 mt-1 text-xs px-1.5 py-0.5 border ${cap.gapSeverity === "CRITICAL" ? "border-destructive/30 text-destructive bg-destructive/5" : cap.gapSeverity === "MODERATE" ? "border-primary/20 text-primary bg-primary/5" : "border-border text-muted-foreground"}`}>
                                  <AlertTriangle className="w-3 h-3" /> Gap: {cap.gapSeverity}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <span className="text-xs text-muted-foreground italic leading-relaxed">{cap.wefAlignment}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex justify-center gap-0.5">
                                {Array.from({ length: 5 }).map((_, j) => (
                                  <span key={j} className={`w-3 h-3 rounded-sm ${j < cap.currentMaturity ? "bg-primary" : "bg-muted"}`} />
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex justify-center gap-0.5">
                                {Array.from({ length: 5 }).map((_, j) => (
                                  <span key={j} className={`w-3 h-3 rounded-sm ${j < cap.strategicImportance ? "bg-foreground/60" : "bg-muted"}`} />
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-0.5 ${actionBadge[cap.action] || ""}`}>{cap.action}</span>
                            </td>
                            <td className="px-4 py-3 hidden lg:table-cell">
                              <span className="text-xs text-muted-foreground">{cap.timeHorizon}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Gaps & Exposure */}
              {analysis.gaps?.length > 0 && (
                <div className="border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-destructive" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Capability Gaps & Exposure</h3>
                  </div>
                  <div className="divide-y divide-border">
                    {analysis.gaps.map((gap, i) => (
                      <div key={i} className="px-6 py-5 grid md:grid-cols-3 gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-bold px-1.5 py-0.5 border ${urgencyBadge[gap.urgency] || ""}`}>{gap.urgency.replace("_", " ")}</span>
                          </div>
                          <div className="text-sm font-semibold text-foreground">{gap.capability}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Exposure</div>
                          <p className="text-sm text-foreground leading-relaxed">{gap.exposure}</p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">Recommendation</div>
                          <p className="text-sm text-foreground leading-relaxed">{gap.recommendation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Recommendations */}
              {analysis.topRecommendations?.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Lightbulb className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Near-Term Recommendations</h3>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    {analysis.topRecommendations.map((rec, i) => (
                      <div key={i} className="border border-border p-5 hover:bg-muted/20 transition-colors">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 border border-primary/20">#{i + 1}</span>
                        </div>
                        <h4 className="text-sm font-semibold text-foreground mb-2">{rec.title}</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-3">{rec.rationale}</p>
                        <div className="border-t border-border pt-3 space-y-1.5">
                          <div className="text-xs text-foreground"><span className="text-muted-foreground">Expected impact: </span>{rec.impact}</div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground italic">
                            <ExternalLink className="w-3 h-3" /> {rec.wefReference}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SEC Insights */}
              {analysis.secInsights && (
                <div className="border border-primary/20 bg-primary/5 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">SEC 10-K Capability Insights</h3>
                    <span className="text-xs text-muted-foreground ml-auto">Most recent annual filing</span>
                  </div>
                  <p className="text-foreground text-sm leading-relaxed mb-4 font-serif">{analysis.secInsights.summary}</p>
                  {analysis.secInsights.capabilityImplications?.length > 0 && (
                    <ul className="space-y-2">
                      {analysis.secInsights.capabilityImplications.map((imp, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                          <ChevronRight className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          {imp}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Restart */}
              <div className="border-t border-border pt-8">
                <button
                  onClick={() => {
                    setStep("input");
                    setAnalysis(null);
                    setQuestions([]);
                    setAnswers(["", "", ""]);
                    setSecStatus("idle");
                    setVoiceTranscript("");
                    setDocumentText("");
                    setDocumentName("");
                  }}
                  className="inline-flex items-center gap-2 h-10 px-6 border border-input text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Run New Assessment
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
