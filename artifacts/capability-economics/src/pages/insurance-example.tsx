import { motion } from "framer-motion";
import { Shield, ArrowRight, Activity, Clock, DollarSign, HeartHandshake, FileCheck, CheckCircle2, AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ResponsiveContainer, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, Line, ComposedChart } from "recharts";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

const capabilities = [
  {
    id: "underwriting",
    name: "Precision Underwriting",
    icon: FileCheck,
    description: "The ability to accurately assess risk and price policies competitively without exposing the carrier to outsized losses.",
    traditionalView: "A manual, expert-driven process viewed primarily as a fixed headcount cost.",
    capabilityView: "A scalable risk-arbitrage engine where speed and accuracy directly drive margin.",
    metrics: [
      { name: "Quote Turnaround Time", value: "Reduced from 48h to 2h", trend: "up", icon: Clock },
      { name: "Loss Ratio Impact", value: "Improved by 4.2%", trend: "up", icon: Activity },
      { name: "Cost per Quote", value: "Decreased by 65%", trend: "down", icon: DollarSign }
    ]
  },
  {
    id: "claims",
    name: "Rapid Claims Resolution",
    icon: HeartHandshake,
    description: "The end-to-end process of receiving, adjudicating, and paying out customer claims fairly and quickly.",
    traditionalView: "A back-office operational necessity and unavoidable cost center.",
    capabilityView: "The primary driver of customer retention and brand trust, valued by its impact on lifetime value (LTV).",
    metrics: [
      { name: "First-Touch Resolution", value: "Increased to 45%", trend: "up", icon: CheckCircle2 },
      { name: "NPS Score", value: "+28 points post-claim", trend: "up", icon: HeartHandshake },
      { name: "Fraud Leakage", value: "Reduced by $12M/yr", trend: "down", icon: AlertTriangle }
    ]
  }
];

const roiData = [
  { name: 'Year 1', traditionalCost: 10, capabilityCost: 15, valueGenerated: 12 },
  { name: 'Year 2', traditionalCost: 11, capabilityCost: 14, valueGenerated: 25 },
  { name: 'Year 3', traditionalCost: 12, capabilityCost: 13, valueGenerated: 42 },
  { name: 'Year 4', traditionalCost: 13, capabilityCost: 12, valueGenerated: 65 },
  { name: 'Year 5', traditionalCost: 14, capabilityCost: 12, valueGenerated: 95 },
];

export default function InsuranceExample() {
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <section className="bg-muted/30 py-16 border-b">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-4 mb-6">
             <Shield className="w-12 h-12 text-primary" />
             <div>
               <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Industry Case Study</div>
               <h1 className="text-3xl md:text-5xl font-serif font-medium text-foreground">Property & Casualty Insurance</h1>
             </div>
          </div>
          <p className="text-xl text-muted-foreground leading-relaxed">
            Insurance is fundamentally a business of capabilities. Carriers don't sell physical products; they sell promises. 
            The economic value of an insurer is entirely dictated by how well they execute core capabilities like underwriting and claims processing.
          </p>
        </div>
      </section>

      {/* The Transformation */}
      <section className="py-16 container mx-auto px-4 max-w-5xl">
        <div className="mb-12">
          <h2 className="text-2xl font-serif mb-4 text-foreground">The Capability Transformation</h2>
          <p className="text-lg text-muted-foreground">
            A mid-sized P&C carrier was struggling with profitability. Their traditional budgeting process simply cut costs 5% across the board. 
            By shifting to Capability Economics, they mapped their operations into distinct economic engines and reinvested capital into the areas that drove the highest returns.
          </p>
        </div>

        <motion.div 
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="space-y-12"
        >
          {capabilities.map((cap) => {
            const Icon = cap.icon;
            return (
              <motion.div key={cap.id} variants={item} className="grid md:grid-cols-12 gap-6 bg-card border shadow-sm p-6 md:p-8 rounded-sm">
                
                {/* Capability Description */}
                <div className="md:col-span-5 border-r md:pr-8 border-border">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 rounded-lg bg-primary/10 text-primary">
                      <Icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-serif text-foreground">{cap.name}</h3>
                  </div>
                  <p className="text-muted-foreground text-sm mb-6">{cap.description}</p>
                  
                  <div className="space-y-4">
                    <div className="bg-muted p-4 rounded-sm border-l-2 border-muted-foreground">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Traditional View</div>
                      <div className="text-sm text-foreground">{cap.traditionalView}</div>
                    </div>
                    <div className="bg-primary/5 p-4 rounded-sm border-l-2 border-primary">
                      <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">Economic View</div>
                      <div className="text-sm text-foreground">{cap.capabilityView}</div>
                    </div>
                  </div>
                </div>

                {/* Metrics & Economic Impact */}
                <div className="md:col-span-7 md:pl-4 flex flex-col justify-center">
                   <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">Economic Impact Measured</h4>
                   <div className="grid sm:grid-cols-3 gap-4">
                     {cap.metrics.map((metric, idx) => {
                       const MetricIcon = metric.icon;
                       return (
                         <div key={idx} className="bg-background border rounded-sm p-4 text-center flex flex-col items-center justify-center">
                           <MetricIcon className={`w-5 h-5 mb-2 ${metric.trend === 'up' ? 'text-emerald-500' : 'text-blue-500'}`} />
                           <div className="text-xl font-serif text-foreground mb-1">{metric.value}</div>
                           <div className="text-xs text-muted-foreground font-medium">{metric.name}</div>
                         </div>
                       )
                     })}
                   </div>
                </div>

              </motion.div>
            )
          })}
        </motion.div>
      </section>

      {/* Financial Visualization */}
      <section className="py-16 bg-foreground text-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-serif mb-6 text-background">The ROI of Capability Investment</h2>
              <div className="space-y-4 text-muted/80 text-lg">
                <p>
                  Treating capabilities as economic assets requires an initial capital outlay—often in the form of technology, talent upskilling, and process re-engineering.
                </p>
                <p>
                  However, unlike a traditional "IT Project" that simply depreciates, a fortified capability generates compounding value over time. 
                  The carrier's investment in the "Precision Underwriting" capability (blue line) initially increased costs relative to the traditional baseline, but drove exponential value (green bar) through better risk selection and higher conversion rates over 5 years.
                </p>
              </div>
            </div>
            
            <div className="bg-background/10 p-6 rounded-sm backdrop-blur-sm">
              <h3 className="text-center font-serif text-xl text-background mb-6">5-Year Capability Valuation ($M)</h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={roiData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.7)'}} />
                    <YAxis stroke="rgba(255,255,255,0.5)" tick={{fill: 'rgba(255,255,255,0.7)'}} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--foreground))', border: '1px solid rgba(255,255,255,0.2)', color: 'white' }}
                      itemStyle={{ color: 'white' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '20px', color: 'white' }} />
                    <Bar dataKey="valueGenerated" name="Value Generated" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    <Line type="monotone" dataKey="capabilityCost" name="Capability Cost" stroke="hsl(var(--accent))" strokeWidth={3} dot={{r: 4, fill: 'hsl(var(--accent))'}} />
                    <Line type="monotone" dataKey="traditionalCost" name="Traditional Cost Baseline" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <div className="container mx-auto px-4 max-w-2xl">
          <h2 className="text-2xl font-serif mb-6 text-foreground">See How This Impacts Leadership</h2>
          <p className="text-muted-foreground mb-8 text-lg">
            Capability Economics requires cross-functional alignment. See how different executives view these exact same capabilities.
          </p>
          <Link href="/c-suite">
            <Button size="lg" className="h-12 px-8 text-base bg-primary hover:bg-primary/90 text-primary-foreground rounded-none" data-testid="case-cta-csuite">
              Explore C-Suite Perspectives
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

    </div>
  );
}
