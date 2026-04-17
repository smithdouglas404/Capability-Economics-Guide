import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import ReviewQueue from "@/pages/review-queue";
import VCE from "@/pages/vce";
import Alpha from "@/pages/alpha";
import Membership from "@/pages/membership";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
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
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/review" component={ReviewQueue} />
      <Route path="/vce" component={VCE} />
      <Route path="/membership" component={Membership} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
