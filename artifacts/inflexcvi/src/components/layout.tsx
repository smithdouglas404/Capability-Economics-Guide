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
  Lightbulb, MessageSquare, Zap,
  Settings2, ChevronDown, CreditCard, LogOut, Sparkles,
  Store, Menu,
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

const navGroups: NavGroup[] = [
  {
    label: "Index",
    matchPaths: ["/cvi", "/knowledge-graph", "/regulations"],
    children: [
      { href: "/cvi", label: "CVI Dashboard", icon: Activity, description: "Live composite index & macro events" },
      { href: "/knowledge-graph", label: "Knowledge Graph", icon: Network, description: "Capability relationships & dependencies" },
      { href: "/regulations", label: "Regulations", icon: Scale, description: "Compliance & regulatory landscape" },
    ],
  },
  {
    label: "Workspace",
    matchPaths: ["/companies", "/projects", "/watchlist", "/collaborate"],
    children: [
      { href: "/companies", label: "Portfolio", icon: Building2, description: "Tracked organizations" },
      { href: "/projects", label: "Projects", icon: Layers, description: "Your active engagements" },
      { href: "/watchlist", label: "Watchlist", icon: Bell, description: "Saved capabilities & alerts" },
      { href: "/collaborate", label: "Strategy Decisions", icon: MessageCircle, description: "Recorded executive decisions & rationale" },
    ],
  },
  {
    label: "Ideate",
    matchPaths: ["/workbench", "/disruption", "/patterns"],
    children: [
      { href: "/workbench", label: "Capability Workbench", icon: Lightbulb, description: "Drag capabilities through Scan → Frame → Ideate → Validate → Launch. Claude critiques per card." },
      { href: "/disruption", label: "Disruption Watch", icon: Zap, description: "Capabilities actively disrupting industries + the net-new capabilities emerging now." },
      { href: "/patterns", label: "Design-Thinking Patterns", icon: Sparkles, description: "Uber, Stripe, OpenAI — case studies on inventing new capabilities." },
    ],
  },
  {
    label: "Assess",
    matchPaths: ["/assess", "/review"],
    children: [
      { href: "/assess", label: "Run Assessment", icon: ScanSearch, description: "Start a capability assessment" },
      { href: "/review", label: "Review Queue", icon: Inbox, description: "Pending QA & approvals" },
    ],
  },
  {
    label: "C-Suite",
    href: "/c-suite",
    matchPaths: ["/c-suite"],
  },
  {
    label: "Strategy",
    matchPaths: ["/scorecard", "/war-room", "/simulation", "/trade-signals", "/innovation", "/benchmarking", "/roi"],
    children: [
      { href: "/scorecard", label: "Capability Scorecard", icon: Swords, description: "Your scores vs. industry benchmarks, gap-by-gap" },
      { href: "/simulation", label: "Simulate", icon: FlaskConical, description: "What-if scenario modeling" },
      { href: "/trade-signals", label: "Trade Signals", icon: Target, description: "Forward-looking signals" },
      { href: "/innovation", label: "Innovation Pipeline", icon: Rocket, description: "Emerging capabilities" },
      { href: "/benchmarking", label: "Peer Benchmarks", icon: BarChart3, description: "Compare against peers" },
      { href: "/roi", label: "ROI Tracker", icon: PieChart, description: "Investment outcomes" },
    ],
  },
  {
    label: "Intelligence",
    matchPaths: ["/insights", "/ask", "/alpha"],
    children: [
      { href: "/insights", label: "Insights Feed", icon: Lightbulb, description: "Curated narratives & analysis" },
      { href: "/ask", label: "CE Search", icon: MessageSquare, description: "Natural-language query over the capability dataset" },
      { href: "/alpha", label: "CE Alpha", icon: Activity, description: "Advanced analytics: EVaR, moat, dependency impact, M&A targets" },
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
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
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
      <DegradedServiceBanner />
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/90 backdrop-blur-md">
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
