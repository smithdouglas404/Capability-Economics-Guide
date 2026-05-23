import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ArrowUpRight,
  Clock,
  Loader2,
  Mic,
  MicOff,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

const API_BASE = "/api";
const STORAGE_KEY = "ce_nl_conversations";
const MAX_CONVERSATIONS = 10;

type Citation = { label: string; detail?: string };

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  followUps?: string[];
  classification?: string;
  durationMs?: number;
  capabilityRefs?: CapabilityRef[];
};

type CapabilityRef = {
  id: number;
  name: string;
  industry?: string | null;
  benchmarkScore?: number | null;
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
};

type CapabilityRecord = {
  id: number;
  name: string;
  industryId?: number;
  benchmarkScore?: number | null;
};

const SUGGESTIONS = [
  "Which capabilities have highest AI displacement risk?",
  "Show me EVaR leaders",
  "Strongest moats across all industries",
  "Banking capabilities ranked by score",
  "Active trade signals",
  "Which capabilities have lowest investment?",
];

function uid() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations(list: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  } catch {
    /* ignore quota */
  }
}

/**
 * Build a fuzzy index over all capabilities so we can detect which ones a
 * response refers to. Matches are case-insensitive and require the full
 * capability name to appear as a token boundary in the answer text.
 */
function detectCapabilityRefs(text: string, caps: CapabilityRecord[], industryNames: Map<number, string>): CapabilityRef[] {
  if (!text || caps.length === 0) return [];
  const lower = text.toLowerCase();
  const hits: CapabilityRef[] = [];
  const seen = new Set<number>();
  for (const cap of caps) {
    if (!cap.name || cap.name.length < 4) continue;
    const needle = cap.name.toLowerCase();
    if (lower.includes(needle) && !seen.has(cap.id)) {
      seen.add(cap.id);
      hits.push({
        id: cap.id,
        name: cap.name,
        industry: cap.industryId != null ? industryNames.get(cap.industryId) ?? null : null,
        benchmarkScore: cap.benchmarkScore ?? null,
      });
      if (hits.length >= 6) break;
    }
  }
  return hits;
}

export default function NLQuery() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [capIndex, setCapIndex] = useState<CapabilityRecord[]>([]);
  const [industryNames, setIndustryNames] = useState<Map<number, string>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const sessionToken = useMemo(
    () => (typeof window !== "undefined" ? localStorage.getItem("ce_session_token") ?? "" : ""),
    [],
  );

  // Hydrate state on mount: conversations + capability index + industry names
  useEffect(() => {
    const loaded = loadConversations();
    setConversations(loaded);
    setActiveId(loaded[0]?.id ?? null);

    fetch(`${API_BASE}/capabilities`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CapabilityRecord[]) => Array.isArray(rows) && setCapIndex(rows))
      .catch(() => {});

    fetch(`${API_BASE}/industries`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: number; name: string }>) => {
        if (Array.isArray(rows)) setIndustryNames(new Map(rows.map((r) => [r.id, r.name])));
      })
      .catch(() => {});
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, loading]);

  // Persist whenever conversations mutate
  useEffect(() => {
    if (conversations.length > 0) saveConversations(conversations);
  }, [conversations]);

  const updateActive = useCallback(
    (mutator: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? mutator(c) : c)),
      );
    },
    [activeId],
  );

  const startNew = useCallback(() => {
    const next: Conversation = {
      id: uid(),
      title: "New conversation",
      updatedAt: Date.now(),
      messages: [],
    };
    setConversations((prev) => [next, ...prev].slice(0, MAX_CONVERSATIONS));
    setActiveId(next.id);
    setInput("");
  }, []);

  const deleteConv = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (id === activeId) setActiveId(next[0]?.id ?? null);
        return next;
      });
    },
    [activeId],
  );

  const ask = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed || loading) return;

      // Lazy-create a conversation if none is active
      let convId = activeId;
      if (!convId) {
        const next: Conversation = { id: uid(), title: trimmed.slice(0, 60), updatedAt: Date.now(), messages: [] };
        setConversations((prev) => [next, ...prev].slice(0, MAX_CONVERSATIONS));
        convId = next.id;
        setActiveId(next.id);
      }

      const userMsg: Message = { role: "user", content: trimmed };
      const captured = convId;

      setConversations((prev) =>
        prev.map((c) =>
          c.id === captured
            ? {
                ...c,
                title: c.messages.length === 0 ? trimmed.slice(0, 60) : c.title,
                updatedAt: Date.now(),
                messages: [...c.messages, userMsg],
              }
            : c,
        ),
      );
      setInput("");
      setLoading(true);

      // Compose multi-turn context. Backend takes a single `query` string, so
      // we prepend prior turns as compact transcript. Keeps backwards compat.
      const conv = conversations.find((c) => c.id === captured);
      const prior = (conv?.messages ?? []).slice(-6);
      const transcript = prior
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      const composed = transcript
        ? `Previous conversation so far:\n${transcript}\n\nNew question: ${trimmed}`
        : trimmed;

      try {
        const res = await fetch(`${API_BASE}/nl-query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: composed,
            sessionToken,
            conversationId: captured,
          }),
        });
        const data = await res.json();
        const answerText: string = data.response ?? "(empty response)";
        const citations: Citation[] = data.data?.citations ?? [];
        const followUps: string[] = data.data?.followUps ?? [];
        const classification: string | undefined = data.data?.classification;
        const refs = detectCapabilityRefs(answerText, capIndex, industryNames);
        const assistantMsg: Message = {
          role: "assistant",
          content: answerText,
          citations,
          followUps,
          classification,
          durationMs: data.durationMs,
          capabilityRefs: refs,
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === captured
              ? { ...c, updatedAt: Date.now(), messages: [...c.messages, assistantMsg] }
              : c,
          ),
        );
      } catch {
        const assistantMsg: Message = { role: "assistant", content: "Sorry, something went wrong. Try again." };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === captured
              ? { ...c, updatedAt: Date.now(), messages: [...c.messages, assistantMsg] }
              : c,
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [activeId, capIndex, conversations, industryNames, loading, sessionToken],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  // Voice input via Web Speech API
  const startVoice = useCallback(() => {
    if (recording) {
      recRef.current?.stop?.();
      setRecording(false);
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const SRClass = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | (new () => unknown)
      | undefined;
    if (!SRClass) {
      alert("Voice input requires Chrome, Edge, or Safari.");
      return;
    }
    const rec = new SRClass() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: unknown) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalText = input ? input.trimEnd() + " " : "";
    rec.onresult = (e: unknown) => {
      const event = e as {
        resultIndex: number;
        results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
      };
      let interim = "";
      let assembled = finalText;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) assembled += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      finalText = assembled;
      setInput(assembled + interim);
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }, [input, recording]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6">
        <Badge className="mb-2">AI</Badge>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Intelligence</span>
        </div>
        <h1 className="text-3xl font-serif tracking-tight">CE Search</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Multi-turn natural-language interface to the capability dataset — EVaR, moat, AI exposure, signals, cascades.
        </p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Sidebar: recent conversations */}
        <aside className="col-span-12 md:col-span-3 lg:col-span-3">
          <Card className="rounded-none">
            <CardContent className="p-3">
              <Button
                onClick={startNew}
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs mb-3 rounded-none"
                data-testid="nl-new-conv"
              >
                <MessageSquarePlus className="w-3.5 h-3.5 mr-2" /> New conversation
              </Button>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Recent ({conversations.length})
              </div>
              <div className="space-y-1 max-h-[500px] overflow-y-auto">
                {conversations.length === 0 && (
                  <div className="text-xs italic text-muted-foreground py-2">No conversations yet.</div>
                )}
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`group flex items-start gap-1 px-2 py-1.5 border ${
                      c.id === activeId
                        ? "border-accent bg-accent/[0.06]"
                        : "border-transparent hover:border-border hover:bg-muted/40"
                    }`}
                  >
                    <button
                      onClick={() => setActiveId(c.id)}
                      className="flex-1 text-left text-xs leading-snug truncate"
                      title={c.title}
                    >
                      <div className="truncate">{c.title}</div>
                      <div className="font-mono text-[9px] text-muted-foreground mt-0.5">
                        {c.messages.length} msg · {new Date(c.updatedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      onClick={() => deleteConv(c.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-0.5"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Main chat column */}
        <main className="col-span-12 md:col-span-9 lg:col-span-9">
          <Card className="rounded-none">
            <CardContent className="p-0">
              <div className="h-[600px] overflow-y-auto p-4 space-y-5">
                {(!active || active.messages.length === 0) && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Sparkles className="w-12 h-12 text-primary/30 mb-4" />
                    <p className="text-muted-foreground mb-4 text-sm">
                      Ask anything about your capability data. Follow-ups carry context.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                      {SUGGESTIONS.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant="outline"
                          className="text-xs rounded-none"
                          onClick={() => ask(s)}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {active?.messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-none p-3 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted border border-border"
                      }`}
                    >
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {msg.content.split(/(\*\*.*?\*\*)/).map((part, j) =>
                          part.startsWith("**") && part.endsWith("**") ? (
                            <strong key={j}>{part.slice(2, -2)}</strong>
                          ) : (
                            part
                          ),
                        )}
                      </div>

                      {/* Detected capability cards */}
                      {msg.capabilityRefs && msg.capabilityRefs.length > 0 && (
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {msg.capabilityRefs.map((c) => (
                            <Link
                              key={c.id}
                              href={`/capability/${c.id}`}
                              className="block p-2 border border-border bg-background hover:bg-accent/[0.05] transition-colors"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold truncate">{c.name}</div>
                                  <div className="text-[10px] text-muted-foreground truncate">
                                    {c.industry ?? "—"}
                                  </div>
                                </div>
                                <ArrowUpRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              </div>
                              {c.benchmarkScore != null && (
                                <div className="font-mono text-[10px] mt-1 text-accent">
                                  benchmark {Number(c.benchmarkScore).toFixed(0)}
                                </div>
                              )}
                            </Link>
                          ))}
                        </div>
                      )}

                      {/* Citation chips */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {msg.citations.slice(0, 8).map((cite, k) => {
                            const matched = capIndex.find(
                              (cap) => cap.name.toLowerCase() === cite.label.toLowerCase(),
                            );
                            const chip = (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 border border-accent/40 bg-accent/[0.06] text-[10px] font-mono"
                                title={cite.detail ?? ""}
                              >
                                {cite.label}
                                {cite.detail && (
                                  <span className="text-muted-foreground">· {cite.detail}</span>
                                )}
                              </span>
                            );
                            return matched ? (
                              <Link key={k} href={`/capability/${matched.id}`} className="hover:opacity-80">
                                {chip}
                              </Link>
                            ) : (
                              <span key={k}>{chip}</span>
                            );
                          })}
                        </div>
                      )}

                      {/* Follow-up suggestions */}
                      {msg.followUps && msg.followUps.length > 0 && (
                        <div className="mt-3">
                          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
                            You might also ask
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.followUps.slice(0, 3).map((fu, k) => (
                              <button
                                key={k}
                                onClick={() => ask(fu)}
                                disabled={loading}
                                className="px-2 py-1 text-[11px] border border-border bg-background hover:bg-accent/[0.06] hover:border-accent text-left max-w-full"
                              >
                                {fu}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.role === "assistant" && (msg.durationMs !== undefined || msg.classification) && (
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                          {msg.classification && (
                            <span className="font-mono uppercase tracking-wider">{msg.classification}</span>
                          )}
                          {msg.durationMs !== undefined && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" /> {(msg.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-muted border border-border rounded-none p-3">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input bar */}
              <form onSubmit={handleSubmit} className="border-t border-border p-3 flex gap-2 items-center">
                <Button
                  type="button"
                  variant={recording ? "default" : "outline"}
                  size="icon"
                  onClick={startVoice}
                  className="rounded-none"
                  title={recording ? "Stop recording" : "Voice input"}
                >
                  {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    active && active.messages.length > 0
                      ? "Ask a follow-up…"
                      : "Ask about capabilities, EVaR, moats, AI risk…"
                  }
                  disabled={loading}
                  className="flex-1 rounded-none"
                  data-testid="nl-input"
                />
                <Button type="submit" disabled={loading || !input.trim()} className="rounded-none">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
