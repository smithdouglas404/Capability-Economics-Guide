import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Upload, X, FileText, ArrowRight, ChevronRight,
  Building2, Loader2, CheckCircle2, AlertTriangle, TrendingUp,
  Lightbulb, ExternalLink, BarChart3, BookOpen, Search, Download,
  Share2, Copy, Check, Zap, Users, Map, Clock, ChevronDown, ChevronUp,
  Plus, Trash2, History, ArrowUpRight, Target, HelpCircle
} from "lucide-react";
import {
  Tooltip as RadixTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Radar, Legend, ResponsiveContainer, Tooltip
} from "recharts";
import { SynthesisBriefCard } from "@/components/synthesis-brief-card";

/**
 * Rough live "CVI delta" estimate for the active question phase.
 *
 * We do NOT call the LLM on every keystroke — instead this is a cheap
 * heuristic computed in the browser so the user gets immediate signal as
 * they answer. The actual delta is recomputed server-side during /analyze.
 *
 * The shape of the heuristic:
 *   - Each answer is scored 0..1 on richness (length, specifics, numbers).
 *   - Direction (positive vs negative confidence-affecting) is inferred
 *     from positive/negative keyword presence.
 *   - Delta band is +/- 6 CVI points scaled by total richness across all
 *     answered questions, biased by sentiment.
 */
function estimateCviDelta(answers: string[]): { delta: number; direction: "up" | "down" | "flat"; rationale: string } {
  if (!answers.length) return { delta: 0, direction: "flat", rationale: "Answer the first question to preview the delta." };
  const text = answers.join(" ").toLowerCase();
  const filled = answers.filter(a => a.trim().length > 0).length;
  if (filled === 0) return { delta: 0, direction: "flat", rationale: "No answers yet — preview will populate as you type." };

  const charLen = text.length;
  // 0..1 ceiling at ~600 chars total — diminishing returns after that
  const richness = Math.min(1, charLen / 600);
  // Bonus for specifics: numbers, percentages, dollar amounts
  const hasNumbers = /\$|%|\b\d{2,}\b/.test(text) ? 0.15 : 0;
  // Bonus for differentiators
  const specificityWords = ["because", "specifically", "measured", "kpi", "metric", "we have", "we don't", "we are"];
  const specificityHits = specificityWords.filter(w => text.includes(w)).length;
  const specificityBonus = Math.min(0.2, specificityHits * 0.04);

  // Sentiment lean for direction
  const posWords = ["strong", "leading", "ahead", "scale", "advantage", "competitive", "ready", "mature", "robust"];
  const negWords = ["gap", "behind", "lagging", "weak", "missing", "blocker", "stalled", "fragile", "limited", "tail risk", "fail"];
  const posHits = posWords.filter(w => text.includes(w)).length;
  const negHits = negWords.filter(w => text.includes(w)).length;
  const sentiment = posHits - negHits; // negative means we're flagging risks

  const magnitudeBase = (richness + hasNumbers + specificityBonus) * 6; // up to ~7.5
  const signedDelta = sentiment >= 0
    ? Math.round(magnitudeBase * 0.6 * 10) / 10 // optimistic answers nudge confidence higher
    : Math.round(-magnitudeBase * 0.6 * 10) / 10;

  const direction: "up" | "down" | "flat" =
    Math.abs(signedDelta) < 0.5 ? "flat" : signedDelta > 0 ? "up" : "down";

  const rationaleBits: string[] = [];
  rationaleBits.push(`${filled} answer${filled === 1 ? "" : "s"}`);
  if (hasNumbers) rationaleBits.push("includes specifics");
  if (specificityHits > 0) rationaleBits.push(`${specificityHits} differentiator${specificityHits === 1 ? "" : "s"}`);
  if (sentiment < 0) rationaleBits.push("flagged risks");
  else if (sentiment > 0) rationaleBits.push("positive lean");

  return {
    delta: signedDelta,
    direction,
    rationale: rationaleBits.join(" · "),
  };
}

interface SecCompanyResult {
  entityName: string;
  ticker: string;
  cik: string;
  fileDate: string;
  period: string;
  location: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface IndustryOption {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  capabilityCount: number;
}

interface ResearchSource {
  id: number;
  title: string | null;
  url: string | null;
  publisher: string | null;
  publishedDate: string | null;
}

interface CompetitorEntry {
  name: string;
  cik: string;
  confirmed: boolean;
}

type Step = "input" | "questions" | "analyzing" | "results";
type ResultTab = "overview" | "roadmap" | "competitors";

interface CapabilityMapItem {
  capability: string;
  category: string;
  wefAlignment: string;
  wefSubIndicators?: string[];
  currentMaturity: number;
  strategicImportance: number;
  action: "INVEST" | "HOLD" | "DIVEST" | "EMERGING";
  timeHorizon: "NOW" | "12-24M" | "3YR+";
  gap: boolean;
  gapSeverity: "CRITICAL" | "MODERATE" | "LOW" | null;
  peerBenchmark?: number;
}

interface GapItem {
  capability: string;
  exposure: string;
  recommendation: string;
  urgency: "IMMEDIATE" | "NEAR_TERM" | "WATCH";
  competitorAdvantage?: string | null;
}

interface RadarDataPoint {
  axis: string;
  invest: number;
  hold: number;
  divest: number;
  emerging: number;
  peerAverage?: number;
}

interface Recommendation {
  title: string;
  rationale: string;
  impact: string;
  wefReference: string;
}

interface RoadmapInitiative {
  title: string;
  description: string;
  capability: string;
  effort: "LOW" | "MEDIUM" | "HIGH";
  impact: "LOW" | "MEDIUM" | "HIGH";
  owner: string;
  wefLink: string;
}

interface RoadmapPhase {
  label: string;
  months: string;
  theme: string;
  initiatives: RoadmapInitiative[];
}

interface Roadmap {
  horizon: string;
  phases: RoadmapPhase[];
}

interface CompetitorRadarEntry {
  name: string;
  radarData: Array<{ axis: string; score: number }>;
}

interface AnalysisResult {
  executiveSummary: string;
  capabilityMap: CapabilityMapItem[];
  gaps: GapItem[];
  radarData: RadarDataPoint[];
  competitorRadarData?: CompetitorRadarEntry[] | null;
  topRecommendations: Recommendation[];
  roadmap?: Roadmap | null;
  secInsights: {
    summary: string;
    capabilityImplications: string[];
    rdSpendSignal?: string;
    riskCapabilityLinks?: string[];
  } | null;
  jobPostingInsights?: {
    capabilitySignals: string[];
    gapIndicators: string[];
    strategicIntent: string;
  } | null;
  confidenceScore: number;
  confidenceFactors: {
    inputRichness: number;
    industryDataQuality: number;
    secDataAvailable: boolean;
    competitorDataAvailable?: boolean;
    voiceProvided: boolean;
    documentProvided: boolean;
    jobPostingProvided?: boolean;
  };
}

interface AssessmentHistoryItem {
  sessionId: string;
  shareToken: string | null;
  companyName: string | null;
  industry: string | null;
  opportunity: string | null;
  confidenceScore: number | null;
  status: string;
  createdAt: string;
}

interface PeerPercentilesRow {
  capabilityId: number;
  capabilityName: string;
  n: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  myScore: number | null;
  myPercentileBand: "bottom" | "below_median" | "above_median" | "top" | "unknown";
}

interface PeerPercentilesResp {
  cohort: { industryId: number | null; geography: string | null; revenueBand: string | null };
  cohortContributorCount: number;
  cohortEligible: boolean;
  minK: number;
  rows: PeerPercentilesRow[];
  organizationId: number;
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

const effortColor: Record<string, string> = {
  LOW: "text-primary",
  MEDIUM: "text-foreground",
  HIGH: "text-destructive",
};

const PROGRESS_STEPS = [
  "Retrieving SEC EDGAR filings…",
  "Pulling WEF GCI 4.0 framework benchmarks…",
  "Mapping capabilities to WEF pillars…",
  "Scoring capability maturity vs. industry peers…",
  "Identifying critical gaps and exposures…",
  "Generating 12-month capability roadmap…",
  "Cross-referencing competitor intelligence…",
  "Calibrating confidence score…",
  "Structuring investment recommendations…",
  "Finalizing assessment report…",
];

const COMPETITOR_COLORS = [
  "hsl(var(--destructive))",
  "hsl(215 100% 55%)",
  "hsl(38 92% 50%)",
];

export default function Assess() {
  const [step, setStep] = useState<Step>("input");
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [orgSessionToken] = useState<string | null>(() => localStorage.getItem("ce_session_token"));
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [documentText, setDocumentText] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [jobPostingText, setJobPostingText] = useState("");
  const [showJobPosting, setShowJobPosting] = useState(false);
  const [quickAssess, setQuickAssess] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([{ name: "", cik: "", confirmed: false }]);
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [secStatus, setSecStatus] = useState<"idle" | "searching" | "found" | "not_found">("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("overview");
  const [progressStep, setProgressStep] = useState(0);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPeerOverlay, setShowPeerOverlay] = useState(true);
  const [history, setHistory] = useState<AssessmentHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [industryOptions, setIndustryOptions] = useState<IndustryOption[]>([]);
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);
  const [peerPercentiles, setPeerPercentiles] = useState<PeerPercentilesResp | null>(null);
  const [peerLoading, setPeerLoading] = useState(false);
  const [peerError, setPeerError] = useState<string | null>(null);

  const [companySearchResults, setCompanySearchResults] = useState<SecCompanyResult[]>([]);
  const [companySearchLoading, setCompanySearchLoading] = useState(false);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [selectedCompanyCik, setSelectedCompanyCik] = useState("");
  const [selectedCompanyConfirmed, setSelectedCompanyConfirmed] = useState(false);
  const [allowManualCompany, setAllowManualCompany] = useState(false);
  const companySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);

  const [competitorSearchResults, setCompetitorSearchResults] = useState<Record<number, SecCompanyResult[]>>({});
  const [competitorSearchLoading, setCompetitorSearchLoading] = useState<Record<number, boolean>>({});
  const [competitorDropdownOpen, setCompetitorDropdownOpen] = useState<Record<number, boolean>>({});
  const competitorSearchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const companyAbortCtrl = useRef<AbortController | null>(null);
  const competitorAbortCtrls = useRef<Record<number, AbortController>>({});
  const companyContainerRef = useRef<HTMLDivElement>(null);
  const competitorContainerRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (companyContainerRef.current && !companyContainerRef.current.contains(e.target as Node)) {
        setCompanyDropdownOpen(false);
      }
      Object.entries(competitorContainerRefs.current).forEach(([idx, el]) => {
        if (el && !el.contains(e.target as Node)) {
          setCompetitorDropdownOpen(prev => ({ ...prev, [Number(idx)]: false }));
        }
      });
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const refreshHistory = useCallback(() => {
    if (!orgSessionToken) return;
    fetch(`${API}/assess?orgToken=${encodeURIComponent(orgSessionToken)}`)
      .then(r => r.json())
      .then((data: AssessmentHistoryItem[]) => { if (Array.isArray(data)) setHistory(data); })
      .catch(() => {});
  }, [orgSessionToken]);

  useEffect(() => {
    fetch(`${API}/industries`)
      .then(r => r.json())
      .then((data: IndustryOption[]) => { if (Array.isArray(data)) setIndustryOptions(data); })
      .catch(() => {});
    refreshHistory();
  }, [refreshHistory]);

  // Pull peer-cohort percentiles once an analysis exists. This requires an
  // org session token (only contributor orgs can see real cohort data).
  // Quietly degrade if missing — the comparison strip then renders an
  // explanatory placeholder rather than disappearing.
  useEffect(() => {
    if (step !== "results" || !analysis) return;
    if (!orgSessionToken) { setPeerError("no_session"); return; }
    let cancelled = false;
    setPeerLoading(true);
    setPeerError(null);
    fetch(`${API}/peer-coop/percentiles?sessionToken=${encodeURIComponent(orgSessionToken)}`)
      .then(async r => {
        if (r.status === 403 || r.status === 401) { throw new Error("not_contributor"); }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: PeerPercentilesResp) => { if (!cancelled) setPeerPercentiles(data); })
      .catch(err => { if (!cancelled) setPeerError(err instanceof Error ? err.message : "fetch_failed"); })
      .finally(() => { if (!cancelled) setPeerLoading(false); });
    return () => { cancelled = true; };
  }, [step, analysis, orgSessionToken]);

  const recognitionRef = useRef<unknown>(null);
  const interimRef = useRef<string>("");
  const finalRef = useRef<string>("");

  const [activeQVoice, setActiveQVoice] = useState<number | null>(null);
  const [qVoiceInterim, setQVoiceInterim] = useState("");
  const qVoiceRecRef = useRef<unknown>(null);
  const qVoiceFinalRef = useRef<string>("");
  const qVoiceIdxRef = useRef<number>(-1);

  const [isRecordingOppty, setIsRecordingOppty] = useState(false);
  const [opptyInterim, setOpptyInterim] = useState("");
  const opptyRecRef = useRef<unknown>(null);
  const opptyFinalRef = useRef<string>("");

  const startRecording = useCallback(() => {
    const w = window as unknown as Record<string, unknown>;
    const SRClass = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => unknown) | undefined;
    if (!SRClass) {
      alert("Voice recording requires Chrome or Edge.");
      return;
    }
    const rec = new SRClass() as {
      continuous: boolean; interimResults: boolean; lang: string;
      onresult: (e: unknown) => void; onerror: () => void; onend: () => void;
      start: () => void;
    };
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    finalRef.current = voiceTranscript;
    rec.onresult = (e: unknown) => {
      const event = e as { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> };
      let interim = "";
      let finalParts = finalRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalParts += result[0].transcript + " ";
        else interim += result[0].transcript;
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
    (recognitionRef.current as { stop?: () => void } | null)?.stop?.();
    setIsRecording(false);
  }, []);

  const startQVoice = useCallback((idx: number) => {
    const w = window as unknown as Record<string, unknown>;
    const SRClass = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => unknown) | undefined;
    if (!SRClass) { alert("Voice input requires Chrome or Edge."); return; }
    (qVoiceRecRef.current as { stop?: () => void } | null)?.stop?.();
    const rec = new SRClass() as {
      continuous: boolean; interimResults: boolean; lang: string;
      onresult: (e: unknown) => void; onerror: () => void; onend: () => void;
      start: () => void;
    };
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    qVoiceIdxRef.current = idx;
    qVoiceFinalRef.current = answers[idx] ? answers[idx].trimEnd() + " " : "";
    setQVoiceInterim("");
    rec.onresult = (e: unknown) => {
      const event = e as { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> };
      let interim = "";
      let finalParts = qVoiceFinalRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalParts += result[0].transcript + " ";
        else interim += result[0].transcript;
      }
      qVoiceFinalRef.current = finalParts;
      setQVoiceInterim(interim);
      setAnswers(prev => { const next = [...prev]; next[qVoiceIdxRef.current] = finalParts + interim; return next; });
    };
    rec.onerror = () => { setActiveQVoice(null); setQVoiceInterim(""); };
    rec.onend = () => {
      setAnswers(prev => { const next = [...prev]; next[qVoiceIdxRef.current] = qVoiceFinalRef.current.trim(); return next; });
      setActiveQVoice(null);
      setQVoiceInterim("");
    };
    qVoiceRecRef.current = rec;
    rec.start();
    setActiveQVoice(idx);
  }, [answers]);

  const stopQVoice = useCallback(() => {
    (qVoiceRecRef.current as { stop?: () => void } | null)?.stop?.();
    setActiveQVoice(null);
    setQVoiceInterim("");
  }, []);

  const startOpptyRecording = useCallback(() => {
    const w = window as unknown as Record<string, unknown>;
    const SRClass = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => unknown) | undefined;
    if (!SRClass) { alert("Voice input requires Chrome or Edge."); return; }
    (opptyRecRef.current as { stop?: () => void } | null)?.stop?.();
    const rec = new SRClass() as {
      continuous: boolean; interimResults: boolean; lang: string;
      onresult: (e: unknown) => void; onerror: () => void; onend: () => void;
      start: () => void;
    };
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    opptyFinalRef.current = opportunity ? opportunity.trimEnd() + " " : "";
    setOpptyInterim("");
    rec.onresult = (e: unknown) => {
      const event = e as { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> };
      let interim = "";
      let finalParts = opptyFinalRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalParts += result[0].transcript + " ";
        else interim += result[0].transcript;
      }
      opptyFinalRef.current = finalParts;
      setOpptyInterim(interim);
      setOpportunity(finalParts + interim);
    };
    rec.onerror = () => { setIsRecordingOppty(false); setOpptyInterim(""); };
    rec.onend = () => {
      setOpportunity(opptyFinalRef.current.trim());
      setIsRecordingOppty(false);
      setOpptyInterim("");
    };
    opptyRecRef.current = rec;
    rec.start();
    setIsRecordingOppty(true);
  }, [opportunity]);

  const stopOpptyRecording = useCallback(() => {
    (opptyRecRef.current as { stop?: () => void } | null)?.stop?.();
    setIsRecordingOppty(false);
    setOpptyInterim("");
  }, []);

  const handleFileUpload = (file: File) => {
    if (file.size > 5 * 1024 * 1024) { setError("File must be under 5MB."); return; }
    setDocumentName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setDocumentText((e.target?.result as string).slice(0, 12000));
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
    setAllowManualCompany(false);
    if (companySearchTimer.current) clearTimeout(companySearchTimer.current);
    if (value.trim().length < 2) {
      setCompanySearchResults([]);
      setCompanyDropdownOpen(false);
      return;
    }
    companySearchTimer.current = setTimeout(async () => {
      if (companyAbortCtrl.current) companyAbortCtrl.current.abort();
      companyAbortCtrl.current = new AbortController();
      setCompanySearchLoading(true);
      try {
        const resp = await fetch(`${API}/sec/search?q=${encodeURIComponent(value)}`, { signal: companyAbortCtrl.current.signal });
        const data = await resp.json() as { results: SecCompanyResult[]; allowManual?: boolean };
        if (data.results?.length) { setCompanySearchResults(data.results); setCompanyDropdownOpen(true); setAllowManualCompany(false); }
        else { setCompanySearchResults([]); setCompanyDropdownOpen(true); setAllowManualCompany(!!data.allowManual); }
      } catch (err) {
        if ((err as Error).name !== "AbortError") { setCompanySearchResults([]); setCompanyDropdownOpen(false); }
      } finally { setCompanySearchLoading(false); }
    }, 300);
  };

  const useCompanyManually = () => {
    setSelectedCompanyCik("");
    setSelectedCompanyConfirmed(true);
    setCompanyDropdownOpen(false);
    setCompanySearchResults([]);
    setAllowManualCompany(false);
  };

  const selectCompany = (result: SecCompanyResult) => {
    setCompanyName(result.entityName);
    setSelectedCompanyCik(result.cik);
    setSelectedCompanyConfirmed(true);
    setCompanyDropdownOpen(false);
    setCompanySearchResults([]);
  };

  const clearCompany = () => {
    setCompanyName(""); setSelectedCompanyCik(""); setSelectedCompanyConfirmed(false);
    setCompanyDropdownOpen(false); setCompanySearchResults([]);
    companyInputRef.current?.focus();
  };

  const handleCompetitorInput = (idx: number, value: string) => {
    const next = [...competitors];
    next[idx] = { name: value, cik: "", confirmed: false };
    setCompetitors(next);
    if (competitorSearchTimers.current[idx]) clearTimeout(competitorSearchTimers.current[idx]);
    if (value.trim().length < 2) {
      setCompetitorSearchResults(prev => ({ ...prev, [idx]: [] }));
      setCompetitorDropdownOpen(prev => ({ ...prev, [idx]: false }));
      return;
    }
    competitorSearchTimers.current[idx] = setTimeout(async () => {
      if (competitorAbortCtrls.current[idx]) competitorAbortCtrls.current[idx].abort();
      competitorAbortCtrls.current[idx] = new AbortController();
      setCompetitorSearchLoading(prev => ({ ...prev, [idx]: true }));
      try {
        const resp = await fetch(`${API}/sec/search?q=${encodeURIComponent(value)}`, { signal: competitorAbortCtrls.current[idx].signal });
        const data = await resp.json() as { results: SecCompanyResult[] };
        if (data.results?.length) {
          setCompetitorSearchResults(prev => ({ ...prev, [idx]: data.results }));
          setCompetitorDropdownOpen(prev => ({ ...prev, [idx]: true }));
        } else {
          setCompetitorSearchResults(prev => ({ ...prev, [idx]: [] }));
          setCompetitorDropdownOpen(prev => ({ ...prev, [idx]: false }));
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setCompetitorSearchResults(prev => ({ ...prev, [idx]: [] }));
      } finally { setCompetitorSearchLoading(prev => ({ ...prev, [idx]: false })); }
    }, 300);
  };

  const selectCompetitor = (idx: number, result: SecCompanyResult) => {
    const next = [...competitors];
    next[idx] = { name: result.entityName, cik: result.cik, confirmed: true };
    setCompetitors(next);
    setCompetitorDropdownOpen(prev => ({ ...prev, [idx]: false }));
    setCompetitorSearchResults(prev => ({ ...prev, [idx]: [] }));
  };

  const addCompetitor = () => {
    if (competitors.length >= 3) return;
    setCompetitors([...competitors, { name: "", cik: "", confirmed: false }]);
  };

  const removeCompetitor = (idx: number) => {
    setCompetitors(competitors.filter((_, i) => i !== idx));
  };

  const submitInput = async () => {
    if (!opportunity.trim()) { setError("Please describe the business opportunity or challenge."); return; }
    setError(null);
    setIsLoading(true);
    if (companyName.trim()) setSecStatus("searching");

    const validCompetitors = competitors.filter(c => c.name.trim()).map(c => ({ name: c.name, cik: c.cik || undefined }));

    try {
      const resp = await fetch(`${API}/assess/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, companyName, companyCik: selectedCompanyCik, industry, opportunity,
          voiceTranscript, documentText, jobPostingText: showJobPosting ? jobPostingText : "",
          competitors: validCompetitors, quickAssess,
          organizationSessionToken: orgSessionToken || undefined,
        }),
      });
      const data = await resp.json() as { questions: string[]; sessionId: string; quickAssess?: boolean };
      if (quickAssess || !data.questions?.length) {
        setStep("analyzing");
        await runAnalysis([]);
      } else {
        setQuestions(data.questions || []);
        setStep("questions");
      }
    } catch {
      setError("Failed to reach the assessment service. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadAssessmentForEdit = useCallback((h: AssessmentHistoryItem) => {
    setSessionId(h.sessionId);
    setCompanyName(h.companyName || "");
    setIndustry(h.industry || "");
    setOpportunity(h.opportunity || "");
    setSelectedCompanyCik("");
    setSelectedCompanyConfirmed(!!h.companyName);
    setVoiceTranscript("");
    setDocumentText("");
    setDocumentName("");
    setJobPostingText("");
    setShowJobPosting(false);
    setCompetitors([{ name: "", cik: "", confirmed: false }]);
    setQuestions([]);
    setAnswers(["", "", ""]);
    setAnalysis(null);
    setRoadmap(null);
    setShareToken(null);
    setSecStatus("idle");
    setError(null);
    setStep("input");
    setShowHistory(false);
  }, []);

  const pollSecStatus = useCallback(async () => {
    if (secStatus !== "searching") return;
    try {
      const resp = await fetch(`${API}/assess/${sessionId}`);
      const data = await resp.json() as { secData?: { status: string } };
      const s = data.secData?.status;
      if (s === "found") setSecStatus("found");
      else if (s === "not_found" || s === "error") setSecStatus("not_found");
    } catch {}
  }, [sessionId, secStatus]);

  useEffect(() => {
    if (secStatus !== "searching") return;
    const interval = setInterval(pollSecStatus, 2000);
    const timeout = setTimeout(() => { clearInterval(interval); setSecStatus("not_found"); }, 20000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [secStatus, pollSecStatus]);

  const runAnalysis = async (answerList: string[]) => {
    setStep("analyzing");
    setIsLoading(true);
    setError(null);
    setProgressStep(0);

    const progressInterval = setInterval(() => {
      setProgressStep(prev => {
        if (prev < PROGRESS_STEPS.length - 1) return prev + 1;
        clearInterval(progressInterval);
        return prev;
      });
    }, 1800);

    try {
      const resp = await fetch(`${API}/assess/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, answers: answerList }),
      });
      const data = await resp.json() as { analysis: AnalysisResult; roadmap?: Roadmap };
      clearInterval(progressInterval);
      setProgressStep(PROGRESS_STEPS.length - 1);
      setAnalysis(data.analysis);
      setRoadmap(data.roadmap || data.analysis?.roadmap || null);
      setStep("results");
      refreshHistory();
      fetch(`${API}/data-sources`)
        .then(r => r.json())
        .then((sources: ResearchSource[]) => { if (Array.isArray(sources)) setResearchSources(sources.slice(0, 8)); })
        .catch(() => {});
    } catch {
      clearInterval(progressInterval);
      setError("Analysis failed. Please try again.");
      setStep("questions");
    } finally {
      setIsLoading(false);
    }
  };

  const submitAnalysis = () => runAnalysis(answers);

  const generateShareLink = async () => {
    if (shareToken) { await copyShareLink(shareToken); return; }
    try {
      const resp = await fetch(`${API}/assess/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await resp.json() as { shareToken: string };
      setShareToken(data.shareToken);
      await copyShareLink(data.shareToken);
    } catch { console.error("Failed to generate share link"); }
  };

  const copyShareLink = async (token: string) => {
    const url = `${window.location.origin}${BASE}/assess/share/${token}`;
    try { await navigator.clipboard.writeText(url); } catch { }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAssessment = () => {
    if (!analysis) return;
    const payload = {
      metadata: {
        generatedAt: new Date().toISOString(),
        company: companyName || "Undisclosed",
        industry: industry || "General",
        confidenceScore: analysis.confidenceScore,
        framework: "WEF Global Competitiveness Index 4.0 / Future of Jobs Report 2025",
      },
      sources: {
        "WEF GCI 4.0 Report": "https://www.weforum.org/publications/the-global-competitiveness-report-2019/",
        "WEF Future of Jobs 2025": "https://www.weforum.org/publications/the-future-of-jobs-report-2025/",
        "WEF Human Capital Index": "https://www.weforum.org/reports/global-human-capital-report-2017/",
      },
      executiveSummary: analysis.executiveSummary,
      radarData: analysis.radarData ?? [],
      capabilityMap: analysis.capabilityMap,
      gaps: analysis.gaps,
      topRecommendations: analysis.topRecommendations,
      roadmap: roadmap || analysis.roadmap || null,
      ...(analysis.secInsights ? { secInsights: analysis.secInsights } : {}),
      ...(analysis.jobPostingInsights ? { jobPostingInsights: analysis.jobPostingInsights } : {}),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (companyName || "assessment").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    a.download = `capability-assessment-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const printAssessment = () => {
    window.print();
  };

  const confidenceColor = (score: number) =>
    score >= 75 ? "text-primary" : score >= 55 ? "text-foreground" : "text-muted-foreground";

  const radarColors = {
    invest: "hsl(var(--primary))",
    hold: "hsl(var(--muted-foreground))",
    divest: "hsl(var(--destructive))",
    emerging: "hsl(var(--accent))",
    peer: "hsl(215 80% 60%)",
  };

  const wefAxisSources: Record<string, string> = {
    "ICT Adoption": "WEF GCI 4.0 Pillar 3",
    "Talent & Skills": "WEF GCI 4.0 Pillar 6 · HCI",
    "Business Dynamism": "WEF GCI 4.0 Pillar 11",
    "Innovation Capability": "WEF GCI 4.0 Pillar 12",
    "Market Agility": "WEF GCI 4.0 Pillars 7-8",
    "Financial System": "WEF GCI 4.0 Pillar 9",
    "Institutional Resilience": "WEF GCI 4.0 Pillar 1",
  };

  const activeCompetitors = (analysis?.competitorRadarData || []).filter(c => c.radarData?.length > 0);

  const buildCompetitorRadarData = () => {
    if (!analysis?.radarData) return [];
    return analysis.radarData.map(d => {
      const entry: Record<string, unknown> = { axis: d.axis, invest: d.invest };
      if (showPeerOverlay && d.peerAverage !== undefined) entry.peerAverage = d.peerAverage;
      activeCompetitors.forEach((comp, i) => {
        const point = comp.radarData.find(r => r.axis === d.axis);
        entry[`comp_${i}`] = point?.score ?? 50;
      });
      return entry;
    });
  };

  return (
    <>
      <style>{`
        @media print {
          nav, header .step-indicator, .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          body { font-size: 12px; }
        }
      `}</style>

      <div className="min-h-screen bg-background">
        <section className="border-b border-border/40 py-12 bg-muted/10 no-print">
          <div className="container mx-auto px-4 max-w-4xl">
            <div className="flex items-center justify-between mb-4">
              <div className="inline-flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Powered by Claude · WEF Framework · Letta Memory</span>
              </div>
              <div className="flex items-center gap-3">
                {!orgSessionToken && (
                  <span className="text-sm text-muted-foreground italic">
                    Set up your org profile to save assessments
                  </span>
                )}
                {orgSessionToken && history.length > 0 && (
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <History className="w-3.5 h-3.5" />
                    {showHistory ? "Hide" : `My assessments (${history.length})`}
                  </button>
                )}
              </div>
            </div>

            <h1 className="text-4xl font-serif tracking-tight text-foreground mb-2">Capability Assessment</h1>
            <p className="text-foreground/60 font-serif italic text-lg max-w-2xl">
              Share your business opportunity via voice, document, or text. Claude will triangulate your capability landscape, surface gaps, and generate a prioritized 12-month investment roadmap.
            </p>

            <AnimatePresence>
              {showHistory && history.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="mt-4 border border-border bg-background overflow-hidden"
                >
                  <div className="px-4 py-2 border-b border-border bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Recent Assessments
                  </div>
                  <div className="divide-y divide-border">
                    {history.map(h => (
                      <div key={h.sessionId} className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-foreground truncate">{h.companyName || "Unnamed Company"}</div>
                            <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded-sm font-medium ${h.status === "complete" ? "bg-primary/10 text-primary" : h.status === "clarifying" ? "bg-yellow-500/10 text-yellow-600" : "bg-muted text-muted-foreground"}`}>
                              {h.status === "complete" ? "Complete" : h.status === "clarifying" ? "In progress" : h.status}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {h.industry && <span>{h.industry} · </span>}
                            {h.opportunity && <span className="italic">{h.opportunity.slice(0, 60)}{h.opportunity.length > 60 ? "…" : ""} · </span>}
                            {new Date(h.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {h.confidenceScore && (
                            <span className="text-xs font-medium text-primary">{h.confidenceScore}/100</span>
                          )}
                          <button
                            onClick={() => loadAssessmentForEdit(h)}
                            className="inline-flex items-center gap-1 text-xs border border-border px-2 py-1 hover:bg-muted/50 transition-colors text-foreground"
                            title="Edit this assessment"
                          >
                            Edit
                          </button>
                          {h.shareToken && (
                            <a href={`${BASE}/assess/share/${h.shareToken}`} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              View <ArrowUpRight className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-3 mt-8 step-indicator">
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

                {/* House view — synthesis brief gives the assessment its strategic context up-front */}
                <SynthesisBriefCard compact />

                {/* Quick assess toggle */}
                <div className="flex items-center justify-between border border-border p-4 bg-muted/10">
                  <div>
                    <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" /> Quick Assess
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Skip clarifying questions — get a full assessment in under 15 seconds based on the context you provide
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuickAssess(!quickAssess)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${quickAssess ? "bg-primary" : "bg-muted"}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transform ring-0 transition-transform ${quickAssess ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* Primary company search */}
                  <div ref={companyContainerRef}>
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
                          placeholder="Search public company name…"
                          className="w-full h-10 px-2 bg-transparent text-foreground text-sm focus:outline-none"
                        />
                        {companySearchLoading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin mr-2 shrink-0" />}
                        {selectedCompanyConfirmed && !companySearchLoading && <CheckCircle2 className="w-4 h-4 text-primary mr-2 shrink-0" />}
                        {companyName && <button onClick={clearCompany} className="mr-2 text-muted-foreground hover:text-foreground shrink-0"><X className="w-3.5 h-3.5" /></button>}
                      </div>
                      <AnimatePresence>
                        {companyDropdownOpen && (companySearchResults.length > 0 || allowManualCompany) && (
                          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
                            className="absolute z-50 top-full left-0 right-0 mt-1 border border-border bg-background shadow-lg overflow-hidden">
                            {companySearchResults.length > 0 && (
                              <>
                                <div className="px-3 py-1.5 border-b border-border bg-muted/30 text-xs text-muted-foreground font-medium">SEC EDGAR matches</div>
                                {companySearchResults.map((result, i) => (
                                  <button key={i} type="button" onMouseDown={() => selectCompany(result)}
                                    className="w-full text-left px-3 py-2.5 hover:bg-muted/50 border-b border-border/50 last:border-0 transition-colors">
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <div className="text-sm font-medium text-foreground flex items-center gap-2">
                                          {result.entityName}
                                          {result.ticker && <span className="text-xs font-bold text-primary border border-primary/20 bg-primary/5 px-1.5 py-0.5 rounded-sm">{result.ticker}</span>}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-0.5">
                                          {result.location && <span>{result.location} · </span>}
                                          SEC filing {result.fileDate ? new Date(result.fileDate).toLocaleDateString("en-US", { year: "numeric", month: "short" }) : "—"}
                                        </div>
                                      </div>
                                      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                                    </div>
                                  </button>
                                ))}
                              </>
                            )}
                            {allowManualCompany && companyName.trim().length >= 2 && (
                              <button type="button" onMouseDown={useCompanyManually}
                                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-t border-border/50">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-medium text-foreground">Use "{companyName}" anyway</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">No SEC filing found — assessment will proceed without 10-K data</div>
                                  </div>
                                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                                </div>
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                      {selectedCompanyConfirmed && (
                        <p className="text-xs text-primary mt-1 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {selectedCompanyCik ? "Confirmed — will pull most recent SEC filing" : `Using "${companyName}" — no SEC filing will be retrieved`}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1.5">Industry</label>
                    <select value={industry} onChange={e => setIndustry(e.target.value)}
                      className="w-full h-10 px-3 border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="">Select industry…</option>
                      {industryOptions.length > 0
                        ? industryOptions.map(i => <option key={i.id} value={i.name}>{i.name}{i.capabilityCount > 0 ? ` (${i.capabilityCount} capabilities)` : ""}</option>)
                        : <option disabled>Loading…</option>}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1.5">
                    Business Opportunity or Transformation <span className="text-destructive">*</span>
                    <RadixTooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-muted-foreground hover:text-foreground transition-colors">
                          <HelpCircle className="w-3.5 h-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                        <p className="font-semibold mb-1">What goes here</p>
                        <p>The core of your assessment. Describe the initiative, transformation, or challenge in as much detail as you can:</p>
                        <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                          <li>What you're trying to achieve</li>
                          <li>Key constraints or blockers</li>
                          <li>What success looks like</li>
                          <li>What's at stake if you fail</li>
                        </ul>
                        <p className="mt-1.5 text-muted-foreground">Claude uses this as the foundation to generate targeted questions and map your capability landscape.</p>
                      </TooltipContent>
                    </RadixTooltip>
                  </label>
                  <div className="relative">
                    <textarea
                      value={opportunity}
                      onChange={e => setOpportunity(e.target.value)}
                      rows={5}
                      placeholder={isRecordingOppty ? "Listening — speak your opportunity…" : "Describe the initiative, opportunity, or challenge you're facing. Be specific: What are you trying to achieve? What constraints exist? What's at stake?"}
                      className={`w-full px-3 py-2.5 pr-12 border bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring transition-colors ${isRecordingOppty ? "border-primary/40" : "border-input"}`}
                    />
                    <button
                      type="button"
                      onClick={isRecordingOppty ? stopOpptyRecording : startOpptyRecording}
                      title={isRecordingOppty ? "Stop recording" : "Dictate your opportunity"}
                      className={`absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full transition-colors ${isRecordingOppty ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground"}`}
                    >
                      {isRecordingOppty ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  </div>
                  {isRecordingOppty && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="w-2 h-2 rounded-full bg-destructive animate-pulse shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        {opptyInterim ? <span className="italic text-foreground/70">{opptyInterim}</span> : "Listening… describe the opportunity or challenge"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Competitor section */}
                <div className="border border-border">
                  <button type="button" onClick={() => setShowCompetitors(!showCompetitors)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">Competitor Benchmarking</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Add up to 3 competitors — their SEC 10-K filings will be pulled and overlaid on the radar</div>
                      </div>
                    </div>
                    {showCompetitors ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  <AnimatePresence>
                    {showCompetitors && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-border" style={{ overflow: "visible" }}>
                        <div className="px-5 py-4 space-y-3">
                          {competitors.map((comp, idx) => (
                            <div key={idx} className="relative" ref={el => { competitorContainerRefs.current[idx] = el; }}>
                              <div className={`flex items-center border bg-background ${comp.confirmed ? "border-primary/40" : "border-input"}`}>
                                <Search className="w-4 h-4 text-muted-foreground ml-3 shrink-0" />
                                <input
                                  value={comp.name}
                                  onChange={e => handleCompetitorInput(idx, e.target.value)}
                                  placeholder={`Competitor ${idx + 1} name…`}
                                  className="w-full h-9 px-2 bg-transparent text-foreground text-sm focus:outline-none"
                                />
                                {competitorSearchLoading[idx] && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin mr-2 shrink-0" />}
                                {comp.confirmed && <CheckCircle2 className="w-4 h-4 text-primary mr-2 shrink-0" />}
                                {competitors.length > 1 && (
                                  <button onClick={() => removeCompetitor(idx)} className="mr-2 text-muted-foreground hover:text-foreground shrink-0">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              <AnimatePresence>
                                {competitorDropdownOpen[idx] && (competitorSearchResults[idx] || []).length > 0 && (
                                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                                    className="absolute z-50 top-full left-0 right-0 mt-1 border border-border bg-background shadow-lg overflow-hidden">
                                    {(competitorSearchResults[idx] || []).map((result, i) => (
                                      <button key={i} type="button" onMouseDown={() => selectCompetitor(idx, result)}
                                        className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b border-border/50 last:border-0 transition-colors">
                                        <div className="text-sm font-medium text-foreground flex items-center gap-2">
                                          {result.entityName}
                                          {result.ticker && <span className="text-xs font-bold text-primary border border-primary/20 bg-primary/5 px-1.5 py-0.5 rounded-sm">{result.ticker}</span>}
                                        </div>
                                        <div className="text-xs text-muted-foreground">{result.location && <>{result.location} · </>}10-K filed {result.fileDate ? new Date(result.fileDate).toLocaleDateString("en-US", { year: "numeric", month: "short" }) : "—"}</div>
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          ))}
                          {competitors.length < 3 && (
                            <button type="button" onClick={addCompetitor}
                              className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
                              <Plus className="w-3.5 h-3.5" /> Add another competitor
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Voice recording */}
                <div className="border border-border p-6">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        Voice Briefing
                        <RadixTooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-muted-foreground hover:text-foreground transition-colors">
                              <HelpCircle className="w-3.5 h-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                            <p className="font-semibold mb-1">What is this for?</p>
                            <p>A private spoken layer <em>on top of</em> your typed opportunity — say what you can't easily write.</p>
                            <p className="mt-1.5">Useful for: tone, urgency, political context, off-the-record dynamics, or anything hard to articulate in writing.</p>
                            <p className="mt-1.5">Think of it like a verbal briefing to a consultant before a formal meeting. It's transcribed separately and gives Claude richer context — improving the confidence score and the quality of the analysis.</p>
                          </TooltipContent>
                        </RadixTooltip>
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Add off-the-record context — tone, urgency, politics — that's hard to type.</p>
                    </div>
                    <button type="button" onClick={isRecording ? stopRecording : startRecording}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${isRecording ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
                      {isRecording ? <><MicOff className="w-4 h-4" /> Stop</> : <><Mic className="w-4 h-4" /> Record</>}
                    </button>
                  </div>
                  {isRecording && <div className="flex items-center gap-2 mb-3"><span className="w-2 h-2 rounded-full bg-destructive animate-pulse" /><span className="text-xs text-muted-foreground">Recording…</span></div>}
                  {voiceTranscript ? (
                    <div className="bg-muted/40 p-3 text-sm text-foreground leading-relaxed max-h-32 overflow-y-auto border border-border">
                      {voiceTranscript}
                      <button onClick={() => { setVoiceTranscript(""); finalRef.current = ""; }} className="ml-2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3 inline" /></button>
                    </div>
                  ) : !isRecording && <div className="text-sm text-muted-foreground italic">No transcript yet. Click Record and speak.</div>}
                </div>

                {/* Document upload */}
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-1.5">Upload Supporting Document <span className="text-muted-foreground font-normal">(TXT, MD, CSV — under 5MB)</span></label>
                  <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => document.getElementById("file-input")?.click()}
                    className="border border-dashed border-border p-8 text-center cursor-pointer hover:bg-muted/20 transition-colors">
                    {documentName ? (
                      <div className="flex items-center justify-center gap-2 text-sm text-foreground">
                        <FileText className="w-4 h-4 text-primary" />
                        {documentName}
                        <button onClick={e => { e.stopPropagation(); setDocumentName(""); setDocumentText(""); }} className="text-muted-foreground hover:text-foreground ml-1"><X className="w-3.5 h-3.5" /></button>
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

                {/* Job posting section */}
                <div className="border border-border">
                  <button type="button" onClick={() => setShowJobPosting(!showJobPosting)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-primary" />
                      <div>
                        <div className="text-sm font-semibold text-foreground">Job Posting Analysis</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Paste a job posting — Claude will extract capability signals and identify what your hiring reveals about gaps</div>
                      </div>
                    </div>
                    {showJobPosting ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>
                  <AnimatePresence>
                    {showJobPosting && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border">
                        <div className="px-5 py-4">
                          <textarea value={jobPostingText} onChange={e => setJobPostingText(e.target.value)} rows={5}
                            placeholder="Paste job title, responsibilities, and required skills here…"
                            className="w-full px-3 py-2.5 border border-input bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {error && <p className="text-sm text-destructive border border-destructive/20 bg-destructive/5 px-4 py-2">{error}</p>}

                <button onClick={submitInput} disabled={isLoading}
                  className="inline-flex items-center gap-2 h-12 px-8 bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing assessment…</> : quickAssess ? <><Zap className="w-4 h-4" /> Quick Assess</> : <>Get Clarifying Questions <ArrowRight className="w-4 h-4" /></>}
                </button>
              </motion.div>
            )}

            {/* ── STEP 2: QUESTIONS ── */}
            {step === "questions" && (
              <motion.div key="questions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className="space-y-8">
                {companyName && (
                  <div className={`flex items-center gap-3 p-4 border text-sm ${secStatus === "found" ? "border-primary/20 bg-primary/5" : secStatus === "not_found" ? "border-border bg-muted/30" : "border-border bg-muted/20"}`}>
                    <Building2 className="w-4 h-4 text-primary shrink-0" />
                    {secStatus === "searching" && <><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Searching SEC EDGAR for <strong>{companyName}</strong>…</span></>}
                    {secStatus === "found" && <span className="text-foreground"><strong>{companyName}</strong> found on SEC EDGAR — most recent 10-K will be incorporated.</span>}
                    {secStatus === "not_found" && <span className="text-muted-foreground"><strong>{companyName}</strong> not found in SEC EDGAR — assessment will use provided context only.</span>}
                    {secStatus === "idle" && <span className="text-muted-foreground">No company name provided — assessment based on provided context.</span>}
                  </div>
                )}

                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">Claude wants to know</div>
                  <h2 className="text-2xl font-serif text-foreground mb-1">A few targeted questions</h2>
                  <p className="text-muted-foreground text-sm">Your answers triangulate the assessment and sharpen the confidence score. Be direct.</p>
                </div>

                {/* Live CVI delta preview — recomputes locally as the user types */}
                {(() => {
                  const preview = estimateCviDelta(answers);
                  const deltaColor =
                    preview.direction === "up" ? "text-emerald-500" :
                    preview.direction === "down" ? "text-rose-500" :
                    "text-muted-foreground";
                  const bgColor =
                    preview.direction === "up" ? "bg-emerald-500/5 border-emerald-500/30" :
                    preview.direction === "down" ? "bg-rose-500/5 border-rose-500/30" :
                    "bg-muted/20 border-border";
                  const arrow =
                    preview.direction === "up" ? "↑" :
                    preview.direction === "down" ? "↓" :
                    "→";
                  return (
                    <div className={`border ${bgColor} p-4 flex items-center justify-between gap-4`}>
                      <div className="flex items-center gap-3">
                        <div className="shrink-0 w-9 h-9 rounded-full bg-background border border-border flex items-center justify-center">
                          <TrendingUp className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-foreground">Live CVI delta preview</div>
                          <div className="text-xs text-muted-foreground mt-0.5 italic">
                            {preview.rationale}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-mono font-semibold ${deltaColor}`}>
                          {arrow} {preview.delta > 0 ? "+" : ""}{preview.delta.toFixed(1)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                          est. confidence shift
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-6">
                  {questions.map((q, i) => {
                    const recording = activeQVoice === i;
                    return (
                      <div key={i} className={`border p-5 transition-colors ${recording ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                        <label className="block text-sm font-semibold text-foreground mb-3">
                          <span className="text-primary mr-2">Q{i + 1}.</span>{q}
                        </label>
                        <div className="relative">
                          <textarea
                            value={answers[i] || ""}
                            onChange={e => { const next = [...answers]; next[i] = e.target.value; setAnswers(next); }}
                            rows={3}
                            placeholder={recording ? "Listening…" : "Type your answer or click the mic to speak…"}
                            className={`w-full px-3 py-2 pr-12 border border-input bg-background text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring ${recording ? "border-primary/30" : ""}`}
                          />
                          <button
                            type="button"
                            onClick={() => recording ? stopQVoice() : startQVoice(i)}
                            title={recording ? "Stop recording" : "Speak your answer"}
                            className={`absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full transition-colors ${recording ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground"}`}
                          >
                            {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                          </button>
                        </div>
                        {recording && (
                          <div className="flex items-center gap-2 mt-2">
                            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse shrink-0" />
                            <span className="text-xs text-muted-foreground">
                              {qVoiceInterim ? <span className="italic text-foreground/70">{qVoiceInterim}</span> : "Listening… speak your answer"}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {error && <p className="text-sm text-destructive border border-destructive/20 bg-destructive/5 px-4 py-2">{error}</p>}

                <div className="flex gap-4">
                  <button onClick={() => setStep("input")}
                    className="inline-flex items-center gap-2 h-10 px-6 border border-input text-sm font-medium text-foreground hover:bg-muted transition-colors">
                    ← Back
                  </button>
                  <button onClick={submitAnalysis} disabled={isLoading}
                    className="inline-flex items-center gap-2 h-10 px-8 bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    Generate Full Assessment <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── STEP 3: ANALYZING ── */}
            {step === "analyzing" && (
              <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-24 gap-8">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full border-2 border-primary/20 flex items-center justify-center">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  </div>
                </div>
                <div className="text-center max-w-sm">
                  <h2 className="text-xl font-serif text-foreground mb-4">Running Capability Assessment</h2>
                  <div className="space-y-2">
                    {PROGRESS_STEPS.map((label, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: i <= progressStep ? 1 : 0.25, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className={`flex items-center gap-2 text-sm ${i === progressStep ? "text-foreground" : i < progressStep ? "text-muted-foreground line-through" : "text-muted-foreground/70"}`}
                      >
                        {i < progressStep ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                        ) : i === progressStep ? (
                          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />
                        )}
                        {label}
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── STEP 4: RESULTS ── */}
            {step === "results" && analysis && (
              <motion.div key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-8">

                {/* Actions bar */}
                <div className="flex items-center justify-between flex-wrap gap-3 no-print">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={downloadAssessment}
                      className="inline-flex items-center gap-1.5 h-8 px-4 border border-input text-xs font-medium text-foreground hover:bg-muted transition-colors">
                      <Download className="w-3.5 h-3.5" /> Download JSON
                    </button>
                    <button onClick={printAssessment}
                      className="inline-flex items-center gap-1.5 h-8 px-4 border border-input text-xs font-medium text-foreground hover:bg-muted transition-colors">
                      <FileText className="w-3.5 h-3.5" /> Print / PDF
                    </button>
                  </div>
                  <button onClick={generateShareLink}
                    className="inline-flex items-center gap-1.5 h-8 px-4 bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                    {copied ? <><Check className="w-3.5 h-3.5" /> Link copied!</> : <><Share2 className="w-3.5 h-3.5" /> Share assessment</>}
                  </button>
                </div>

                {/* Result tabs */}
                <div className="border-b border-border no-print">
                  <div className="flex gap-0">
                    {([
                      { key: "overview", label: "Overview", icon: BarChart3 },
                      { key: "roadmap", label: "12-Month Roadmap", icon: Map },
                      ...(activeCompetitors.length > 0 ? [{ key: "competitors", label: "Competitors", icon: Users }] : []),
                    ] as Array<{ key: ResultTab; label: string; icon: React.ElementType }>).map(({ key, label, icon: Icon }) => (
                      <button key={key} onClick={() => setResultTab(key)}
                        className={`inline-flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${resultTab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── OVERVIEW TAB ── */}
                {resultTab === "overview" && (
                  <div className="space-y-10">

                    {/* Data Provenance Banner */}
                    <div className="border border-border bg-muted/30 p-4">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                          <BookOpen className="w-3 h-3 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold uppercase tracking-wider text-foreground mb-2">Analysis Grounding & Sources</div>
                          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3">
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">AI Engine:</span>{" "}
                              <a href="https://www.anthropic.com/claude" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">Claude (Anthropic) <ExternalLink className="w-2.5 h-2.5" /></a>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">Framework:</span>{" "}
                              <a href="https://www.weforum.org/publications/the-global-competitiveness-report-2019/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">WEF GCI 4.0 <ExternalLink className="w-2.5 h-2.5" /></a>
                              {" "}·{" "}
                              <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">Future of Jobs 2025 <ExternalLink className="w-2.5 h-2.5" /></a>
                            </div>
                            {analysis.confidenceFactors?.secDataAvailable && (
                              <div className="text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">Filing Data:</span>{" "}
                                <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">SEC EDGAR 10-K <ExternalLink className="w-2.5 h-2.5" /></a>
                              </div>
                            )}
                            {analysis.confidenceFactors?.competitorDataAvailable && (
                              <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Competitor 10-Ks:</span> Included</div>
                            )}
                          </div>
                          {researchSources.length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-muted-foreground mb-1.5">Research citations:</div>
                              <div className="flex flex-wrap gap-2">
                                {researchSources.map(s => s.url ? (
                                  <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs border border-border bg-background px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                    {s.publisher || (() => { try { return new URL(s.url!).hostname.replace("www.", ""); } catch { return s.url!; } })()}
                                  </a>
                                ) : null)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Executive Summary + Confidence */}
                    <div className="grid md:grid-cols-3 gap-6">
                      <div className="md:col-span-2 border border-border p-6">
                        <div className="text-xs font-bold uppercase tracking-wider text-primary mb-3">Executive Summary</div>
                        <p className="text-foreground text-base leading-relaxed font-serif">{analysis.executiveSummary}</p>
                        <div className="flex flex-wrap gap-2 mt-4">
                          {companyName && <span className="text-xs border border-border px-2 py-0.5 text-muted-foreground">{companyName}</span>}
                          {industry && <span className="text-xs border border-border px-2 py-0.5 text-muted-foreground">{industry}</span>}
                          {analysis.confidenceFactors?.secDataAvailable && <span className="text-xs border border-primary/20 bg-primary/5 text-primary px-2 py-0.5">SEC 10-K</span>}
                          {analysis.confidenceFactors?.voiceProvided && <span className="text-xs border border-border px-2 py-0.5 text-muted-foreground">Voice Briefing</span>}
                          {analysis.confidenceFactors?.jobPostingProvided && <span className="text-xs border border-primary/20 bg-primary/5 text-primary px-2 py-0.5">Job Posting</span>}
                        </div>
                      </div>
                      <div className="border border-border p-6 flex flex-col items-center justify-center text-center">
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Confidence Score</div>
                        <div className={`text-6xl font-serif font-medium mb-1 ${confidenceColor(analysis.confidenceScore)}`}>{analysis.confidenceScore}</div>
                        <div className="text-xs text-muted-foreground">out of 100</div>
                        <div className="mt-4 w-full bg-muted h-1.5">
                          <div className="h-full bg-primary transition-all" style={{ width: `${analysis.confidenceScore}%` }} />
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground space-y-1 text-left w-full">
                          {analysis.confidenceFactors?.secDataAvailable && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> SEC 10-K data</div>}
                          {analysis.confidenceFactors?.voiceProvided && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> Voice briefing</div>}
                          {analysis.confidenceFactors?.documentProvided && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> Supporting doc</div>}
                          {analysis.confidenceFactors?.competitorDataAvailable && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> Competitor data</div>}
                          {analysis.confidenceFactors?.jobPostingProvided && <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> Job posting</div>}
                        </div>
                      </div>
                    </div>

                    {/* Peer Cohort Comparison Strip — real percentiles from /peer-coop */}
                    <div className="border border-border p-5">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-primary" />
                          <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Peer Cohort Comparison</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Live percentiles from peer-coop contributor cohort — anonymous, k-anonymized at the minK threshold.
                            </p>
                          </div>
                        </div>
                        {peerLoading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />}
                      </div>

                      {peerError === "no_session" && (
                        <div className="text-xs text-muted-foreground italic border border-dashed border-border bg-muted/20 px-3 py-3">
                          Set up your organization profile to unlock real peer-cohort percentiles. Without it, only the WEF peer average above can be shown.
                        </div>
                      )}
                      {peerError === "not_contributor" && (
                        <div className="text-xs text-muted-foreground italic border border-dashed border-border bg-muted/20 px-3 py-3">
                          Cohort data is contributor-only. Opt in via the peer-coop settings to share aggregated capability scores and see how you stack up.
                        </div>
                      )}
                      {peerError && peerError !== "no_session" && peerError !== "not_contributor" && (
                        <div className="text-xs text-destructive italic">Failed to load peer cohort data ({peerError}).</div>
                      )}

                      {peerPercentiles && peerPercentiles.cohortEligible && peerPercentiles.rows.length > 0 && (
                        <>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                              {peerPercentiles.cohortContributorCount} contributors in your cohort
                            </span>
                            <span>·</span>
                            <span>min-k = {peerPercentiles.minK}</span>
                            {peerPercentiles.cohort.industryId && (
                              <>
                                <span>·</span>
                                <span>industry-scoped</span>
                              </>
                            )}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border bg-muted/20 text-muted-foreground">
                                  <th className="text-left py-2 px-2 font-semibold">Capability</th>
                                  <th className="text-right py-2 px-2 font-semibold">You</th>
                                  <th className="text-right py-2 px-2 font-semibold">P25</th>
                                  <th className="text-right py-2 px-2 font-semibold">P50</th>
                                  <th className="text-right py-2 px-2 font-semibold">P75</th>
                                  <th className="text-right py-2 px-2 font-semibold">P90</th>
                                  <th className="text-left py-2 px-2 font-semibold">Band</th>
                                </tr>
                              </thead>
                              <tbody>
                                {peerPercentiles.rows.slice(0, 12).map(row => {
                                  const bandColor =
                                    row.myPercentileBand === "top" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" :
                                    row.myPercentileBand === "above_median" ? "bg-primary/10 text-primary border-primary/40" :
                                    row.myPercentileBand === "bottom" ? "bg-rose-500/15 text-rose-500 border-rose-500/40" :
                                    row.myPercentileBand === "below_median" ? "bg-amber-500/15 text-amber-500 border-amber-500/40" :
                                    "bg-muted text-muted-foreground border-border";
                                  return (
                                    <tr key={row.capabilityId} className="border-b border-border/40 hover:bg-muted/10">
                                      <td className="py-2 px-2 text-foreground font-medium">{row.capabilityName}</td>
                                      <td className="py-2 px-2 text-right font-mono tabular-nums text-foreground font-semibold">
                                        {row.myScore !== null ? row.myScore.toFixed(1) : "—"}
                                      </td>
                                      <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">{row.p25.toFixed(1)}</td>
                                      <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">{row.p50.toFixed(1)}</td>
                                      <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">{row.p75.toFixed(1)}</td>
                                      <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">{row.p90.toFixed(1)}</td>
                                      <td className="py-2 px-2">
                                        <span className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wider border px-1.5 py-0.5 rounded-sm ${bandColor}`}>
                                          {row.myPercentileBand.replace("_", " ")}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {peerPercentiles.rows.length > 12 && (
                            <div className="text-xs text-muted-foreground italic mt-2">
                              Showing 12 of {peerPercentiles.rows.length} capabilities tracked in the cohort.
                            </div>
                          )}
                        </>
                      )}

                      {peerPercentiles && !peerPercentiles.cohortEligible && (
                        <div className="text-xs text-muted-foreground italic border border-dashed border-border bg-muted/20 px-3 py-3">
                          Cohort below the min-k threshold of {peerPercentiles.minK}. Encourage more peers in your industry / size band to opt in, and the percentiles will surface here.
                        </div>
                      )}
                    </div>

                    {/* Radar Chart */}
                    {analysis.radarData?.length > 0 && (
                      <div className="border border-border p-6">
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-primary" />
                            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Capability Investment Radar</h3>
                          </div>
                          <div className="flex items-center gap-4">
                            <button onClick={() => setShowPeerOverlay(!showPeerOverlay)}
                              className={`text-xs flex items-center gap-1 px-2.5 py-1 border transition-colors ${showPeerOverlay ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}>
                              {showPeerOverlay ? <Check className="w-3 h-3" /> : null} Peer Avg
                            </button>
                            <div className="text-right">
                              <div className="text-xs font-semibold text-primary">WEF GCI 4.0 Aligned</div>
                              <div className="text-xs text-muted-foreground">Global Competitiveness Index 4.0</div>
                            </div>
                          </div>
                        </div>

                        <div className="grid md:grid-cols-3 gap-6 items-start">
                          <div className="md:col-span-2">
                            <ResponsiveContainer width="100%" height={340}>
                              <RadarChart data={showPeerOverlay ? analysis.radarData : analysis.radarData}>
                                <PolarGrid stroke="hsl(var(--border))" />
                                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                <Radar name="Invest" dataKey="invest" stroke={radarColors.invest} fill={radarColors.invest} fillOpacity={0.25} strokeWidth={2} />
                                <Radar name="Hold" dataKey="hold" stroke={radarColors.hold} fill={radarColors.hold} fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 2" />
                                <Radar name="Divest" dataKey="divest" stroke={radarColors.divest} fill={radarColors.divest} fillOpacity={0.1} strokeWidth={1} />
                                <Radar name="Emerging (3yr+)" dataKey="emerging" stroke={radarColors.emerging} fill={radarColors.emerging} fillOpacity={0.15} strokeWidth={1.5} strokeDasharray="2 2" />
                                {showPeerOverlay && <Radar name="Industry Peer Avg" dataKey="peerAverage" stroke={radarColors.peer} fill={radarColors.peer} fillOpacity={0.05} strokeWidth={1.5} strokeDasharray="3 3" />}
                                <Legend iconSize={10} />
                                <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                              </RadarChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="space-y-5">
                            <div className="space-y-2.5">
                              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Signal</div>
                              {[
                                { label: "Invest", color: "bg-primary", desc: "Increase resources now" },
                                { label: "Hold", color: "bg-muted-foreground", desc: "Maintain current level" },
                                { label: "Divest", color: "bg-destructive", desc: "Reduce or exit" },
                                { label: "Emerging", color: "bg-accent", desc: "Watch & prepare" },
                                { label: "Industry Peer Avg", color: "bg-blue-500", desc: "Sector benchmark" },
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
                            <div className="border-t border-border pt-4 space-y-1.5">
                              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Axis Framework Source</div>
                              {Object.entries(wefAxisSources).map(([axis, ref]) => (
                                <div key={axis} className="flex items-baseline justify-between gap-1 text-xs">
                                  <span className="text-foreground font-medium shrink-0">{axis}</span>
                                  <span className="text-muted-foreground text-right italic">{ref}</span>
                                </div>
                              ))}
                              <div className="pt-2 border-t border-border/50 mt-2 space-y-1">
                                {[
                                  { label: "GCI 4.0 Report", url: "https://www.weforum.org/publications/the-global-competitiveness-report-2019/" },
                                  { label: "Future of Jobs 2025", url: "https://www.weforum.org/publications/the-future-of-jobs-report-2025/" },
                                  { label: "Human Capital Index", url: "https://www.weforum.org/reports/global-human-capital-report-2017/" },
                                ].map(({ label, url }) => (
                                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2">
                                    <ExternalLink className="w-2.5 h-2.5 shrink-0" /> {label}
                                  </a>
                                ))}
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
                          <span className="ml-auto text-xs text-muted-foreground">WEF GCI 4.0 & Future of Jobs aligned</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border bg-muted/10">
                                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Capability</th>
                                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">WEF Alignment</th>
                                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Maturity</th>
                                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Peer</th>
                                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Importance</th>
                                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Action</th>
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
                                    {cap.wefSubIndicators && cap.wefSubIndicators.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {cap.wefSubIndicators.map((ind, j) => (
                                          <span key={j} className="text-sm text-muted-foreground italic bg-muted/40 px-1.5 py-0.5 border border-border/50">{ind}</span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 hidden md:table-cell">
                                    <span className="text-sm text-muted-foreground italic">{cap.wefAlignment}</span>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center gap-0.5">
                                      {Array.from({ length: 5 }).map((_, j) => (
                                        <span key={j} className={`w-3 h-3 rounded-sm ${j < cap.currentMaturity ? "bg-primary" : "bg-muted"}`} />
                                      ))}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-0.5">{cap.currentMaturity}/5</div>
                                  </td>
                                  <td className="px-4 py-3 text-center hidden lg:table-cell">
                                    {cap.peerBenchmark !== undefined ? (
                                      <div className="flex flex-col items-center gap-1">
                                        <div className="text-xs font-medium text-foreground">{cap.peerBenchmark}</div>
                                        <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                                          <div className="h-full bg-blue-500/60 rounded-full" style={{ width: `${cap.peerBenchmark}%` }} />
                                        </div>
                                      </div>
                                    ) : <span className="text-xs text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center gap-0.5">
                                      {Array.from({ length: 5 }).map((_, j) => (
                                        <span key={j} className={`w-3 h-3 rounded-sm ${j < cap.strategicImportance ? "bg-foreground/80" : "bg-muted"}`} />
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-sm ${actionBadge[cap.action] ?? ""}`}>{cap.action}</span>
                                    <div className="text-xs text-muted-foreground mt-1">{cap.timeHorizon}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Gaps */}
                    {analysis.gaps?.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Critical Gaps & Exposures</h3>
                        </div>
                        {analysis.gaps.map((gap, i) => (
                          <div key={i} className="border border-border p-5">
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="font-semibold text-foreground">{gap.capability}</div>
                              <span className={`shrink-0 text-xs font-medium px-2 py-0.5 border ${urgencyBadge[gap.urgency] ?? ""}`}>{gap.urgency.replace("_", " ")}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{gap.exposure}</p>
                            {gap.competitorAdvantage && (
                              <div className="mb-3 flex items-start gap-2 text-xs text-foreground border border-border/50 bg-muted/20 px-3 py-2">
                                <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                                <span><span className="font-semibold">Competitor edge:</span> {gap.competitorAdvantage}</span>
                              </div>
                            )}
                            <div className="flex items-start gap-2 text-sm">
                              <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                              <span className="text-foreground">{gap.recommendation}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Job posting insights */}
                    {analysis.jobPostingInsights && (
                      <div className="border border-primary/20 bg-primary/5 p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Target className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Job Posting Intelligence</h3>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3 leading-relaxed font-serif italic">{analysis.jobPostingInsights.strategicIntent}</p>
                        <div className="grid md:grid-cols-2 gap-4">
                          {analysis.jobPostingInsights.capabilitySignals?.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold text-foreground mb-2">Capability signals</div>
                              <ul className="space-y-1">
                                {analysis.jobPostingInsights.capabilitySignals.map((s, i) => (
                                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary mt-0.5 shrink-0" />{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {analysis.jobPostingInsights.gapIndicators?.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold text-foreground mb-2">Gap indicators</div>
                              <ul className="space-y-1">
                                {analysis.jobPostingInsights.gapIndicators.map((g, i) => (
                                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />{g}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* SEC Insights */}
                    {analysis.secInsights && (
                      <div className="border border-border p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Building2 className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">SEC 10-K Capability Lens</h3>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3 leading-relaxed font-serif">{analysis.secInsights.summary}</p>
                        {analysis.secInsights.rdSpendSignal && (
                          <div className="mb-3 text-xs border border-border/50 bg-muted/20 px-3 py-2 text-foreground">
                            <span className="font-semibold">R&D Signal:</span> {analysis.secInsights.rdSpendSignal}
                          </div>
                        )}
                        {analysis.secInsights.capabilityImplications?.length > 0 && (
                          <ul className="space-y-1.5">
                            {analysis.secInsights.capabilityImplications.map((imp, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <ArrowRight className="w-3 h-3 text-primary mt-0.5 shrink-0" /> {imp}
                              </li>
                            ))}
                          </ul>
                        )}
                        {analysis.secInsights.riskCapabilityLinks && analysis.secInsights.riskCapabilityLinks.length > 0 && (
                          <div className="mt-3 border-t border-border/50 pt-3">
                            <div className="text-xs font-semibold text-foreground mb-2">Risk → Capability links</div>
                            <ul className="space-y-1">
                              {analysis.secInsights.riskCapabilityLinks.map((r, i) => (
                                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Top Recommendations */}
                    {analysis.topRecommendations?.length > 0 && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Strategic Recommendations</h3>
                        </div>
                        {analysis.topRecommendations.map((rec, i) => (
                          <div key={i} className="border border-border p-5">
                            <div className="flex items-start gap-3 mb-2">
                              <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</div>
                              <div className="font-semibold text-foreground">{rec.title}</div>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2 leading-relaxed pl-10">{rec.rationale}</p>
                            <div className="pl-10 flex flex-col gap-1.5">
                              <div className="text-xs text-foreground"><span className="font-semibold">Expected impact:</span> {rec.impact}</div>
                              <div className="text-sm text-muted-foreground italic flex items-center gap-1">
                                <BookOpen className="w-3 h-3 text-primary" /> {rec.wefReference}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button onClick={() => setStep("input")}
                      className="inline-flex items-center gap-2 h-10 px-6 border border-input text-sm font-medium text-foreground hover:bg-muted transition-colors no-print">
                      ← New Assessment
                    </button>
                  </div>
                )}

                {/* ── ROADMAP TAB ── */}
                {resultTab === "roadmap" && (
                  <div className="space-y-8">
                    {(roadmap || analysis.roadmap) ? (
                      <>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-primary mb-1">12-Month Capability Roadmap</div>
                          <h2 className="text-2xl font-serif text-foreground mb-1">Phased Investment Plan</h2>
                          <p className="text-muted-foreground text-sm">Sequenced initiatives derived from your gap analysis, prioritized by effort and impact.</p>
                        </div>

                        {(roadmap || analysis.roadmap)!.phases?.map((phase, phaseIdx) => (
                          <div key={phaseIdx} className="border border-border overflow-hidden">
                            <div className={`px-6 py-4 border-b border-border flex items-center justify-between ${phaseIdx === 0 ? "bg-primary/5" : phaseIdx === 1 ? "bg-muted/30" : "bg-muted/10"}`}>
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${phaseIdx === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground border border-border"}`}>
                                  {phaseIdx + 1}
                                </div>
                                <div>
                                  <div className="font-semibold text-foreground">{phase.label}</div>
                                  <div className="text-xs text-muted-foreground">{phase.theme}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border px-3 py-1">
                                <Clock className="w-3.5 h-3.5" /> {phase.months} months
                              </div>
                            </div>

                            <div className="divide-y divide-border">
                              {phase.initiatives?.map((init, initIdx) => (
                                <div key={initIdx} className="px-6 py-5 hover:bg-muted/10 transition-colors">
                                  <div className="flex items-start justify-between gap-4 mb-2">
                                    <div className="font-semibold text-foreground">{init.title}</div>
                                    <div className="flex gap-2 shrink-0">
                                      <span className={`text-xs font-medium ${effortColor[init.effort] ?? "text-foreground"}`}>
                                        {init.effort} effort
                                      </span>
                                      <span className="text-muted-foreground">·</span>
                                      <span className={`text-xs font-medium ${effortColor[init.impact] ?? "text-foreground"}`}>
                                        {init.impact} impact
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{init.description}</p>
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                                    {init.capability && (
                                      <span className="flex items-center gap-1 text-muted-foreground">
                                        <Target className="w-3 h-3 text-primary" /> {init.capability}
                                      </span>
                                    )}
                                    {init.owner && (
                                      <span className="flex items-center gap-1 text-muted-foreground">
                                        <Users className="w-3 h-3" /> {init.owner}
                                      </span>
                                    )}
                                    {init.wefLink && (
                                      <span className="flex items-center gap-1 text-muted-foreground italic">
                                        <BookOpen className="w-3 h-3 text-primary" /> {init.wefLink}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="text-center py-20 text-muted-foreground">
                        <Map className="w-10 h-10 mx-auto mb-4 opacity-30" />
                        <p className="text-sm">Roadmap not available for this assessment. Run a new assessment to generate one.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── COMPETITORS TAB ── */}
                {resultTab === "competitors" && activeCompetitors.length > 0 && (
                  <div className="space-y-8">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-primary mb-1">Competitor Analysis</div>
                      <h2 className="text-2xl font-serif text-foreground mb-1">Capability Benchmark vs. Competitors</h2>
                      <p className="text-muted-foreground text-sm">Radar overlay comparing your invest signal against each competitor's capability scores.</p>
                    </div>

                    <div className="border border-border p-6">
                      <ResponsiveContainer width="100%" height={380}>
                        <RadarChart data={buildCompetitorRadarData()}>
                          <PolarGrid stroke="hsl(var(--border))" />
                          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                          <Radar name={companyName || "Your Company"} dataKey="invest" stroke={radarColors.invest} fill={radarColors.invest} fillOpacity={0.2} strokeWidth={2} />
                          {activeCompetitors.map((comp, i) => (
                            <Radar key={comp.name} name={comp.name} dataKey={`comp_${i}`} stroke={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]} fill={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]} fillOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 2" />
                          ))}
                          {showPeerOverlay && <Radar name="Industry Peer Avg" dataKey="peerAverage" stroke={radarColors.peer} fill={radarColors.peer} fillOpacity={0.05} strokeWidth={1} strokeDasharray="2 2" />}
                          <Legend iconSize={10} />
                          <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Gap comparison by competitor */}
                    {analysis.gaps?.filter(g => g.competitorAdvantage).length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Where Competitors Have an Edge</h3>
                        {analysis.gaps.filter(g => g.competitorAdvantage).map((gap, i) => (
                          <div key={i} className="border border-border p-4 flex items-start gap-4">
                            <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                              <AlertTriangle className="w-4 h-4 text-destructive" />
                            </div>
                            <div>
                              <div className="font-semibold text-foreground text-sm mb-1">{gap.capability}</div>
                              <div className="text-xs text-muted-foreground mb-2">{gap.competitorAdvantage}</div>
                              <div className="text-xs text-foreground flex items-start gap-1.5">
                                <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /> {gap.recommendation}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
