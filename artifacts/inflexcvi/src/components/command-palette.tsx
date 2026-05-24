/**
 * <CommandPalette /> — global ⌘K command palette.
 *
 * Press ⌘K (Ctrl+K on Windows/Linux) anywhere on the platform to open.
 * Two modes:
 *   1. NAVIGATE — type a page name (cvi, scorecard, disruption-lab, …)
 *      or a capability name (telehealth, fraud prevention, …) or an
 *      industry name. Pressing Enter jumps to the result.
 *   2. ASK — type `?` followed by a question → routes to /nl-query with
 *      session context (industry, watchlist). Same backend as the
 *      header's GlobalQABar.
 *
 * Designed as the keyboard-first primary navigation alongside the menu.
 * On 80+ pages, the menu is for browsing; this is for doing.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Flame, Activity, Zap, Shield, TrendingUp, Search, Sparkles, ScrollText, ShieldCheck, Network, Telescope, Layers, Crosshair, Library, Bell, Settings, GitBranch, Globe2, Rocket, Beaker } from "lucide-react";

interface PageEntry {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "index" | "tools" | "evidence" | "operations" | "community" | "account";
  keywords?: string;
}

interface Capability { id: number; name: string; industryName?: string }
interface Industry { id: number; name: string; slug: string }

const API_BASE = "/api";

const PAGES: PageEntry[] = [
  // ─── The Index ───
  { label: "Capability Value Index (CVI)", href: "/cvi", icon: Activity, group: "index", keywords: "score live dashboard" },
  { label: "Scorecard — your org's gaps", href: "/scorecard", icon: Crosshair, group: "index" },
  { label: "Alpha — EVaR + quadrant", href: "/alpha", icon: TrendingUp, group: "index" },
  { label: "Disruption Watch", href: "/disruption", icon: Zap, group: "index" },
  { label: "Disruption Index — what's next", href: "/disruption-index", icon: Flame, group: "index" },
  { label: "Regulations + compliance gaps", href: "/regulations", icon: ScrollText, group: "index" },
  { label: "Industries browse", href: "/industries", icon: Globe2, group: "index" },
  { label: "Knowledge Graph", href: "/knowledge-graph", icon: Network, group: "index" },
  // ─── The Tools ───
  { label: "Upload — analyze your plan", href: "/upload", icon: Library, group: "tools" },
  { label: "Disruption Lab — what-if", href: "/disruption-lab", icon: Beaker, group: "tools" },
  { label: "Disruption Simulator — time-axis", href: "/disruption-simulator", icon: Rocket, group: "tools" },
  { label: "What-If — capability cascade", href: "/whatif", icon: GitBranch, group: "tools" },
  { label: "Simulation — 12mo CVI forecast", href: "/simulation", icon: Telescope, group: "tools" },
  { label: "VCR — venture research campaigns", href: "/vcr", icon: Sparkles, group: "tools" },
  { label: "NL Query — ask anything", href: "/nl-query", icon: Search, group: "tools", keywords: "qa chat assistant" },
  // ─── The Evidence ───
  { label: "Methodology", href: "/methodology", icon: ShieldCheck, group: "evidence" },
  { label: "Provenance — sources", href: "/provenance", icon: ShieldCheck, group: "evidence" },
  { label: "Backtest harness", href: "/backtest", icon: Shield, group: "evidence" },
  { label: "Proof gallery", href: "/proof", icon: Shield, group: "evidence" },
  { label: "Architecture diagram", href: "/architecture", icon: Layers, group: "evidence" },
  { label: "How it works (9 stages)", href: "/how-it-works", icon: ScrollText, group: "evidence" },
  { label: "System status", href: "/system-status", icon: Activity, group: "evidence" },
  // ─── The Operations ───
  { label: "Insights stream", href: "/insights", icon: Sparkles, group: "operations" },
  { label: "Agent Radar — live brain", href: "/agent-radar", icon: Activity, group: "operations" },
  { label: "Watchlist", href: "/watchlist", icon: Bell, group: "operations" },
  { label: "Exports + scheduled digest", href: "/exports", icon: Library, group: "operations" },
  { label: "Notifications", href: "/notifications", icon: Bell, group: "operations" },
  { label: "Inbox", href: "/inbox", icon: Bell, group: "operations" },
  // ─── The Community ───
  { label: "Forum", href: "/forum", icon: Network, group: "community" },
  { label: "Member feed", href: "/feed", icon: Network, group: "community" },
  { label: "Network graph", href: "/network", icon: Network, group: "community" },
  { label: "Search members", href: "/search-members", icon: Search, group: "community" },
  { label: "Marketplace", href: "/marketplace", icon: Library, group: "community" },
  { label: "Collaboration boards", href: "/collaboration", icon: Network, group: "community" },
  // ─── Account ───
  { label: "Account settings", href: "/account", icon: Settings, group: "account" },
  { label: "Membership / billing", href: "/membership", icon: Settings, group: "account" },
  { label: "Organization", href: "/organization", icon: Settings, group: "account" },
];

const GROUP_LABELS: Record<PageEntry["group"], string> = {
  index: "The Index — read the numbers",
  tools: "The Tools — test something",
  evidence: "The Evidence — prove it",
  operations: "Operations — ongoing surfaces",
  community: "Community + marketplace",
  account: "Account",
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);

  // Lazy-load catalog on first open.
  useEffect(() => {
    if (!open || capabilities.length > 0) return;
    fetch(`${API_BASE}/capabilities`)
      .then((r) => r.json())
      .then((rows: Array<{ id: number; name: string; industryName?: string; isLeaf?: boolean }>) =>
        setCapabilities(rows.filter((c) => c.isLeaf !== false).slice(0, 400)),
      )
      .catch(() => {});
    fetch(`${API_BASE}/industries`)
      .then((r) => r.json())
      .then(setIndustries)
      .catch(() => {});
  }, [open, capabilities.length]);

  // Global ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Ask mode: query starts with "?" → route to /nl-query with pre-filled q.
  const isAskMode = query.trimStart().startsWith("?");
  const askQuery = isAskMode ? query.trimStart().slice(1).trim() : "";

  const grouped = useMemo(() => {
    const groups = new Map<PageEntry["group"], PageEntry[]>();
    for (const p of PAGES) {
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group)!.push(p);
    }
    return groups;
  }, []);

  const handleNavigate = (href: string) => {
    setOpen(false);
    setQuery("");
    navigate(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder='Jump to a page or capability — type "?" to ask a question'
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isAskMode ? (
          <CommandGroup heading="Ask the platform">
            <CommandItem
              onSelect={() => handleNavigate(`/nl-query?q=${encodeURIComponent(askQuery)}`)}
              className="font-medium"
            >
              <Sparkles className="w-4 h-4 mr-2 text-accent" />
              {askQuery || "Type your question…"}
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            <CommandEmpty>No matches. Type "?" to ask a question instead.</CommandEmpty>

            {Array.from(grouped.entries()).map(([group, pages]) => (
              <CommandGroup key={group} heading={GROUP_LABELS[group]}>
                {pages.map((p) => {
                  const Icon = p.icon;
                  return (
                    <CommandItem
                      key={p.href}
                      value={`${p.label} ${p.keywords ?? ""}`}
                      onSelect={() => handleNavigate(p.href)}
                    >
                      <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
                      {p.label}
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">{p.href}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}

            {capabilities.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Capabilities">
                  {capabilities.slice(0, 20).map((c) => (
                    <CommandItem
                      key={`cap-${c.id}`}
                      value={`capability ${c.name} ${c.industryName ?? ""}`}
                      onSelect={() => handleNavigate(`/capability/${c.id}`)}
                    >
                      <Layers className="w-4 h-4 mr-2 text-muted-foreground" />
                      {c.name}
                      {c.industryName && <span className="ml-auto text-xs text-muted-foreground">{c.industryName}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {industries.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Industries">
                  {industries.map((i) => (
                    <CommandItem
                      key={`ind-${i.id}`}
                      value={`industry ${i.name}`}
                      onSelect={() => handleNavigate(`/industries/${i.slug}`)}
                    >
                      <Globe2 className="w-4 h-4 mr-2 text-muted-foreground" />
                      {i.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
      <div className="border-t border-border px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-3">
        <span><kbd className="px-1 bg-muted">⌘K</kbd> open</span>
        <span><kbd className="px-1 bg-muted">↑↓</kbd> navigate</span>
        <span><kbd className="px-1 bg-muted">↵</kbd> go</span>
        <span><kbd className="px-1 bg-muted">?</kbd> ask anything</span>
        <span className="ml-auto"><kbd className="px-1 bg-muted">esc</kbd> close</span>
      </div>
    </CommandDialog>
  );
}

// Avoid TS unused-import warning when Command isn't directly referenced.
void Command;
