import {
  Activity, Network, Scale, Building2, Layers, Bell, MessageCircle,
  ScanSearch, Inbox, Swords, FlaskConical, Target, Rocket, BarChart3,
  PieChart, Lightbulb, MessageSquare,
  Briefcase, Filter, FileText, GitMerge, TrendingUp, Eye, AlertTriangle, Columns3,
  Database, BookOpen, Quote, Code2, Download, Globe2, GitBranch,
  LayoutGrid, Search, FlaskRound, Bookmark, GraduationCap,
  Map, Sparkles, Route, Handshake, ScanLine, FileCode2,
} from "lucide-react";

export const PERSONA_SLUGS = [
  "pe_vc",
  "researcher",
  "academic",
  "corporate_exec",
  "entrepreneur",
] as const;

export type PersonaSlug = (typeof PERSONA_SLUGS)[number];

export const DEFAULT_PERSONA_SLUG: PersonaSlug = "corporate_exec";

export type PersonaMeta = {
  slug: PersonaSlug;
  label: string;
  shortLabel: string;
  description: string;
  defaultRoute: string;
  icon: React.ComponentType<{ className?: string }>;
};

export const PERSONA_META: Record<PersonaSlug, PersonaMeta> = {
  pe_vc: {
    slug: "pe_vc",
    label: "PE / VC",
    shortLabel: "PE",
    description: "Screen, diligence, monitor, exit. Built for investment teams.",
    defaultRoute: "/pipeline",
    icon: Briefcase,
  },
  researcher: {
    slug: "researcher",
    label: "Researcher",
    shortLabel: "Research",
    description: "Raw data, methodology, citations. Built for analysts and journalists.",
    defaultRoute: "/datasets",
    icon: Database,
  },
  academic: {
    slug: "academic",
    label: "Academic",
    shortLabel: "Academic",
    description: "Bloomberg-style index for teaching strategy and finance.",
    defaultRoute: "/board",
    icon: GraduationCap,
  },
  corporate_exec: {
    slug: "corporate_exec",
    label: "Corporate Executive",
    shortLabel: "Executive",
    description: "Close gaps vs. peers. Justify investment. Built for the C-suite.",
    defaultRoute: "/dashboard",
    icon: Building2,
  },
  entrepreneur: {
    slug: "entrepreneur",
    label: "Entrepreneur",
    shortLabel: "Founder",
    description: "Find white space, plan the build, match to capital.",
    defaultRoute: "/opportunity-map",
    icon: Sparkles,
  },
};

export type NavChild = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
};

export type NavGroup = {
  label: string;
  href?: string;
  children?: NavChild[];
  matchPaths: string[];
};

const peNav: NavGroup[] = [
  {
    label: "Deal Flow",
    matchPaths: ["/pipeline", "/screener", "/comparables"],
    children: [
      { href: "/pipeline", label: "Pipeline", icon: Briefcase, description: "Saved portfolios + capability score columns" },
      { href: "/screener", label: "Screener", icon: Filter, description: "Multi-parameter company filter, XLSX export" },
      { href: "/comparables", label: "Comparables", icon: Columns3, description: "Side-by-side capability matrix for N companies" },
    ],
  },
  {
    label: "Diligence",
    matchPaths: ["/diligence", "/ma-twins", "/thesis"],
    children: [
      { href: "/diligence", label: "Diligence Pack", icon: FileText, description: "10-K to 10-page PDF diligence memo" },
      { href: "/ma-twins", label: "M&A Twins", icon: GitMerge, description: "Capability-similar acquisition targets" },
      { href: "/thesis", label: "Investment Thesis", icon: TrendingUp, description: "Auto-generated thesis memo per capability" },
    ],
  },
  {
    label: "Monitor",
    matchPaths: ["/portfolio-monitor", "/exit-signals", "/watchlist"],
    children: [
      { href: "/portfolio-monitor", label: "Portfolio Monitor", icon: Eye, description: "ROI + watchlist + thresholds for portcos" },
      { href: "/exit-signals", label: "Exit Signals", icon: AlertTriangle, description: "Alerts on capability moat half-life decay" },
      { href: "/watchlist", label: "Watchlist", icon: Bell, description: "Custom thresholds & alerts" },
    ],
  },
  { label: "C-Suite", href: "/c-suite", matchPaths: ["/c-suite"] },
  {
    label: "Intelligence",
    matchPaths: ["/cei", "/insights", "/alpha", "/trade-signals"],
    children: [
      { href: "/cei", label: "CEI Index", icon: Activity, description: "Live composite index & macro events" },
      { href: "/insights", label: "Insights Feed", icon: Lightbulb, description: "Curated narratives & analysis" },
      { href: "/trade-signals", label: "Trade Signals", icon: Target, description: "Forward-looking signals" },
      { href: "/alpha", label: "CE Alpha", icon: Activity, description: "EVaR, moat, dependency cascades" },
    ],
  },
];

const researcherNav: NavGroup[] = [
  {
    label: "Data",
    matchPaths: ["/datasets", "/export", "/cross-industry"],
    children: [
      { href: "/datasets", label: "Datasets", icon: Database, description: "CEI time-series with metadata & credible intervals" },
      { href: "/export", label: "Bulk Export", icon: Download, description: "Historical CEI as CSV/JSON/Parquet" },
      { href: "/cross-industry", label: "Cross-Industry", icon: Globe2, description: "Capability X across all industries" },
    ],
  },
  {
    label: "Methodology",
    matchPaths: ["/methodology", "/citations", "/ontology"],
    children: [
      { href: "/methodology", label: "Methodology", icon: BookOpen, description: "Bayesian formula, prior derivation, velocity EMA" },
      { href: "/citations", label: "Citations & Sources", icon: Quote, description: "Source database with BibTeX/RIS export" },
      { href: "/ontology", label: "Ontology", icon: GitBranch, description: "Cross-industry capability graph" },
    ],
  },
  {
    label: "API",
    matchPaths: ["/api-console", "/replication"],
    children: [
      { href: "/api-console", label: "API Console", icon: Code2, description: "Interactive playground for /api/cei/*" },
      { href: "/replication", label: "Replication Bundle", icon: FileCode2, description: "Reproducible dataset + code snippet zip" },
    ],
  },
  {
    label: "Index",
    matchPaths: ["/cei", "/insights"],
    children: [
      { href: "/cei", label: "CEI Index", icon: Activity, description: "Live composite index" },
      { href: "/insights", label: "White Papers", icon: Lightbulb, description: "Industry research catalog" },
    ],
  },
];

const academicNav: NavGroup[] = [
  {
    label: "Index Board",
    href: "/board",
    matchPaths: ["/board"],
  },
  {
    label: "Explore",
    matchPaths: ["/lookup", "/screener", "/cross-industry"],
    children: [
      { href: "/lookup", label: "Capability Lookup", icon: Search, description: "Type-ahead capability search with definitions" },
      { href: "/screener", label: "Screener", icon: Filter, description: "Bookmarkable capability/company filters" },
      { href: "/cross-industry", label: "Cross-Industry", icon: Globe2, description: "Compare a capability across industries" },
    ],
  },
  {
    label: "Teach",
    matchPaths: ["/sandbox", "/curriculum", "/case-studies", "/industries"],
    children: [
      { href: "/sandbox", label: "Sandbox Org", icon: FlaskRound, description: "Pre-seeded TeachCorp for student exercises" },
      { href: "/curriculum", label: "Curriculum Packs", icon: GraduationCap, description: "Case-study + assignment bundles" },
      { href: "/case-studies", label: "Case Studies", icon: BookOpen, description: "Industry case study library" },
    ],
  },
  {
    label: "Reference",
    matchPaths: ["/methodology", "/citations", "/insights"],
    children: [
      { href: "/methodology", label: "Methodology", icon: BookOpen, description: "How CEI is computed" },
      { href: "/citations", label: "Citation Export", icon: Quote, description: "BibTeX/RIS for student papers" },
      { href: "/insights", label: "White Papers", icon: Lightbulb, description: "Long-form research" },
    ],
  },
  { label: "Bookmarks", href: "/bookmarks", matchPaths: ["/bookmarks"] },
];

const corpExecNav: NavGroup[] = [
  {
    label: "My Org",
    matchPaths: ["/dashboard", "/scorecard", "/c-suite"],
    children: [
      { href: "/dashboard", label: "Dashboard", icon: Activity, description: "Radar, gaps, role-filtered summary" },
      { href: "/scorecard", label: "Capability Scorecard", icon: Swords, description: "Live matrix vs. benchmarks" },
      { href: "/c-suite", label: "C-Suite Perspectives", icon: Briefcase, description: "Switch role, see priorities" },
    ],
  },
  {
    label: "Strategy",
    matchPaths: ["/collaborate", "/innovation", "/roi", "/simulation"],
    children: [
      { href: "/collaborate", label: "Strategy Decisions", icon: MessageCircle, description: "Recorded executive decisions" },
      { href: "/innovation", label: "Innovation Pipeline", icon: Rocket, description: "Emerging capability projects" },
      { href: "/roi", label: "ROI Tracker", icon: PieChart, description: "Investment outcomes" },
      { href: "/simulation", label: "Simulate", icon: FlaskConical, description: "What-if scenario modeling" },
    ],
  },
  {
    label: "Compare",
    matchPaths: ["/benchmarking", "/regulations", "/watchlist"],
    children: [
      { href: "/benchmarking", label: "Peer Benchmarks", icon: BarChart3, description: "Compare against peers" },
      { href: "/regulations", label: "Regulatory", icon: Scale, description: "Compliance landscape" },
      { href: "/watchlist", label: "Watchlist", icon: Bell, description: "Saved alerts" },
    ],
  },
  {
    label: "Assess",
    matchPaths: ["/assess", "/review", "/projects"],
    children: [
      { href: "/assess", label: "Run Assessment", icon: ScanSearch, description: "Start a capability assessment" },
      { href: "/projects", label: "Projects", icon: Layers, description: "Active engagements" },
      { href: "/review", label: "Review Queue", icon: Inbox, description: "Pending QA & approvals" },
    ],
  },
  {
    label: "Boardroom",
    href: "/boardroom",
    matchPaths: ["/boardroom"],
  },
];

const entrepreneurNav: NavGroup[] = [
  {
    label: "Discover",
    matchPaths: ["/opportunity-map", "/whitespace", "/competitor-scan"],
    children: [
      { href: "/opportunity-map", label: "Opportunity Map", icon: Map, description: "Quadrant view of capability white space" },
      { href: "/whitespace", label: "White-Space Scanner", icon: ScanLine, description: "High velocity + low moat + high disruption" },
      { href: "/competitor-scan", label: "Competitor Scan", icon: Search, description: "Get a competitor's capability profile" },
    ],
  },
  {
    label: "Plan",
    matchPaths: ["/build-path", "/innovation", "/pitch-snippets"],
    children: [
      { href: "/build-path", label: "Build Path", icon: Route, description: "Capability dependency DAG" },
      { href: "/innovation", label: "Innovation Pipeline", icon: Rocket, description: "Track in-progress builds" },
      { href: "/pitch-snippets", label: "Pitch Snippets", icon: FileText, description: "Auto-generated capability one-pagers" },
    ],
  },
  {
    label: "Capital",
    matchPaths: ["/investor-match", "/trade-signals"],
    children: [
      { href: "/investor-match", label: "Investor Match", icon: Handshake, description: "PE/VC trade signals mapped to your capability" },
      { href: "/trade-signals", label: "Trade Signals", icon: Target, description: "Where the market is moving" },
    ],
  },
  {
    label: "Learn",
    matchPaths: ["/case-studies", "/insights"],
    children: [
      { href: "/case-studies", label: "Case Studies", icon: BookOpen, description: "Industry primers" },
      { href: "/insights", label: "White Papers", icon: Lightbulb, description: "Long-form research" },
    ],
  },
];

export const PERSONA_NAV: Record<PersonaSlug, NavGroup[]> = {
  pe_vc: peNav,
  researcher: researcherNav,
  academic: academicNav,
  corporate_exec: corpExecNav,
  entrepreneur: entrepreneurNav,
};

// Re-exported for layout.tsx convenience.
export const PERSONA_LIST: PersonaMeta[] = PERSONA_SLUGS.map((s) => PERSONA_META[s]);
