import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp } from "@clerk/react";
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
import CEIDashboard from "@/pages/cei-dashboard";
import Assess from "@/pages/assess";
import AdminDashboard from "@/pages/admin";
import AdminPaymentsPage from "@/pages/admin-payments";
import ReviewQueue from "@/pages/review-queue";
import VCE from "@/pages/vce";
import Alpha from "@/pages/alpha";
import Membership from "@/pages/membership";
import Account from "@/pages/account";
import AcceptInvite from "@/pages/accept-invite";
import Marketplace from "@/pages/marketplace";
import MarketplaceListing from "@/pages/marketplace-listing";
import MarketplaceSell from "@/pages/marketplace-sell";
import MarketplaceLibrary from "@/pages/marketplace-library";
import KycPage from "@/pages/kyc";
import Companies from "@/pages/companies";
import Usage from "@/pages/usage";
import Simulation from "@/pages/simulation";
import WarRoom from "@/pages/war-room";
import TradeSignalsPage from "@/pages/trade-signals";
import InnovationPipeline from "@/pages/innovation-pipeline";
import WatchlistPage from "@/pages/watchlist";
import BenchmarkingPage from "@/pages/benchmarking";
import RoiTracker from "@/pages/roi-tracker";
import NLQueryPage from "@/pages/nl-query";
import RegulationsPage from "@/pages/regulations";
import CollaborationPage from "@/pages/collaboration";

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

function SignUpPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function AdminOnly({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin, isLoaded } = useIsAdmin();
  if (!isLoaded) return null;
  if (!isAdmin) return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/" component={Home} />
      <Route path="/alpha" component={Alpha} />
      <Route path="/cei" component={CEIDashboard} />
      <Route path="/insurance-example" component={InsuranceExample} />
      <Route path="/c-suite" component={CSuite} />
      <Route path="/knowledge-graph" component={KnowledgeGraph} />
      <Route path="/projects" component={Projects} />
      <Route path="/insights" component={InsightsPage} />
      <Route path="/organization" component={OrganizationSetup} />
      <Route path="/assess" component={Assess} />
      <Route path="/admin">{() => <AdminOnly component={AdminDashboard} />}</Route>
      <Route path="/admin/payments">{() => <AdminOnly component={AdminPaymentsPage} />}</Route>
      <Route path="/review" component={ReviewQueue} />
      <Route path="/vce" component={VCE} />
      <Route path="/membership" component={Membership} />
      <Route path="/account" component={Account} />
      <Route path="/accept-invite" component={AcceptInvite} />
      <Route path="/marketplace" component={Marketplace} />
      <Route path="/marketplace/listings/:id" component={MarketplaceListing} />
      <Route path="/marketplace/sell" component={MarketplaceSell} />
      <Route path="/marketplace/my-purchases" component={MarketplaceLibrary} />
      <Route path="/kyc" component={KycPage} />
      <Route path="/companies" component={Companies} />
      <Route path="/usage" component={Usage} />
      <Route path="/simulation" component={Simulation} />
      <Route path="/war-room" component={WarRoom} />
      <Route path="/trade-signals" component={TradeSignalsPage} />
      <Route path="/innovation" component={InnovationPipeline} />
      <Route path="/watchlist" component={WatchlistPage} />
      <Route path="/benchmarking" component={BenchmarkingPage} />
      <Route path="/roi" component={RoiTracker} />
      <Route path="/ask" component={NLQueryPage} />
      <Route path="/regulations" component={RegulationsPage} />
      <Route path="/collaborate" component={CollaborationPage} />
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
