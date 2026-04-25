import { Router, type IRouter } from "express";

const router: IRouter = Router();

/**
 * Application nav config — served as JSON so the frontend renders the menu
 * dynamically. Icons are referenced by their lucide-react export name; the
 * frontend maps the name to the actual component.
 */
const NAV_GROUPS = [
  {
    label: "Index",
    matchPaths: ["/cei", "/knowledge-graph", "/regulations"],
    children: [
      { href: "/cei", label: "CEI Dashboard", icon: "Activity", description: "Live composite index & macro events" },
      { href: "/knowledge-graph", label: "Knowledge Graph", icon: "Network", description: "Capability relationships & dependencies" },
      { href: "/regulations", label: "Regulations", icon: "Scale", description: "Compliance & regulatory landscape" },
    ],
  },
  {
    label: "Workspace",
    matchPaths: ["/companies", "/projects", "/watchlist", "/collaborate"],
    children: [
      { href: "/companies", label: "Portfolio", icon: "Building2", description: "Tracked organizations" },
      { href: "/projects", label: "Projects", icon: "Layers", description: "Your active engagements" },
      { href: "/watchlist", label: "Watchlist", icon: "Bell", description: "Saved capabilities & alerts" },
      { href: "/collaborate", label: "Strategy Decisions", icon: "MessageCircle", description: "Recorded executive decisions & rationale" },
    ],
  },
  {
    label: "Assess",
    matchPaths: ["/assess", "/review"],
    children: [
      { href: "/assess", label: "Run Assessment", icon: "ScanSearch", description: "Start a capability assessment" },
      { href: "/review", label: "Review Queue", icon: "Inbox", description: "Pending QA & approvals" },
    ],
  },
  {
    label: "C-Suite",
    href: "/c-suite",
    matchPaths: ["/c-suite"],
  },
  {
    label: "Strategy",
    matchPaths: ["/scorecard", "/simulation", "/trade-signals", "/innovation", "/benchmarking", "/roi"],
    children: [
      { href: "/scorecard", label: "Capability Scorecard", icon: "Swords", description: "Your scores vs. industry benchmarks, gap-by-gap" },
      { href: "/simulation", label: "Simulate", icon: "FlaskConical", description: "What-if scenario modeling" },
      { href: "/trade-signals", label: "Trade Signals", icon: "Target", description: "Forward-looking signals" },
      { href: "/innovation", label: "Innovation Pipeline", icon: "Rocket", description: "Emerging capabilities" },
      { href: "/benchmarking", label: "Peer Benchmarks", icon: "BarChart3", description: "Compare against peers" },
      { href: "/roi", label: "ROI Tracker", icon: "PieChart", description: "Investment outcomes" },
    ],
  },
  {
    label: "Intelligence",
    matchPaths: ["/insights", "/ask", "/alpha"],
    children: [
      { href: "/insights", label: "Insights Feed", icon: "Lightbulb", description: "Curated narratives & analysis" },
      { href: "/ask", label: "CE Search", icon: "MessageSquare", description: "Natural-language query over the capability dataset" },
      { href: "/alpha", label: "CE Alpha", icon: "Activity", description: "Advanced analytics: EVaR, moat, dependency impact, M&A targets" },
    ],
  },
];

router.get("/nav", (_req, res) => {
  res.json({ groups: NAV_GROUPS });
});

export default router;
