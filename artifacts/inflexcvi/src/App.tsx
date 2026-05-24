import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useAuth } from "@clerk/react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import InsuranceExample from "@/pages/insurance-example";
import CSuite from "@/pages/c-suite";
import KnowledgeGraph from "@/pages/knowledge-graph";
import OrganizationSetup from "@/pages/organization";
import Projects from "@/pages/projects";
import InsightsPage from "@/pages/insights";
import CVIDashboard from "@/pages/cvi-dashboard";
import Assess from "@/pages/assess";
import AdminDashboard from "@/pages/admin";
import AdminPaymentsPage from "@/pages/admin-payments";
import AdminSourceQualityPage from "@/pages/admin-source-quality";
import AdminCaseStudiesPage from "@/pages/admin-case-studies";
import AdminAuditChainPage from "@/pages/admin-audit-chain";
import AdminAgentProposalsPage from "@/pages/admin-agent-proposals";
import AdminEconomicRulesPage from "@/pages/admin-economic-rules";
import AdminReviewQueuePage from "@/pages/admin-review-queue";
import AdminPlatformSignupsPage from "@/pages/admin-platform-signups";
import AdminRegulationsPage from "@/pages/admin-regulations";
import SourcePage from "@/pages/source";
import PortfolioPage from "@/pages/portfolio";
import ComparablesPage from "@/pages/comparables";
import BacktestPage from "@/pages/backtest";
import ReviewQueue from "@/pages/review-queue";
import VCR from "@/pages/vcr";
import Alpha from "@/pages/alpha";
import Membership from "@/pages/membership";
import Account from "@/pages/account";
import ExportsPage from "@/pages/exports";
import AcceptInvite from "@/pages/accept-invite";
import Marketplace from "@/pages/marketplace";
import MarketplaceListing from "@/pages/marketplace-listing";
import MarketplaceSell from "@/pages/marketplace-sell";
import MarketplaceLibrary from "@/pages/marketplace-library";
import MarketplaceThanks from "@/pages/marketplace-thanks";
import CaseStudies from "@/pages/case-studies";
import CaseStudy from "@/pages/case-study";
import KycPage from "@/pages/kyc";
import Companies from "@/pages/companies";
import Usage from "@/pages/usage";
import Simulation from "@/pages/simulation";
import CapabilityScorecard from "@/pages/scorecard";
import TradeSignalsPage from "@/pages/trade-signals";
import InnovationPipeline from "@/pages/innovation-pipeline";
import WatchlistPage from "@/pages/watchlist";
import BenchmarkingPage from "@/pages/benchmarking";
import RoiTracker from "@/pages/roi-tracker";
import NLQueryPage from "@/pages/nl-query";
import RegulationsPage from "@/pages/regulations";
import CollaborationPage from "@/pages/collaboration";
import Console from "@/pages/console";
import SystemStatus from "@/pages/system-status";
import LifecycleDocs from "@/pages/lifecycle-docs";
import DevelopersPage from "@/pages/developers";
import Methodology from "@/pages/methodology";
import ProvenancePage from "@/pages/provenance";
import UploadPage from "@/pages/upload";
import UploadDetailPage from "@/pages/upload-detail";
import MemberPage from "@/pages/member";
import InboxPage from "@/pages/inbox";
import AccountProfilePage from "@/pages/account-profile";
import AccountLearningPage from "@/pages/account-learning";
import ForumPage from "@/pages/forum";
import FeedPage from "@/pages/feed";
import NetworkPage from "@/pages/network";
import SearchMembersPage from "@/pages/search-members";
import NotificationsPage from "@/pages/notifications";
import HashtagPage from "@/pages/hashtag";
import HowItWorksPage from "@/pages/how-it-works";
import ArchitecturePage from "@/pages/architecture";
import AgentRadarPage from "@/pages/agent-radar";
import CoveragePage from "@/pages/coverage";
import ExplorePage from "@/pages/explore";
import CapabilityDetailPage from "@/pages/capability-detail";
import InnovationWedgePage from "@/pages/innovation-wedge";
import ComparePage from "@/pages/compare";
import WhatIfPage from "@/pages/whatif";
import SearchPage from "@/pages/search";
import ProofPage from "@/pages/proof";
import WorkbenchPage from "@/pages/workbench";
import PatternsPage from "@/pages/patterns";
import DisruptionPage from "@/pages/disruption";
import DisruptionIndexPage from "@/pages/disruption-index";
import DisruptionLabPage from "@/pages/disruption-lab";
import SecurityPage from "@/pages/security";
import DemoPage from "@/pages/demo";
import MarketplaceWorkspacePage from "@/pages/marketplace-workspace";
import WorkbenchExamplePage from "@/pages/workbench-example";
import OnboardingPage from "@/pages/onboarding";
import EmbedCvi from "@/pages/embed-cvi";
import EmbedCapability from "@/pages/embed-capability";

const queryClient = new QueryClient();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function SignInPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

interface InviteSummary {
  email: string;
  name: string;
  organization: string;
}

function SignUpPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteChecked, setInviteChecked] = useState(!inviteToken);
  const { isSignedIn } = useAuth();
  const [consumed, setConsumed] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    fetch(`/api/platform-signup/verify/${encodeURIComponent(inviteToken)}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setInviteError(String(j.error ?? `Invite check failed (${r.status})`));
          setInviteChecked(true);
          return;
        }
        const j = (await r.json()) as InviteSummary & { ok: boolean };
        setInvite({ email: j.email, name: j.name, organization: j.organization });
        setInviteChecked(true);
      })
      .catch(() => {
        setInviteError("Unable to reach the server. Please try again.");
        setInviteChecked(true);
      });
  }, [inviteToken]);

  // Consume invite once the user is signed in.
  useEffect(() => {
    if (!inviteToken || !isSignedIn || consumed) return;
    fetch("/api/platform-signup/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: inviteToken }),
    }).then(() => setConsumed(true)).catch(() => undefined);
  }, [inviteToken, isSignedIn, consumed]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        {inviteToken && inviteChecked && invite && (
          <div className="border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400 mb-1">
              Approved invitation
            </div>
            <div>Welcome, <strong>{invite.name}</strong> ({invite.organization}).</div>
            <div className="text-muted-foreground mt-1">
              Sign up with <strong>{invite.email}</strong> using any provider below. Identity verification will be requested before checkout.
            </div>
          </div>
        )}
        {inviteToken && inviteChecked && inviteError && (
          <div className="border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive mb-1">
              Invite issue
            </div>
            <div>{inviteError}</div>
            <div className="text-muted-foreground mt-1">
              You can still sign up below, but the Platform tier remains locked until an admin approves a new request.
            </div>
          </div>
        )}
        <div className="flex items-center justify-center">
          <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
        </div>
      </div>
    </div>
  );
}

function AdminOnly({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin, isLoaded } = useIsAdmin();
  if (!isLoaded) return null;
  if (!isAdmin) return <Redirect to="/" />;
  return <Component />;
}

function RequireAuth({ component: Component }: { component: React.ComponentType }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/" component={Home} />
      <Route path="/alpha" component={Alpha} />
      <Route path="/cvi" component={CVIDashboard} />
      <Route path="/cei" component={CVIDashboard} />
      <Route path="/methodology" component={Methodology} />
      <Route path="/provenance" component={ProvenancePage} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/upload/:id" component={UploadDetailPage} />
      <Route path="/member/:slug" component={MemberPage} />
      <Route path="/inbox" component={InboxPage} />
      <Route path="/inbox/:userId" component={InboxPage} />
      <Route path="/account/profile" component={AccountProfilePage} />
      <Route path="/account/learning" component={AccountLearningPage} />
      <Route path="/forum/:industrySlug" component={ForumPage} />
      <Route path="/forum/thread/:id" component={ForumPage} />
      <Route path="/feed" component={FeedPage} />
      <Route path="/network" component={NetworkPage} />
      <Route path="/search/members" component={SearchMembersPage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/hashtag/:tag" component={HashtagPage} />
      <Route path="/how-it-works" component={HowItWorksPage} />
      <Route path="/architecture" component={ArchitecturePage} />
      <Route path="/agent-radar" component={AgentRadarPage} />
      <Route path="/coverage" component={CoveragePage} />
      <Route path="/explore" component={ExplorePage} />
      <Route path="/capability/:id" component={CapabilityDetailPage} />
      <Route path="/innovation/:capabilityId/disruptor/:disruptorSlug" component={InnovationWedgePage} />
      <Route path="/compare" component={ComparePage} />
      <Route path="/whatif" component={WhatIfPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/proof" component={ProofPage} />
      <Route path="/workbench" component={WorkbenchPage} />
      <Route path="/patterns" component={PatternsPage} />
      <Route path="/patterns/:slug" component={PatternsPage} />
      <Route path="/disruption" component={DisruptionPage} />
      <Route path="/disruption-index" component={DisruptionIndexPage} />
      <Route path="/disruption-lab" component={DisruptionLabPage} />
      <Route path="/dvx" component={DisruptionPage} />
      <Route path="/security" component={SecurityPage} />
      <Route path="/demo">{() => <RequireAuth component={DemoPage} />}</Route>
      <Route path="/marketplace/workspace" component={MarketplaceWorkspacePage} />
      <Route path="/workbench/example">{() => <RequireAuth component={WorkbenchExamplePage} />}</Route>
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/embed/cvi" component={EmbedCvi} />
      <Route path="/embed/capability/:id" component={EmbedCapability} />
      <Route path="/insurance-example" component={InsuranceExample} />
      <Route path="/c-suite" component={CSuite} />
      <Route path="/knowledge-graph" component={KnowledgeGraph} />
      <Route path="/projects" component={Projects} />
      <Route path="/insights" component={InsightsPage} />
      <Route path="/organization" component={OrganizationSetup} />
      <Route path="/assess" component={Assess} />
      <Route path="/admin">{() => <AdminOnly component={AdminDashboard} />}</Route>
      <Route path="/admin/payments">{() => <AdminOnly component={AdminPaymentsPage} />}</Route>
      <Route path="/admin/source-quality">{() => <AdminOnly component={AdminSourceQualityPage} />}</Route>
      <Route path="/admin/case-studies">{() => <AdminOnly component={AdminCaseStudiesPage} />}</Route>
      <Route path="/admin/audit-chain">{() => <AdminOnly component={AdminAuditChainPage} />}</Route>
      <Route path="/admin/agent/proposals">{() => <AdminOnly component={AdminAgentProposalsPage} />}</Route>
      <Route path="/admin/economic-rules">{() => <AdminOnly component={AdminEconomicRulesPage} />}</Route>
      <Route path="/admin/review-queue">{() => <AdminOnly component={AdminReviewQueuePage} />}</Route>
      <Route path="/admin/platform-signups">{() => <AdminOnly component={AdminPlatformSignupsPage} />}</Route>
      <Route path="/admin/regulations">{() => <AdminOnly component={AdminRegulationsPage} />}</Route>
      <Route path="/source" component={SourcePage} />
      <Route path="/portfolio" component={PortfolioPage} />
      <Route path="/comparables/:companyId" component={ComparablesPage} />
      <Route path="/backtest">{() => <AdminOnly component={BacktestPage} />}</Route>
      <Route path="/review" component={ReviewQueue} />
      <Route path="/vcr" component={VCR} />
      <Route path="/membership" component={Membership} />
      <Route path="/account" component={Account} />
      <Route path="/exports" component={ExportsPage} />
      <Route path="/account/notifications" component={Account} />
      <Route path="/accept-invite" component={AcceptInvite} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/marketplace/listings/:id" component={MarketplaceListing} />
      <Route path="/marketplace/sell" component={MarketplaceSell} />
      <Route path="/marketplace/thanks" component={MarketplaceThanks} />
      <Route path="/marketplace/my-purchases" component={MarketplaceLibrary} />
      <Route path="/case-studies" component={CaseStudies} />
      <Route path="/case-study/:slug" component={CaseStudy} />
      <Route path="/kyc" component={KycPage} />
      <Route path="/companies" component={Companies} />
      <Route path="/usage" component={Usage} />
      <Route path="/simulation" component={Simulation} />
      <Route path="/scorecard" component={CapabilityScorecard} />
      {/* Legacy redirect — older /war-room links land on the renamed scorecard. */}
      <Route path="/war-room">{() => <Redirect to="/scorecard" />}</Route>
      <Route path="/trade-signals" component={TradeSignalsPage} />
      <Route path="/innovation" component={InnovationPipeline} />
      <Route path="/watchlist" component={WatchlistPage} />
      <Route path="/benchmarking" component={BenchmarkingPage} />
      <Route path="/roi" component={RoiTracker} />
      <Route path="/ask" component={NLQueryPage} />
      <Route path="/regulations" component={RegulationsPage} />
      <Route path="/collaborate" component={CollaborationPage} />
      <Route path="/console" component={Console} />
      <Route path="/system-status" component={SystemStatus} />
      <Route path="/lifecycle" component={LifecycleDocs} />
      <Route path="/developers" component={DevelopersPage} />
      {/* Legacy redirect — older links to /ledger land on The Console. */}
      <Route path="/ledger">{() => <Redirect to="/console" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      appearance={{
        variables: {
          colorPrimary: "hsl(244 47% 50%)",
          colorTextOnPrimaryBackground: "hsl(210 40% 98%)",
          colorBackground: "hsl(210 40% 98%)",
          colorInputBackground: "hsl(0 0% 100%)",
          colorInputText: "hsl(222 47% 11%)",
          colorText: "hsl(222 47% 11%)",
          colorTextSecondary: "hsl(215 16% 47%)",
          colorDanger: "hsl(0 84% 60%)",
          colorSuccess: "hsl(142 71% 45%)",
          borderRadius: "0px",
          fontFamily: "'Outfit', sans-serif",
          fontFamilyButtons: "'Outfit', sans-serif",
          fontSize: "14px",
        },
        elements: {
          card: "shadow-none border border-border/40 rounded-none bg-background",
          headerTitle: "font-serif tracking-tight text-foreground",
          headerSubtitle: "text-muted-foreground text-sm",
          socialButtonsBlockButton: "rounded-none border-border/60 hover:bg-muted/40 transition-colors",
          socialButtonsBlockButtonText: "font-sans text-sm",
          formButtonPrimary: "rounded-none bg-foreground hover:bg-foreground/90 text-background font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
          formFieldInput: "rounded-none border-border/60 bg-background focus:border-foreground focus:ring-0 font-sans text-sm",
          formFieldLabel: "font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground",
          footerActionLink: "text-accent hover:text-accent/80 font-mono text-[11px]",
          identityPreviewEditButton: "text-accent font-mono text-[11px]",
          formResendCodeLink: "text-accent font-mono text-[11px]",
          dividerLine: "bg-border/40",
          dividerText: "font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground",
          navbar: "hidden",
          logoBox: "hidden",
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Layout>
            <Router />
          </Layout>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
