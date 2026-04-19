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
  Lightbulb, MessageSquare,
  Settings2, ChevronDown, CreditCard, LogOut, Sparkles,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type NavChild = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; description?: string };
type NavGroup = { label: string; href?: string; children?: NavChild[]; matchPaths: string[] };

const navGroups: NavGroup[] = [
  {
    label: "Index",
    matchPaths: ["/cei", "/knowledge-graph", "/regulations"],
    children: [
      { href: "/cei", label: "CEI Dashboard", icon: Activity, description: "Live composite index & macro events" },
      { href: "/knowledge-graph", label: "Knowledge Graph", icon: Network, description: "Capability relationships & dependencies" },
      { href: "/regulations", label: "Regulations", icon: Scale, description: "Compliance & regulatory landscape" },
    ],
  },
  {
    label: "Workspace",
    matchPaths: ["/companies", "/projects", "/watchlist", "/collaborate"],
    children: [
      { href: "/companies", label: "Companies", icon: Building2, description: "Tracked organizations" },
      { href: "/projects", label: "Projects", icon: Layers, description: "Your active engagements" },
      { href: "/watchlist", label: "Watchlist", icon: Bell, description: "Saved capabilities & alerts" },
      { href: "/collaborate", label: "Collaboration", icon: MessageCircle, description: "Team activity & comments" },
    ],
  },
  {
    label: "Assess",
    matchPaths: ["/assess", "/review", "/insurance-example"],
    children: [
      { href: "/assess", label: "Run Assessment", icon: ScanSearch, description: "Start a capability assessment" },
      { href: "/review", label: "Review Queue", icon: Inbox, description: "Pending QA & approvals" },
      { href: "/insurance-example", label: "Case Studies", icon: Shield, description: "Reference walkthroughs" },
    ],
  },
  {
    label: "C-Suite",
    href: "/c-suite",
    matchPaths: ["/c-suite"],
  },
  {
    label: "Strategy",
    matchPaths: ["/war-room", "/simulation", "/trade-signals", "/innovation", "/benchmarking", "/roi"],
    children: [
      { href: "/war-room", label: "War Room", icon: Swords, description: "Live incident & response coordination" },
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
      { href: "/ask", label: "Ask", icon: MessageSquare, description: "Natural-language query" },
      { href: "/alpha", label: "CE Alpha Suite", icon: Activity, description: "Product hub overview" },
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

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isSignedIn, isLoaded, user } = useUser();
  const { isAdmin } = useIsAdmin();
  const { status: membershipStatus } = useMembershipStatus();
  const { balance: creditBalance, tierSlug } = useCreditBalance();
  const hasAccess = isSignedIn && membershipStatus === "active";

  const isGroupActive = (group: NavGroup) =>
    group.matchPaths.some(p => location === p || location.startsWith(p + "/"));

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">

          {/* Brand lockup — replaces Home + CE Alpha */}
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer shrink-0">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-serif font-bold text-lg">
                CE
              </div>
              <div className="hidden sm:flex items-baseline gap-1.5">
                <span className="font-serif font-semibold text-lg tracking-tight">Capability Economics</span>
                <span className="text-xs uppercase tracking-widest text-muted-foreground">Alpha</span>
              </div>
            </div>
          </Link>

          {/* Primary nav — only shown to members with active access */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {hasAccess && navGroups.map(group => {
              const active = isGroupActive(group);
              const baseCls = `relative px-3 py-2 rounded-md text-sm font-medium transition-colors hover:text-primary cursor-pointer flex items-center gap-1 ${
                active ? "text-primary" : "text-muted-foreground"
              }`;
              const indicator = active ? (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute inset-0 rounded-md bg-primary/10 -z-10"
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
                  <DropdownMenuContent align="start" className="w-72 rounded-none">
                    <DropdownMenuLabel className="font-serif text-xs uppercase tracking-widest text-muted-foreground">
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
                            className={`cursor-pointer flex items-start gap-3 py-2.5 ${childActive ? "bg-primary/10" : ""}`}
                          >
                            <Icon className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium leading-tight">{child.label}</span>
                              {child.description && (
                                <span className="text-xs text-muted-foreground leading-tight mt-0.5">{child.description}</span>
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
                      title={`${creditBalance.toLocaleString()} CEI credits remaining`}
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
                          <span>CEI Credits</span>
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
        {children}
      </main>
      <footer className="border-t py-12 bg-muted/30">
        <div className="container mx-auto px-4 text-center text-muted-foreground text-sm">
          <p className="font-serif italic mb-2">"Understanding the true value of what your organization can do."</p>
          <p>&copy; {new Date().getFullYear()} Capability Economics Executive Briefing.</p>
        </div>
      </footer>
    </div>
  );
}
