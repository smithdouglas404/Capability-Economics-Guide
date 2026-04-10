import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Briefcase, Cog, CircleDollarSign, MonitorSmartphone, Database, Megaphone, Users, Lightbulb, ChevronRight, CheckCircle2, Target } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

const roles = [
  {
    id: "ceo",
    title: "CEO",
    name: "Chief Executive Officer",
    icon: Briefcase,
    focus: "Strategic Vision & Competitive Advantage",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    chartData: [
      { subject: 'Market Share', A: 90, fullMark: 100 },
      { subject: 'Innovation', A: 85, fullMark: 100 },
      { subject: 'Agility', A: 80, fullMark: 100 },
      { subject: 'Efficiency', A: 60, fullMark: 100 },
      { subject: 'Risk', A: 70, fullMark: 100 },
    ],
    capabilities: ["M&A Integration", "Market Expansion", "Strategic Partnerships"],
    metrics: ["Enterprise Value Contribution", "Time-to-Market for New Offerings"],
    questions: [
      "Which capabilities give us an unfair advantage?",
      "Are we investing in capabilities that competitors can easily replicate?",
      "What capabilities do we need to acquire versus build to enter the next market?"
    ],
    scenario: "The CEO is evaluating a potential acquisition. Instead of just looking at the target's revenue, they use capability economics to assess if the target possesses unique capabilities (like a specialized distribution network) that the parent company lacks, calculating the premium they can afford based on the capability's standalone value."
  },
  {
    id: "coo",
    title: "COO",
    name: "Chief Operating Officer",
    icon: Cog,
    focus: "Operational Efficiency & Process Optimization",
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    chartData: [
      { subject: 'Throughput', A: 95, fullMark: 100 },
      { subject: 'Quality', A: 85, fullMark: 100 },
      { subject: 'Cost Control', A: 90, fullMark: 100 },
      { subject: 'Scalability', A: 70, fullMark: 100 },
      { subject: 'Resilience', A: 80, fullMark: 100 },
    ],
    capabilities: ["Supply Chain Routing", "Inventory Management", "Production Scaling"],
    metrics: ["Cost per Transaction", "Cycle Time", "Defect Rate"],
    questions: [
      "How can we lower the unit cost of our core capabilities without degrading quality?",
      "Where are the bottlenecks in our value-delivery capabilities?",
      "Should we outsource a capability because someone else can do it cheaper and better?"
    ],
    scenario: "The COO is reviewing the supply chain capability. By applying economic valuation, they realize that maintaining an in-house logistics fleet is consuming capital while delivering below-market performance. They transition logistics to a specialized partner, redirecting the freed capital to enhance their proprietary inventory forecasting capability."
  },
  {
    id: "cfo",
    title: "CFO",
    name: "Chief Financial Officer",
    icon: CircleDollarSign,
    focus: "Financial Valuation & ROI of Capabilities",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    chartData: [
      { subject: 'ROI', A: 90, fullMark: 100 },
      { subject: 'Margin', A: 85, fullMark: 100 },
      { subject: 'CapEx Efficiency', A: 95, fullMark: 100 },
      { subject: 'Cash Flow', A: 80, fullMark: 100 },
      { subject: 'Valuation', A: 75, fullMark: 100 },
    ],
    capabilities: ["Capital Allocation", "Risk Hedging", "Financial Forecasting"],
    metrics: ["Return on Capability Investment (ROCI)", "Economic Value Added (EVA) per Capability"],
    questions: [
      "What is the true cost of maintaining this capability vs. the revenue it protects or generates?",
      "Are we over-investing in 'commodity' capabilities that don't drive premium pricing?",
      "How do we depreciate technology assets tied to a specific capability?"
    ],
    scenario: "The CFO is building the annual budget. Instead of allocating +5% to every department, they allocate funding based on capability returns. They slash funding for the generic 'payroll processing' capability (shifting to SaaS) and double the investment in the 'dynamic pricing' capability, which has a proven 15x ROI."
  },
  {
    id: "cto",
    title: "CTO",
    name: "Chief Technology Officer",
    icon: MonitorSmartphone,
    focus: "Technology Capabilities & Digital Transformation",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    chartData: [
      { subject: 'Architecture', A: 90, fullMark: 100 },
      { subject: 'Security', A: 85, fullMark: 100 },
      { subject: 'Tech Debt', A: 60, fullMark: 100 },
      { subject: 'Deploy Speed', A: 95, fullMark: 100 },
      { subject: 'Uptime', A: 80, fullMark: 100 },
    ],
    capabilities: ["Cloud Infrastructure Management", "Continuous Deployment", "System Integration"],
    metrics: ["System Latency", "Technical Debt Ratio", "Feature Lead Time"],
    questions: [
      "Which business capabilities require custom-built technology vs. off-the-shelf software?",
      "How is our legacy architecture constraining the economic value of our customer-facing capabilities?",
      "Are we building technology for its own sake, or to enable a high-value capability?"
    ],
    scenario: "The CTO faces pressure to migrate everything to a new cloud architecture. Using capability economics, they prioritize the migration of the 'Real-time Fraud Detection' capability first, because it directly impacts revenue, leaving the 'Internal Knowledge Base' capability on older infrastructure until it makes economic sense to move."
  },
  {
    id: "cio",
    title: "CIO",
    name: "Chief Information Officer",
    icon: Database,
    focus: "Information Management & Data-Driven Decisions",
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    chartData: [
      { subject: 'Data Quality', A: 85, fullMark: 100 },
      { subject: 'Governance', A: 90, fullMark: 100 },
      { subject: 'Accessibility', A: 80, fullMark: 100 },
      { subject: 'Analytics', A: 75, fullMark: 100 },
      { subject: 'Compliance', A: 95, fullMark: 100 },
    ],
    capabilities: ["Master Data Management", "Business Intelligence", "Information Security"],
    metrics: ["Data Accuracy Score", "Time to Insight", "Cost of Data Storage vs. Usage"],
    questions: [
      "Is our data architecture supporting our most valuable business capabilities?",
      "What is the economic cost of poor data quality in our underwriting capability?",
      "How do we monetize the data generated by our operational capabilities?"
    ],
    scenario: "The CIO maps data assets to business capabilities. They discover that the 'Customer Churn Prediction' capability is starved of real-time usage data. By investing in a pipeline to feed this specific capability, they demonstrably reduce churn, proving the ROI of the data integration effort."
  },
  {
    id: "cmo",
    title: "CMO",
    name: "Chief Marketing Officer",
    icon: Megaphone,
    focus: "Market-Facing Capabilities & Customer Experience",
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
    chartData: [
      { subject: 'Brand Equity', A: 95, fullMark: 100 },
      { subject: 'Acquisition', A: 85, fullMark: 100 },
      { subject: 'Retention', A: 80, fullMark: 100 },
      { subject: 'Personalization', A: 70, fullMark: 100 },
      { subject: 'Attribution', A: 60, fullMark: 100 },
    ],
    capabilities: ["Digital Marketing", "Customer Segmentation", "Brand Management"],
    metrics: ["Customer Acquisition Cost (CAC)", "Customer Lifetime Value (LTV)", "Brand Sentiment"],
    questions: [
      "Which marketing capabilities actually drive conversion vs. just awareness?",
      "Are we spending too much on customer acquisition capabilities instead of retention capabilities?",
      "How do we quantify the value of our 'Omnichannel Personalization' capability?"
    ],
    scenario: "The CMO audits the marketing team's capabilities. They find that the 'Content Production' capability is expensive and slow. They restructure the capability, integrating AI tools to lower the unit cost of content, while shifting budget to the 'Performance Marketing' capability where the economic return is highly measurable."
  },
  {
    id: "chro",
    title: "CHRO",
    name: "Chief Human Resources Officer",
    icon: Users,
    focus: "Talent & Workforce Capabilities",
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10",
    chartData: [
      { subject: 'Acquisition', A: 80, fullMark: 100 },
      { subject: 'Retention', A: 85, fullMark: 100 },
      { subject: 'Skill Dev', A: 70, fullMark: 100 },
      { subject: 'Engagement', A: 90, fullMark: 100 },
      { subject: 'Succession', A: 60, fullMark: 100 },
    ],
    capabilities: ["Talent Acquisition", "Leadership Development", "Performance Management"],
    metrics: ["Time to Fill Critical Roles", "Employee Retention Rate", "Training ROI"],
    questions: [
      "Do we have the right talent to execute our most valuable capabilities?",
      "What is the economic cost of turnover in a highly specialized capability?",
      "Should we build this skill internally or acquire it through hiring/consultants?"
    ],
    scenario: "The CHRO realizes the company's most profitable capability—'Algorithmic Trading'—relies on just three key individuals. Recognizing the severe economic risk, they immediately initiate a capability-building program to cross-train other quants, transforming a fragile dependency into an institutionalized capability."
  },
  {
    id: "cpo",
    title: "CPO",
    name: "Chief Product Officer",
    icon: Lightbulb,
    focus: "Product Capabilities & Innovation",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    chartData: [
      { subject: 'Innovation', A: 95, fullMark: 100 },
      { subject: 'Delivery', A: 80, fullMark: 100 },
      { subject: 'User Exp', A: 90, fullMark: 100 },
      { subject: 'Monetization', A: 75, fullMark: 100 },
      { subject: 'Adaptability', A: 85, fullMark: 100 },
    ],
    capabilities: ["Rapid Prototyping", "User Research", "Lifecycle Management"],
    metrics: ["Feature Adoption Rate", "Time to Value", "R&D Yield"],
    questions: [
      "Which product capabilities differentiate us from the competition?",
      "Are we investing in features that our core capabilities can't support?",
      "How do we measure the economic impact of our 'User Research' capability?"
    ],
    scenario: "The CPO is planning the roadmap. They realize the 'Rapid Prototyping' capability is slow, delaying time-to-market. By investing in better design systems and user testing tools, they increase the throughput of the prototyping capability, directly accelerating revenue generation from new features."
  }
];

export default function CSuite() {
  const [activeRole, setActiveRole] = useState(roles[0].id);

  const activeRoleData = roles.find(r => r.id === activeRole) || roles[0];
  const ActiveIcon = activeRoleData.icon;

  return (
    <div className="min-h-screen bg-background pt-8 pb-24">
      <div className="container mx-auto px-4">
        
        <div className="max-w-3xl mb-12">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary mb-4">
            Interactive Hub
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium tracking-tight mb-4 text-foreground">
            C-Suite Perspectives
          </h1>
          <p className="text-lg text-muted-foreground">
            Capability Economics isn't just for finance. Explore how different executive roles leverage this discipline to drive strategic alignment, allocate resources, and measure success.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-8">
          
          {/* Sidebar */}
          <div className="lg:col-span-4 lg:col-start-1 xl:col-span-3">
            <div className="sticky top-24 space-y-2">
              {roles.map((role) => {
                const Icon = role.icon;
                const isActive = activeRole === role.id;
                return (
                  <button
                    key={role.id}
                    onClick={() => setActiveRole(role.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-all text-left group ${
                      isActive 
                        ? `bg-background shadow-sm border ${role.color}` 
                        : "hover:bg-muted text-muted-foreground"
                    }`}
                    data-testid={`role-selector-${role.id}`}
                  >
                    <div className={`p-2 rounded-md ${isActive ? role.bgColor : 'bg-muted group-hover:bg-background'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className={`font-semibold ${isActive ? 'text-foreground' : ''}`}>{role.title}</div>
                      <div className="text-xs truncate opacity-80">{role.name}</div>
                    </div>
                    {isActive && <ChevronRight className="w-4 h-4 opacity-50" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-8 xl:col-span-9">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeRoleData.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                
                {/* Header Card */}
                <Card className="rounded-none border-t-4 border-t-primary border-x-0 border-b-0 shadow-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4 mb-6">
                      <div className={`p-4 rounded-lg ${activeRoleData.bgColor} ${activeRoleData.color}`}>
                        <ActiveIcon className="w-8 h-8" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-serif text-foreground">{activeRoleData.name}</h2>
                        <div className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                          <Target className="w-4 h-4" />
                          Primary Focus: {activeRoleData.focus}
                        </div>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8">
                       <div>
                         <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-4">Key Capabilities Managed</h3>
                         <ul className="space-y-3">
                           {activeRoleData.capabilities.map((cap, i) => (
                             <li key={i} className="flex items-start gap-2 text-foreground">
                               <CheckCircle2 className={`w-5 h-5 shrink-0 ${activeRoleData.color}`} />
                               <span>{cap}</span>
                             </li>
                           ))}
                         </ul>

                         <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mt-8 mb-4">Economic Metrics</h3>
                         <div className="flex flex-wrap gap-2">
                           {activeRoleData.metrics.map((metric, i) => (
                             <span key={i} className="inline-flex items-center rounded-sm border px-2.5 py-0.5 text-xs font-semibold bg-muted text-muted-foreground">
                               {metric}
                             </span>
                           ))}
                         </div>
                       </div>
                       
                       <div className="bg-muted/30 rounded-lg p-4 flex flex-col items-center justify-center">
                         <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2 self-start w-full">Capability Radar</h3>
                         <div className="h-[200px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                             <RadarChart cx="50%" cy="50%" outerRadius="70%" data={activeRoleData.chartData}>
                               <PolarGrid stroke="hsl(var(--muted-foreground)/0.2)" />
                               <PolarAngleAxis dataKey="subject" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                               <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                               <Radar name={activeRoleData.title} dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
                             </RadarChart>
                           </ResponsiveContainer>
                         </div>
                       </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Scenario & Questions */}
                <div className="grid md:grid-cols-2 gap-6">
                  <Card className="rounded-none bg-background shadow-sm">
                    <CardHeader>
                      <CardTitle className="font-serif text-lg flex items-center gap-2">
                        <Lightbulb className="w-5 h-5 text-accent" />
                        In Action: A Scenario
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground leading-relaxed text-sm">
                        {activeRoleData.scenario}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="rounded-none bg-background shadow-sm border-l-4 border-l-primary">
                    <CardHeader>
                      <CardTitle className="font-serif text-lg flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary" />
                        Key Questions They Ask
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-4 text-sm">
                        {activeRoleData.questions.map((q, i) => (
                          <li key={i} className="text-foreground border-b border-border/50 pb-2 last:border-0 last:pb-0">
                            "{q}"
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>

              </motion.div>
            </AnimatePresence>
          </div>

        </div>
      </div>
    </div>
  );
}
