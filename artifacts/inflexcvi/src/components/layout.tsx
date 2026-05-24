import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { SignInButton, SignOutButton, useUser, useAuth } from "@clerk/react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  Activity, Network, Scale,
  Building2, Layers, Bell, MessageCircle,
  ScanSearch, Inbox, Shield,
  Users,
  Swords, FlaskConical, Target, Rocket, BarChart3, PieChart,
  Lightbulb, MessageSquare, Zap, BookOpen,
  Settings2, ChevronDown, CreditCard, LogOut, Sparkles,
  Store, Menu,
  TrendingUp, Flame, Globe2, Beaker, GitBranch, ScrollText, Radio, Download,
  Settings,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetTrigger, SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DegradedServiceBanner } from "@/components/degraded-banner";
import { VoiceAdvisor } from "@/components/voice-advisor";
import { MobileNotice } from "@/components/mobile";
import { AITourGuide } from "@/components/ai-tour-guide";
import { NotificationBell } from "@/components/notification-bell";
import { GlobalQABar } from "@/components/global-qa-bar";
import { PersonaTopSwitcher } from "@/components/persona-top-switcher";
import { CommandPalette } from "@/components/command-palette";

// Pages explicitly tuned for mobile. Everything else gets the
// "best on desktop" notice on small screens.
const MOBILE_TUNED_PREFIXES = [
  "/cvi", "/alpha", "/knowledge-graph", "/companies",
  "/scorecard", "/insights", "/membership", "/account",
  "/methodology", "/coverage", "/marketplace",
];
function isMobileTuned(path: string): boolean {
  if (path === "/") return true;
  return MOBILE_TUNED_PREFIXES.some(p => path === p || path.startsWith(p + "/"));
}

type NavChild = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; description?: string };
type NavGroup = { label: string; href?: string; children?: NavChild[]; matchPaths: string[] };

// ─── 6-tier IA (uplift): Index → Tools → Evidence → Operations → Community → Account
// Each page lives in exactly one tier, named by the user's job-to-be-done
// rather than the implementation. Maps to the natural reading order an
// investor / buyer follows when first evaluating the platform.
const navGroups: NavGroup[] = [
  {
    label: "Index",
    matchPaths: ["/cvi", "/scorecard", "/alpha", "/disruption", "/disruption-index", "/capability", "/regulations", "/industries", "/knowledge-graph"],
    children: [
      { href: "/cvi", label: "CVI Dashboard", icon: Activity, description: "Live composite index — current state of every tracked capability" },
      { href: "/scorecard", label: "Scorecard", icon: Swords, description: "Your org's capability gaps vs. industry benchmarks" },
      { href: "/alpha", label: "Alpha — EVaR + quadrants", icon: TrendingUp, description: "Per-capability revenue-at-risk, moat, fragility, arbitrage, M&A targets" },
      { href: "/disruption", label: "Disruption Watch", icon: Zap, description: "Capabilities actively being disrupted right now + net-new capabilities emerging" },
      { href: "/disruption-index", label: "Disruption Index", icon: Flame, description: "Forward-looking — which capabilities are most likely to be disrupted next + which pattern attacks them" },
      { href: "/regulations", label: "Regulations", icon: Scale, description: "Compliance gaps + enforcement-intensity forecasts per regulation" },
      { href: "/industries", label: "Industries", icon: Globe2, description: "Browse the capability catalog by industry" },
      { href: "/knowledge-graph", label: "Knowledge Graph", icon: Network, description: "Capability relationships, dependencies, and cascades" },
    ],
  },
  {
    label: "Tools",
    matchPaths: ["/upload", "/disruption-lab", "/disruption-simulator", "/whatif", "/simulation", "/vcr", "/workbench", "/nl-query"],
    children: [
      { href: "/upload", label: "Upload — analyze your plan", icon: Sparkles, description: "Drop your business plan / pitch deck — we extract capability claims and match them to the live graph" },
      { href: "/disruption-lab", label: "Disruption Lab", icon: Beaker, description: "Drag-drop a capability + enabling techs, see Disruption Index recompute live" },
      { href: "/disruption-simulator", label: "Disruption Simulator", icon: Rocket, description: "Forward-project 12-60 months — when does an entrant cross over and replace the incumbent" },
      { href: "/whatif", label: "What-If — capability cascade", icon: GitBranch, description: "Change one capability's score, walk the dependency graph, see downstream impact" },
      { href: "/simulation", label: "Simulation — CVI forecast", icon: FlaskConical, description: "Run a 12-month CVI trajectory under a shock event" },
      { href: "/vcr", label: "VCR — research campaigns", icon: ScanSearch, description: "Multi-day venture-capital research campaigns — Perplexity + LLM, agent-run cycles" },
      { href: "/workbench", label: "Capability Workbench", icon: Lightbulb, description: "Drag capabilities through Scan → Frame → Ideate → Validate → Launch with LLM critique" },
      { href: "/nl-query", label: "Ask anything (NL Query)", icon: MessageSquare, description: "Natural-language query over the capability dataset — same backend as the ⌘K bar" },
    ],
  },
  {
    label: "Evidence",
    matchPaths: ["/methodology", "/provenance", "/backtest", "/proof", "/architecture", "/how-it-works", "/system-status", "/security", "/developers", "/lifecycle-docs"],
    children: [
      { href: "/methodology", label: "Methodology", icon: ScrollText, description: "How every score is computed — Bayesian posterior, source weights, confidence formula" },
      { href: "/provenance", label: "Provenance", icon: Shield, description: "Where our data comes from — World Bank, Foundry, EDGAR, Perplexity, etc., with live source-quality stats" },
      { href: "/backtest", label: "Backtest harness", icon: BarChart3, description: "Replay historical events — did the engine call COVID / ChatGPT / SVB the right direction" },
      { href: "/proof", label: "Proof gallery", icon: Target, description: "Curated event-by-event scorecards" },
      { href: "/how-it-works", label: "How it works (9 stages)", icon: Layers, description: "Pipeline walkthrough from world-scan to recommendation" },
      { href: "/architecture", label: "Architecture", icon: Network, description: "Module diagram — every service in the stack, live status" },
      { href: "/system-status", label: "System status", icon: Activity, description: "Per-service health for every integration" },
    ],
  },
  {
    label: "Operations",
    matchPaths: ["/insights", "/agent-radar", "/watchlist", "/exports", "/notifications", "/inbox", "/trade-signals", "/innovation", "/benchmarking", "/roi", "/projects", "/companies", "/collaborate", "/collaboration"],
    children: [
      { href: "/insights", label: "Insights stream", icon: Lightbulb, description: "Curated AI-generated narratives + threshold alerts" },
      { href: "/agent-radar", label: "Agent Radar", icon: Radio, description: "Live brain panel — see the 8 autonomous agents working in real time" },
      { href: "/watchlist", label: "Watchlist", icon: Bell, description: "Saved capabilities + regulations with custom alert thresholds" },
      { href: "/exports", label: "Exports + weekly digest", icon: Download, description: "CSV / Parquet + scheduled weekly digest to your inbox" },
      { href: "/trade-signals", label: "Trade signals", icon: Target, description: "Forward-looking capability-derived market signals" },
      { href: "/benchmarking", label: "Peer benchmarks", icon: BarChart3, description: "Cohort-percentile comparison across (industry, capability) cells" },
      { href: "/projects", label: "Projects", icon: Layers, description: "Active engagements you're tracking" },
      { href: "/companies", label: "Portfolio", icon: Building2, description: "Companies you're tracking + their fingerprinted capabilities" },
      { href: "/collaboration", label: "Collaboration", icon: MessageCircle, description: "Per-capability boards with team comments + strategy decisions" },
      { href: "/notifications", label: "Notifications", icon: Bell, description: "All notifications — connection requests, alerts, mentions" },
      { href: "/inbox", label: "Inbox", icon: MessageCircle, description: "Direct messages with other members" },
    ],
  },
  {
    label: "Community",
    matchPaths: ["/forum", "/feed", "/network", "/search-members", "/marketplace", "/hashtag", "/member"],
    children: [
      { href: "/feed", label: "Feed", icon: Activity, description: "Posts from your connections + members in your industries" },
      { href: "/network", label: "My network", icon: Users, description: "Manage connections + see the network graph" },
      { href: "/search-members", label: "Find members", icon: ScanSearch, description: "Search the directory by name, industry, capability, location" },
      { href: "/forum/banking", label: "Forums", icon: MessageSquare, description: "Per-industry discussion threads" },
      { href: "/marketplace", label: "Marketplace", icon: Store, description: "Buy and sell capability research, datasets, and templates" },
    ],
  },
  {
    label: "Account",
    matchPaths: ["/account", "/membership", "/organization", "/kyc", "/onboarding"],
    children: [
      { href: "/account", label: "Account", icon: Settings, description: "Settings + preferences + credit usage" },
      { href: "/account/profile", label: "Profile", icon: BookOpen, description: "Edit cover image, headline, experience, capabilities you're known for" },
      { href: "/membership", label: "Membership + billing", icon: Settings, description: "Tier + payment + invoices" },
      { href: "/organization", label: "Organization", icon: Building2, description: "Your org setup, members, and team capabilities" },
    ],
  },
];

function useMembershipStatus(): { loading: boolean; status: string | null } {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [state, setState] = useState<{ loading: boolean; status: string | null }>({ loading: true, status: null });
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { setState({ loading: false, status: null }); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/me/membership", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) { if (!cancelled) setState({ loading: false, status: null }); return; }
        const data = await res.json();
        if (!cancelled) setState({ loading: false, status: data.membership?.status ?? null });
      } catch { if (!cancelled) setState({ loading: false, status: null }); }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, isLoaded, getToken]);
  return state;
}

function useCreditBalance(): { balance: number | null; tierSlug: string | null } {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [state, setState] = useState<{ balance: number | null; tierSlug: string | null }>({ balance: null, tierSlug: null });
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/credits/balance", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setState({ balance: data.balance ?? null, tierSlug: data.tierSlug ?? null });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, isLoaded, getToken]);
  return state;
}

function MobileNav({
  navGroups,
  hasAccess,
  isSignedIn,
  isAdmin,
  membershipStatus,
  location,
}: {
  navGroups: NavGroup[];
  hasAccess: boolean;
  isSignedIn: boolean | undefined;
  isAdmin: boolean;
  membershipStatus: string | null;
  location: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          data-testid="nav-mobile-trigger"
          aria-label="Open navigation"
          className="md:hidden -ml-1 p-2 text-muted-foreground hover:text-foreground"
        >
          <Menu className="w-5 h-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[88%] max-w-sm p-0 rounded-none border-r border-border/40 overflow-y-auto"
      >
        <div className="px-5 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-foreground flex items-center justify-center text-background font-serif tracking-tight text-sm">
              CE
            </div>
            <span className="font-serif text-base tracking-tight">Inflexcvi</span>
          </div>
        </div>

        <nav className="px-2 py-4 flex flex-col gap-4">
          {hasAccess ? (
            navGroups.map(group => (
              <div key={group.label} className="flex flex-col">
                <div className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {group.label}
                </div>
                {!group.children && group.href ? (
                  <SheetClose asChild>
                    <Link href={group.href}>
                      <div
                        data-testid={`nav-mobile-${group.label.toLowerCase()}`}
                        className={`px-3 py-2 text-sm cursor-pointer ${
                          location === group.href ? "bg-muted/60 text-foreground" : "text-foreground/80"
                        }`}
                      >
                        {group.label}
                      </div>
                    </Link>
                  </SheetClose>
                ) : (
                  group.children!.map(child => {
                    const Icon = child.icon;
                    const childActive = location === child.href;
                    return (
                      <SheetClose asChild key={child.href}>
                        <Link href={child.href}>
                          <div
                            data-testid={`nav-mobile-link-${child.label.replace(/\s+/g, "-").toLowerCase()}`}
                            className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer ${
                              childActive ? "bg-muted/60" : "hover:bg-muted/40"
                            }`}
                          >
                            <Icon className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
                            <div className="flex flex-col">
                              <span className="text-sm leading-tight">{child.label}</span>
                              {child.description && (
                                <span className="text-xs text-muted-foreground leading-tight mt-0.5">
                                  {child.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      </SheetClose>
                    );
                  })
                )}
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {isSignedIn
                ? membershipStatus === "pending"
                  ? "Membership pending review."
                  : "Apply for membership to unlock the platform."
                : "Sign in or apply for membership to access the platform."}
            </div>
          )}

          <div className="border-t border-border/40 pt-3 mt-2 px-1 flex flex-col gap-1">
            <SheetClose asChild>
              <Link href="/membership">
                <div className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                  <CreditCard className="w-4 h-4 text-accent" /> Membership
                </div>
              </Link>
            </SheetClose>
            {isSignedIn && (
              <>
                <SheetClose asChild>
                  <Link href="/organization">
                    <div className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <Building2 className="w-4 h-4 text-accent" /> My Organization
                    </div>
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link href="/account">
                    <div className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <Settings2 className="w-4 h-4 text-accent" /> Account
                    </div>
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link href="/marketplace">
                    <div className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <Store className="w-4 h-4 text-accent" /> Marketplace
                    </div>
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link href="/case-studies">
                    <div className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <Lightbulb className="w-4 h-4 text-accent" /> Case studies
                    </div>
                  </Link>
                </SheetClose>
                {isAdmin && (
                  <SheetClose asChild>
                    <Link href="/admin">
                      <div className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                        <Shield className="w-4 h-4 text-accent" /> Admin
                      </div>
                    </Link>
                  </SheetClose>
                )}
                <SignOutButton>
                  <button className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40 text-left">
                    <LogOut className="w-4 h-4 text-accent" /> Sign out
                  </button>
                </SignOutButton>
              </>
            )}
            {!isSignedIn && (
              <SignInButton mode="modal">
                <button
                  data-testid="nav-mobile-signin"
                  className="mx-3 mt-1 px-3 py-2 text-sm bg-foreground text-background"
                >
                  Sign in
                </button>
              </SignInButton>
            )}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  // /embed/* renders bare for iframe consumers — no chrome, no nav, no
  // banners. The embed pages bring their own minimal "powered by" footer.
  if (location.startsWith("/embed/")) {
    return <><CommandPalette /><div className="min-h-screen bg-background text-foreground">{children}</div></>;
  }
  const { isSignedIn, isLoaded, user } = useUser();
  const { isAdmin } = useIsAdmin();
  const { status: membershipStatus } = useMembershipStatus();
  const { balance: creditBalance, tierSlug } = useCreditBalance();
  // Admins always have access — they operate the platform, not consume it. The backend
  // /api/me/membership endpoint also returns a synthetic Platform membership for them,
  // so membershipStatus will normally be "active", but OR'ing with isAdmin handles the
  // race window before that fetch completes.
  const hasAccess = isSignedIn && (isAdmin || membershipStatus === "active");

  const isGroupActive = (group: NavGroup) =>
    group.matchPaths.some(p => location === p || location.startsWith(p + "/"));

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <CommandPalette />
      <DegradedServiceBanner />
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/90 backdrop-blur-md" id="main-header">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-2 md:gap-4">

          <MobileNav
            navGroups={navGroups}
            hasAccess={!!hasAccess}
            isSignedIn={!!isSignedIn}
            isAdmin={!!isAdmin}
            membershipStatus={membershipStatus}
            location={location}
          />

          {/* Brand lockup */}
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer shrink-0">
              <div className="w-7 h-7 bg-foreground flex items-center justify-center text-background font-serif tracking-tight text-sm">
                CE
              </div>
              <div className="hidden sm:flex items-baseline gap-1.5">
                <span className="font-serif text-base tracking-tight">Inflexcvi</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Alpha</span>
              </div>
            </div>
          </Link>

          {/* Primary nav — only shown to members with active access */}
          <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
            {hasAccess && navGroups.map(group => {
              const active = isGroupActive(group);
              const baseCls = `relative px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.16em] transition-colors hover:text-foreground cursor-pointer flex items-center gap-1 ${
                active ? "text-foreground" : "text-muted-foreground"
              }`;
              const indicator = active ? (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute inset-0 bg-muted/60 -z-10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              ) : null;

              if (!group.children && group.href) {
                return (
                  <Link key={group.label} href={group.href}>
                    <div data-testid={`nav-${group.label.toLowerCase()}`} className={baseCls}>
                      {group.label}
                      {indicator}
                    </div>
                  </Link>
                );
              }

              return (
                <DropdownMenu key={group.label}>
                  <DropdownMenuTrigger asChild>
                    <button data-testid={`nav-${group.label.toLowerCase()}`} className={baseCls + " outline-none"}>
                      {group.label}
                      <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                      {indicator}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72 rounded-none border-border/60">
                    <DropdownMenuLabel className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                      {group.label}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {group.children!.map(child => {
                      const Icon = child.icon;
                      const childActive = location === child.href;
                      return (
                        <Link key={child.href} href={child.href}>
                          <DropdownMenuItem
                            data-testid={`nav-link-${child.label.replace(/\s+/g, "-").toLowerCase()}`}
                            className={`cursor-pointer flex items-start gap-3 py-2.5 ${childActive ? "bg-muted/60" : ""}`}
                          >
                            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
                            <div className="flex flex-col">
                              <span className="font-mono text-[11px] uppercase tracking-[0.14em] leading-tight">{child.label}</span>
                              {child.description && (
                                <span className="text-xs text-muted-foreground leading-tight mt-0.5 normal-case tracking-normal font-sans">{child.description}</span>
                              )}
                            </div>
                          </DropdownMenuItem>
                        </Link>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </nav>

          {/* Utility cluster — top-right */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {!isLoaded ? null : !isSignedIn ? (
              <>
                <Link href="/membership">
                  <Button data-testid="nav-apply" variant="outline" size="sm">Apply for membership</Button>
                </Link>
                <SignInButton mode="modal">
                  <Button data-testid="nav-signin" size="sm">Sign in</Button>
                </SignInButton>
              </>
            ) : !hasAccess ? (
              <>
                <Link href="/membership">
                  <Button data-testid="nav-apply" size="sm">
                    {membershipStatus === "pending" ? "Membership pending" : "Apply for membership"}
                  </Button>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      data-testid="nav-account"
                      title={user?.primaryEmailAddress?.emailAddress ?? "Account"}
                      className="w-8 h-8 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-xs font-semibold text-muted-foreground transition-colors"
                    >
                      {user?.firstName?.[0]?.toUpperCase() ?? <Users className="w-4 h-4" />}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-none">
                    <DropdownMenuLabel className="font-serif text-xs uppercase tracking-widest text-muted-foreground">
                      Account
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <Link href="/membership">
                      <DropdownMenuItem className="cursor-pointer gap-2">
                        <CreditCard className="w-4 h-4" /> Membership
                      </DropdownMenuItem>
                    </Link>
                    <DropdownMenuSeparator />
                    <SignOutButton>
                      <DropdownMenuItem className="cursor-pointer gap-2">
                        <LogOut className="w-4 h-4" /> Sign out
                      </DropdownMenuItem>
                    </SignOutButton>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                {/* Global Q&A bar — slash-key activated, available on every page */}
                <GlobalQABar />

                {/* Reading-lens (persona) switcher — moved up here from
                    PersonaDescription so it lives with other account controls. */}
                <PersonaTopSwitcher />

                {/* Credit balance chip */}
                {creditBalance !== null && (
                  <Link href="/membership">
                    <button
                      data-testid="nav-credits"
                      title={`${creditBalance.toLocaleString()} CVI credits remaining`}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors flex items-center gap-1 hover:bg-muted ${
                        creditBalance <= 10 ? "text-destructive bg-destructive/10" : creditBalance <= 50 ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground"
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {creditBalance.toLocaleString()}
                    </button>
                  </Link>
                )}

                {/* Notifications bell with unread badge */}
                <NotificationBell />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      data-testid="nav-account"
                      title={user?.primaryEmailAddress?.emailAddress ?? "Account"}
                      className="w-8 h-8 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-xs font-semibold text-muted-foreground transition-colors"
                    >
                      {user?.firstName?.[0]?.toUpperCase() ?? <Users className="w-4 h-4" />}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-none">
                    <DropdownMenuLabel className="font-serif text-xs uppercase tracking-widest text-muted-foreground">
                      Account
                    </DropdownMenuLabel>
                    {creditBalance !== null && (
                      <>
                        <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center justify-between">
                          <span>CVI Credits</span>
                          <span className="font-mono font-medium">{creditBalance.toLocaleString()}</span>
                        </div>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <Link href="/organization">
                      <DropdownMenuItem data-testid="nav-link-my-org" className="cursor-pointer gap-2">
                        <Building2 className="w-4 h-4" /> My Organization
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/membership">
                      <DropdownMenuItem data-testid="nav-link-membership" className="cursor-pointer gap-2">
                        <CreditCard className="w-4 h-4" /> Membership
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/account">
                      <DropdownMenuItem data-testid="nav-link-account" className="cursor-pointer gap-2">
                        <Settings2 className="w-4 h-4" /> Account &amp; API keys
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/marketplace">
                      <DropdownMenuItem data-testid="nav-link-marketplace" className="cursor-pointer gap-2">
                        <Store className="w-4 h-4" /> Marketplace
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/case-studies">
                      <DropdownMenuItem data-testid="nav-link-case-studies" className="cursor-pointer gap-2">
                        <Lightbulb className="w-4 h-4" /> Case studies
                      </DropdownMenuItem>
                    </Link>
                    <DropdownMenuSeparator />
                    <SignOutButton>
                      <DropdownMenuItem className="cursor-pointer gap-2">
                        <LogOut className="w-4 h-4" /> Sign out
                      </DropdownMenuItem>
                    </SignOutButton>
                  </DropdownMenuContent>
                </DropdownMenu>

              </>
            )}

            {isSignedIn && isAdmin && (
              <Link href="/admin">
                <button
                  data-testid="nav-admin"
                  title="Admin"
                  className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors hover:bg-muted ${
                    location === "/admin" ? "text-primary bg-primary/10" : "text-muted-foreground"
                  }`}
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              </Link>
            )}
          </div>

        </div>
      </header>
      <main className="flex-1">
        {!isMobileTuned(location) && <MobileNotice />}
        {children}
      </main>
      <footer className="border-t border-border/40 py-10 bg-background">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-serif italic text-sm text-foreground/60">"Understanding the true value of what your organization can do."</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            &copy; {new Date().getFullYear()} Inflexcvi
          </div>
        </div>
      </footer>
      {hasAccess && <VoiceAdvisor />}
      <AITourGuide />
    </div>
  );
}
