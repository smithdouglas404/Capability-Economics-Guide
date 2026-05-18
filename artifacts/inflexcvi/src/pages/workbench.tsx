import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Plus,
  Search,
  Loader2,
  X,
  Trash2,
  Sparkles,
  Lightbulb,
  Telescope,
  Layers,
  ShieldCheck,
  Rocket,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Pin,
  Share2,
  Users,
  User as UserIcon,
  Store,
  Send,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useAuth, useUser } from "@clerk/react";

const API_BASE = "/api";

type Lane = "scan" | "frame" | "ideate" | "validate" | "launch";
type InsightKind = "generate_applications" | "find_analogues" | "critique_idea" | "what_to_invent" | "lifecycle_outlook";

interface BoardListEntry {
  id: number;
  clerkUserId: string;
  clerkOrgId: string | null;
  name: string;
  description: string | null;
  pinned: string | null;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  ownerType: "personal" | "team";
  isMine: boolean;
}

interface CardInsight {
  id: number;
  kind: InsightKind;
  body: string;
  bullets: string[];
  modelUsed: string | null;
  userPrompt: string | null;
  targetIndustryName: string | null;
  targetMarketDescription: string | null;
  generatedBy: string;
  generatedAt: string;
}

interface CardWithCap {
  id: number;
  boardId: number;
  capabilityId: number;
  lane: Lane;
  position: number;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  capability: {
    id: number;
    name: string;
    slug: string;
    description: string;
    industryId: number;
    industryName: string;
    lifecycleStage: string;
    consensusScore: number | null;
    velocity: number | null;
    ciLow: number | null;
    ciHigh: number | null;
  } | null;
  insights: CardInsight[];
}

interface BoardDetail {
  board: BoardListEntry;
  cards: CardWithCap[];
}

interface CapabilityListItem {
  id: number;
  name: string;
  slug: string;
  industryId: number;
}

const LANES: Array<{ key: Lane; label: string; description: string; Icon: typeof Telescope; tone: string }> = [
  { key: "scan", label: "Scan", description: "What are you observing?", Icon: Telescope, tone: "bg-sky-500/10 text-sky-500 border-sky-500/30" },
  { key: "frame", label: "Frame", description: "What problems / markets?", Icon: Layers, tone: "bg-violet-500/10 text-violet-500 border-violet-500/30" },
  { key: "ideate", label: "Ideate", description: "Concepts pairing capability + market", Icon: Lightbulb, tone: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  { key: "validate", label: "Validate", description: "Concepts with evidence", Icon: ShieldCheck, tone: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
  { key: "launch", label: "Launch", description: "Committed initiatives", Icon: Rocket, tone: "bg-rose-500/10 text-rose-500 border-rose-500/30" },
];

const INSIGHT_KIND_LABEL: Record<InsightKind, string> = {
  generate_applications: "10 unexpected applications",
  find_analogues: "Cross-industry analogues",
  critique_idea: "Critique my idea",
  what_to_invent: "What to invent",
  lifecycle_outlook: "Leading or declining?",
};

const INSIGHT_KIND_HELP: Record<InsightKind, string> = {
  generate_applications: "Brainstorm 10 unexpected applications — obvious plus stretches.",
  find_analogues: "Where does this capability exist in another industry?",
  critique_idea: "Sanity-check an idea against displaceability, defensibility, time-to-traction.",
  what_to_invent: "Suggest a NEW capability that would have to exist to disrupt a target market (Uber pattern).",
  lifecycle_outlook: "Is this capability leading, peaking, or declining — and why?",
};

const LIFECYCLE_TONE: Record<string, string> = {
  emerging: "bg-violet-500/15 text-violet-500 border-violet-500/40",
  adopted: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  mature: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  decaying: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  obsolete: "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

export default function WorkbenchPage() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const initialBoardId = Number(new URLSearchParams(search).get("board")) || null;

  const [boards, setBoards] = useState<BoardListEntry[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(initialBoardId);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [newBoardName, setNewBoardName] = useState("");
  const [capabilities, setCapabilities] = useState<CapabilityListItem[]>([]);
  const [capPicker, setCapPicker] = useState("");
  const [pickerLane, setPickerLane] = useState<Lane>("scan");

  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [generating, setGenerating] = useState<InsightKind | null>(null);
  const [userPromptByKind, setUserPromptByKind] = useState<Partial<Record<InsightKind, string>>>({});
  const [exportOpen, setExportOpen] = useState(false);

  const authedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const token = await getToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
    });
  }, [getToken]);

  const loadBoards = useCallback(async () => {
    try {
      const r = await authedFetch(`${API_BASE}/workbench/boards`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { boards: BoardListEntry[] };
      setBoards(j.boards);
      if (j.boards.length > 0 && !selectedBoardId) setSelectedBoardId(j.boards[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load boards");
    }
  }, [authedFetch, selectedBoardId]);

  const loadDetail = useCallback(async (boardId: number) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await authedFetch(`${API_BASE}/workbench/boards/${boardId}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setDetail(await r.json() as BoardDetail);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load board");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { setLoading(false); return; }
    void loadBoards();
    fetch(`${API_BASE}/capabilities`).then(r => r.json()).then((d: CapabilityListItem[]) => setCapabilities(d ?? [])).catch(() => {});
  }, [isLoaded, user, loadBoards]);

  useEffect(() => {
    if (selectedBoardId) {
      void loadDetail(selectedBoardId);
      const params = new URLSearchParams(window.location.search);
      params.set("board", String(selectedBoardId));
      setLocation(`/workbench?${params.toString()}`, { replace: true });
    } else {
      setDetail(null);
    }
  }, [selectedBoardId, loadDetail, setLocation]);

  async function createBoard() {
    if (!newBoardName.trim()) return;
    const r = await authedFetch(`${API_BASE}/workbench/boards`, {
      method: "POST",
      body: JSON.stringify({ name: newBoardName.trim() }),
    });
    if (!r.ok) { setErr(await r.text()); return; }
    const j = (await r.json()) as { board: BoardListEntry };
    setNewBoardName("");
    await loadBoards();
    setSelectedBoardId(j.board.id);
  }

  async function addCard(capabilityId: number) {
    if (!selectedBoardId) return;
    const r = await authedFetch(`${API_BASE}/workbench/boards/${selectedBoardId}/cards`, {
      method: "POST",
      body: JSON.stringify({ capabilityId, lane: pickerLane }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j?.error ?? `HTTP ${r.status}`);
      return;
    }
    setCapPicker("");
    void loadDetail(selectedBoardId);
  }

  async function moveCard(cardId: number, newLane: Lane) {
    await authedFetch(`${API_BASE}/workbench/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ lane: newLane, position: 999 }),
    });
    if (selectedBoardId) void loadDetail(selectedBoardId);
  }

  async function deleteCard(cardId: number) {
    if (!confirm("Remove this capability from the board?")) return;
    await authedFetch(`${API_BASE}/workbench/cards/${cardId}`, { method: "DELETE" });
    if (selectedBoardId) void loadDetail(selectedBoardId);
    if (activeCardId === cardId) setActiveCardId(null);
  }

  async function updateNotes(cardId: number, notes: string) {
    await authedFetch(`${API_BASE}/workbench/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    });
  }

  async function generateInsight(card: CardWithCap, kind: InsightKind) {
    if (!card.capability) return;
    setGenerating(kind);
    try {
      const body: Record<string, unknown> = { kind };
      const userPrompt = userPromptByKind[kind]?.trim();
      if (userPrompt) body.userPrompt = userPrompt;
      const r = await authedFetch(`${API_BASE}/workbench/cards/${card.id}/insights`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      if (selectedBoardId) await loadDetail(selectedBoardId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(null);
    }
  }

  async function regenerateInsight(card: CardWithCap, kind: InsightKind) {
    if (!card.capability) return;
    setGenerating(kind);
    try {
      const body: Record<string, unknown> = { kind, force: true };
      const userPrompt = userPromptByKind[kind]?.trim();
      if (userPrompt) body.userPrompt = userPrompt;
      await authedFetch(`${API_BASE}/workbench/cards/${card.id}/insights`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (selectedBoardId) await loadDetail(selectedBoardId);
    } finally {
      setGenerating(null);
    }
  }

  async function deleteInsight(insightId: number) {
    await authedFetch(`${API_BASE}/workbench/insights/${insightId}`, { method: "DELETE" });
    if (selectedBoardId) await loadDetail(selectedBoardId);
  }

  const cardsByLane = useMemo(() => {
    const m = new Map<Lane, CardWithCap[]>();
    for (const lane of LANES) m.set(lane.key, []);
    for (const c of detail?.cards ?? []) {
      const arr = m.get(c.lane as Lane) ?? [];
      arr.push(c);
      m.set(c.lane as Lane, arr);
    }
    return m;
  }, [detail]);

  const activeCard = useMemo(() => {
    if (activeCardId === null) return null;
    return detail?.cards.find(c => c.id === activeCardId) ?? null;
  }, [activeCardId, detail]);

  const filteredPicker = capPicker.trim().length === 0
    ? []
    : capabilities
        .filter(c => c.name.toLowerCase().includes(capPicker.trim().toLowerCase()))
        .filter(c => !detail?.cards.some(card => card.capabilityId === c.id))
        .slice(0, 6);

  if (!isLoaded) {
    return <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  if (!user) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <h1 className="font-serif text-3xl tracking-tight mb-2">Capability Workbench</h1>
        <p className="text-sm text-muted-foreground mb-4">Sign in to create boards and brainstorm with Claude.</p>
        <Link href="/sign-in"><Button>Sign in</Button></Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-[1600px]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Home
          </Link>
          <h1 className="font-serif text-3xl tracking-tight flex items-center gap-2">
            <Lightbulb className="w-6 h-6 text-amber-500" />
            Capability Workbench
          </h1>
          <p className="text-sm text-muted-foreground">Design-thinking ideation across the capability graph. Drag capabilities through lanes. Ask Claude for unexpected applications, cross-industry analogues, and what to invent.</p>
        </div>
      </div>

      {err && (
        <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-2 mb-4 text-sm font-mono">{err}</div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* Boards rail */}
        <aside className="col-span-12 lg:col-span-2 space-y-3">
          <Card className="rounded-none border-border/60">
            <CardContent className="p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Boards</div>
              {boards.length === 0 && <p className="text-xs text-muted-foreground">No boards yet.</p>}
              {boards.map(b => (
                <button
                  key={b.id}
                  onClick={() => { setSelectedBoardId(b.id); setActiveCardId(null); }}
                  className={`w-full text-left px-2 py-1.5 text-sm border ${selectedBoardId === b.id ? "border-primary bg-primary/5" : "border-border/40 hover:bg-muted/50"}`}
                >
                  <div className="flex items-center gap-1.5">
                    {b.ownerType === "team" ? <Users className="w-3 h-3 text-sky-500" /> : <UserIcon className="w-3 h-3 text-muted-foreground" />}
                    <span className="truncate">{b.name}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{b.cardCount} cards</div>
                </button>
              ))}
              <Separator className="my-2" />
              <Input
                value={newBoardName}
                onChange={e => setNewBoardName(e.target.value)}
                placeholder="New board name…"
                className="rounded-none text-sm h-8"
                onKeyDown={e => { if (e.key === "Enter") createBoard(); }}
              />
              <Button size="sm" onClick={createBoard} disabled={!newBoardName.trim()} className="rounded-none w-full text-xs h-7">
                <Plus className="w-3 h-3 mr-1" />
                Create board
              </Button>
            </CardContent>
          </Card>
        </aside>

        {/* Kanban */}
        <main className="col-span-12 lg:col-span-7 space-y-3">
          {loading && <div className="text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading board…</div>}

          {detail && (
            <>
              <Card className="rounded-none border-border/60">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-serif text-xl tracking-tight">{detail.board.name}</div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                        {detail.board.ownerType === "team" ? <><Users className="w-3 h-3 mr-1 inline" /> team</> : <><UserIcon className="w-3 h-3 mr-1 inline" /> personal</>}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExportOpen(v => !v)}
                        disabled={!detail.cards || detail.cards.length === 0}
                        className="rounded-none h-7 font-mono text-[10px] uppercase tracking-wider"
                        title={detail.cards.length === 0 ? "Add at least one capability before exporting" : "Export this board as a marketplace listing"}
                      >
                        <Store className="w-3 h-3 mr-1" />
                        Export
                      </Button>
                    </div>
                  </div>
                  {exportOpen && detail && (
                    <ExportForm
                      board={detail.board}
                      cardCount={detail.cards.length}
                      authedFetch={authedFetch}
                      onSuccess={(listingId) => {
                        setExportOpen(false);
                        setLocation(`/marketplace/listings/${listingId}`);
                      }}
                      onCancel={() => setExportOpen(false)}
                    />
                  )}
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="flex-1 min-w-[200px] relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={capPicker}
                        onChange={e => setCapPicker(e.target.value)}
                        placeholder="Add capability to board…"
                        className="rounded-none pl-9 h-8 text-sm"
                      />
                      {filteredPicker.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-background border border-border/60 shadow-md">
                          {filteredPicker.map(c => (
                            <button key={c.id} onClick={() => addCard(c.id)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50">
                              <Plus className="w-3 h-3 inline mr-1" />
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <select value={pickerLane} onChange={e => setPickerLane(e.target.value as Lane)} className="h-8 px-2 text-sm border border-input bg-background rounded-none">
                        {LANES.map(l => <option key={l.key} value={l.key}>add to {l.label}</option>)}
                      </select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-5 gap-2 min-h-[60vh]">
                {LANES.map(lane => {
                  const cards = cardsByLane.get(lane.key) ?? [];
                  const LaneIcon = lane.Icon;
                  return (
                    <div
                      key={lane.key}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault();
                        const cardId = Number(e.dataTransfer.getData("text/plain"));
                        if (Number.isInteger(cardId)) void moveCard(cardId, lane.key);
                      }}
                      className="border border-border/40 bg-muted/20 rounded-none flex flex-col"
                    >
                      <div className={`px-2 py-2 border-b border-border/40 ${lane.tone} rounded-none`}>
                        <div className="flex items-center gap-1.5">
                          <LaneIcon className="w-3.5 h-3.5" />
                          <span className="font-mono text-[11px] uppercase tracking-[0.18em] font-medium">{lane.label}</span>
                          <span className="ml-auto font-mono text-[10px] tabular-nums">{cards.length}</span>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground tracking-wider mt-0.5">{lane.description}</div>
                      </div>
                      <div className="p-1.5 flex-1 space-y-1.5">
                        {cards.length === 0 && (
                          <div className="text-[10px] text-muted-foreground italic text-center py-4">Drop here</div>
                        )}
                        {cards.map(card => {
                          const cap = card.capability;
                          return (
                            <div
                              key={card.id}
                              draggable
                              onDragStart={e => e.dataTransfer.setData("text/plain", String(card.id))}
                              onClick={() => setActiveCardId(card.id)}
                              className={`p-2 bg-background border ${activeCardId === card.id ? "border-primary" : "border-border/60"} cursor-pointer hover:border-primary/50`}
                            >
                              <div className="text-xs font-medium leading-tight">{cap?.name ?? `#${card.capabilityId}`}</div>
                              <div className="font-mono text-[11px] text-muted-foreground mt-0.5 truncate">{cap?.industryName}</div>
                              <div className="flex items-center gap-1 mt-1">
                                {cap?.lifecycleStage && (
                                  <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider px-1 py-0 ${LIFECYCLE_TONE[cap.lifecycleStage] ?? "bg-muted text-muted-foreground border-border/60"}`}>
                                    {cap.lifecycleStage}
                                  </Badge>
                                )}
                                {cap?.consensusScore !== null && cap?.consensusScore !== undefined && (
                                  <span className="font-mono text-[10px] tabular-nums ml-auto">{cap.consensusScore.toFixed(0)}</span>
                                )}
                              </div>
                              {card.insights.length > 0 && (
                                <div className="font-mono text-[11px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                                  <Sparkles className="w-2.5 h-2.5" /> {card.insights.length}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!detail && !loading && boards.length === 0 && (
            <Card className="rounded-none border-amber-500/40 bg-amber-500/[0.04]">
              <CardContent className="p-8 text-center space-y-4">
                <Sparkles className="w-6 h-6 text-amber-500 mx-auto" />
                <h2 className="font-serif text-2xl tracking-tight">First time here? Take the 90-second onboarding.</h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">Pick your industry, we seed 5 capabilities and run Claude on the first one so you land on real content — not an empty kanban.</p>
                <div className="flex items-center justify-center gap-2">
                  <Link href="/onboarding">
                    <Button size="lg" className="rounded-none font-mono text-[11px] uppercase tracking-wider">
                      Start onboarding
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </Link>
                  <Link href="/workbench/example">
                    <Button size="lg" variant="outline" className="rounded-none font-mono text-[11px] uppercase tracking-wider">
                      Or see an example
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
          {!detail && !loading && boards.length > 0 && (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-3">
                <p>Pick a board on the left, or create a new one.</p>
              </CardContent>
            </Card>
          )}
        </main>

        {/* Card detail panel */}
        <aside className="col-span-12 lg:col-span-3">
          {activeCard ? (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Card</div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => deleteCard(activeCard.id)} className="rounded-none h-6 px-1 text-rose-500">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setActiveCardId(null)} className="rounded-none h-6 px-1">
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {activeCard.capability ? (
                  <div>
                    <Link href={`/capability/${activeCard.capability.id}`} className="font-serif text-lg hover:underline">{activeCard.capability.name}</Link>
                    <div className="text-xs text-muted-foreground">{activeCard.capability.industryName}</div>
                    <p className="text-xs mt-1.5 line-clamp-3">{activeCard.capability.description}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Capability missing.</p>
                )}

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Your notes</div>
                  <Textarea
                    defaultValue={activeCard.notes ?? ""}
                    onBlur={e => updateNotes(activeCard.id, e.target.value)}
                    rows={3}
                    placeholder="Hypotheses, leads, customer quotes…"
                    className="rounded-none text-xs"
                  />
                </div>

                <Separator />

                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Claude actions</div>
                  <div className="space-y-2">
                    {(Object.keys(INSIGHT_KIND_LABEL) as InsightKind[]).map(kind => {
                      const isThisGenerating = generating === kind;
                      const showPromptInput = kind === "critique_idea" || kind === "what_to_invent" || kind === "find_analogues";
                      const hasInsight = activeCard.insights.some(i => i.kind === kind);
                      return (
                        <div key={kind} className="border border-border/40 p-2 space-y-1.5">
                          <div className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-500" />
                            <span className="text-xs font-medium">{INSIGHT_KIND_LABEL[kind]}</span>
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground leading-relaxed">{INSIGHT_KIND_HELP[kind]}</div>
                          {showPromptInput && (
                            <Input
                              value={userPromptByKind[kind] ?? ""}
                              onChange={e => setUserPromptByKind(prev => ({ ...prev, [kind]: e.target.value }))}
                              placeholder={kind === "what_to_invent" ? "target market…" : kind === "find_analogues" ? "target industry…" : "your idea…"}
                              className="rounded-none text-xs h-7"
                            />
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!generating}
                            onClick={() => generateInsight(activeCard, kind)}
                            className="rounded-none text-[11px] h-7 w-full"
                          >
                            {isThisGenerating ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : hasInsight ? <RefreshCw className="w-3 h-3 mr-1" /> : <ArrowRight className="w-3 h-3 mr-1" />}
                            {hasInsight ? "View cached" : "Generate"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {activeCard.insights.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Insights ({activeCard.insights.length})</div>
                      <div className="space-y-3">
                        {activeCard.insights.map(ins => (
                          <div key={ins.id} className="border border-border/40 p-2 space-y-1">
                            <div className="flex items-center justify-between">
                              <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider">{INSIGHT_KIND_LABEL[ins.kind]}</Badge>
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="ghost" onClick={() => regenerateInsight(activeCard, ins.kind)} disabled={!!generating} className="rounded-none h-6 px-1">
                                  <RefreshCw className="w-3 h-3" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteInsight(ins.id)} className="rounded-none h-6 px-1 text-rose-500">
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                            {ins.bullets.length > 0 ? (
                              <ol className="list-decimal list-outside ml-4 space-y-0.5 text-xs leading-relaxed">
                                {ins.bullets.map((b, idx) => <li key={idx}>{b}</li>)}
                              </ol>
                            ) : (
                              <p className="text-xs whitespace-pre-wrap leading-relaxed">{ins.body}</p>
                            )}
                            <div className="font-mono text-[11px] text-muted-foreground">{ins.modelUsed} · {new Date(ins.generatedAt).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-6 text-xs text-muted-foreground text-center">
                Click a card to open it and run Claude actions.
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Export-to-marketplace inline form ───────────────────────────────────────

interface ExportFormProps {
  board: { id: number; name: string };
  cardCount: number;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onSuccess: (listingId: number) => void;
  onCancel: () => void;
}

function ExportForm({ board, cardCount, authedFetch, onSuccess, onCancel }: ExportFormProps) {
  const [title, setTitle] = useState(`${board.name} — workbench export`);
  const [description, setDescription] = useState("");
  const [executiveSummary, setExecutiveSummary] = useState("");
  const [priceDollars, setPriceDollars] = useState("99.00");
  const [type, setType] = useState<"report" | "dataset" | "template">("report");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const cents = Math.round(Number(priceDollars) * 100);
    if (!title.trim() || description.trim().length < 10 || !Number.isFinite(cents) || cents < 100) {
      setErr("Title required, description must be ≥10 chars, price must be ≥ $1.00");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await authedFetch(`/api/workbench/boards/${board.id}/export-to-marketplace`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priceCents: cents,
          type,
          executiveSummary: executiveSummary.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (r.status === 409 && j.onboardingPath) {
          throw new Error(`${j.error} — start at ${j.onboardingPath}`);
        }
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { listing: { id: number } };
      onSuccess(j.listing.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Store className="w-3.5 h-3.5 text-amber-500" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-500 font-medium">Export to marketplace</span>
        <span className="font-mono text-[11px] text-muted-foreground ml-auto">{cardCount} card{cardCount === 1 ? "" : "s"} will be included</span>
      </div>
      <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Listing title" className="rounded-none text-sm h-8" />
      <Textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Marketplace description — what's inside, who it's for, what the buyer takes away. (≥10 characters)"
        rows={3}
        className="rounded-none text-xs"
      />
      <Textarea
        value={executiveSummary}
        onChange={e => setExecutiveSummary(e.target.value)}
        placeholder="Optional executive summary that will appear on page 2 of the exported PDF."
        rows={2}
        className="rounded-none text-xs"
      />
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-0.5">Type</label>
          <select value={type} onChange={e => setType(e.target.value as typeof type)} className="h-8 px-2 text-sm border border-input bg-background rounded-none">
            <option value="report">Report</option>
            <option value="dataset">Dataset</option>
            <option value="template">Template</option>
          </select>
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground block mb-0.5">Price (USD)</label>
          <Input type="number" min="1" step="0.01" value={priceDollars} onChange={e => setPriceDollars(e.target.value)} className="rounded-none h-8 text-sm w-24 font-mono" />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy} className="rounded-none h-8 text-xs">Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy} className="rounded-none h-8 font-mono text-[11px] uppercase tracking-wider">
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
            Generate & create draft
          </Button>
        </div>
      </div>
      {err && <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-2 py-1 text-xs font-mono">{err}</div>}
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        Creates a draft listing — review on marketplace, then submit for admin approval.
      </p>
    </div>
  );
}
