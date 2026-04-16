import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Target, LineChart, Zap, Building2, Shield, Users, BookOpen, Clock, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import AgentMemoryShowcase from "@/components/agent-memory-showcase";
import WhatIsCEModal from "@/components/what-is-ce-modal";

interface EducationalContent {
  id: number;
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  keyTakeaways: string[];
  sources: { url: string; title: string }[];
  category: string;
  estimatedReadMinutes: number;
}

function EducationalLibrary() {
  const [items, setItems] = useState<EducationalContent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/educational-content")
      .then(r => r.ok ? r.json() : [])
      .then((d: EducationalContent[]) => { setItems(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading || items.length === 0) return null;

  return (
    <section className="py-24 bg-muted/30 border-t">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <div className="inline-flex items-center gap-2 text-primary text-sm font-semibold uppercase tracking-wider mb-3">
            <BookOpen className="w-4 h-4" /> Foundational Library
          </div>
          <h2 className="text-3xl md:text-4xl font-serif text-foreground">Learn the Discipline</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {items.map(item => (
            <Card key={item.id} className="bg-card border shadow-sm h-full rounded-none flex flex-col" data-testid={`edu-card-${item.slug}`}>
              <CardHeader className="flex-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-2 uppercase tracking-wider">
                  <span className="font-semibold text-primary">{item.category}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{item.estimatedReadMinutes} min</span>
                </div>
                <CardTitle className="font-serif text-xl">{item.title}</CardTitle>
                <CardDescription className="text-base text-muted-foreground">{item.summary}</CardDescription>
              </CardHeader>
              <CardContent className="border-t pt-4">
                <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                  {item.keyTakeaways.slice(0, 3).map((t, i) => (
                    <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{t}</span></li>
                  ))}
                </ul>
                {item.sources.length > 0 && (
                  <a href={item.sources[0].url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                    <ExternalLink className="w-3 h-3" /> {item.sources[0].title}
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

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

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative py-24 lg:py-32 overflow-hidden border-b">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="max-w-4xl"
          >
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary mb-6">
              Executive Briefing
            </div>
            <h1 className="text-5xl md:text-7xl font-serif font-medium tracking-tight mb-6 text-foreground">
              Master the Value of <br />
              <span className="text-primary italic">What You Can Do.</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-4 max-w-2xl leading-relaxed">
              Capability Economics is the discipline of understanding, measuring, and optimizing the economic value of your organization's core capabilities.
            </p>
            <div className="mb-8">
              <WhatIsCEModal />
            </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/c-suite" className="inline-flex h-12 items-center justify-center whitespace-nowrap px-8 text-base font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" data-testid="hero-cta-csuite">
                Explore C-Suite Perspectives
                <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
              <Link href="/insurance-example" className="inline-flex h-12 items-center justify-center whitespace-nowrap border border-input bg-background px-8 text-base font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" data-testid="hero-cta-insurance">
                View Industry Case Study
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Definition Section */}
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-serif mb-6 text-foreground">What is Capability Economics?</h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Think of a capability as a muscle your organization has built—like "rapid order fulfillment" or "precision underwriting." Capability Economics stops treating these muscles as just operational processes, and starts treating them as <strong>economic assets</strong> that can be measured, valued, and invested in.
            </p>
          </div>

          <motion.div 
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto"
          >
            <motion.div variants={item}>
              <Card className="bg-card border-none shadow-sm h-full rounded-none">
                <CardHeader>
                  <Target className="w-10 h-10 text-primary mb-4" />
                  <CardTitle className="font-serif text-xl">Identify</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">Isolate the specific combinations of people, process, and technology that create distinct value in the market.</p>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={item}>
              <Card className="bg-card border-none shadow-sm h-full rounded-none">
                <CardHeader>
                  <LineChart className="w-10 h-10 text-primary mb-4" />
                  <CardTitle className="font-serif text-xl">Measure</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">Quantify the baseline cost, performance, and revenue impact of each capability using hard economic metrics.</p>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={item}>
              <Card className="bg-card border-none shadow-sm h-full rounded-none">
                <CardHeader>
                  <Zap className="w-10 h-10 text-primary mb-4" />
                  <CardTitle className="font-serif text-xl">Optimize</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">Direct capital and leadership attention to the capabilities that drive the highest return on strategic investment.</p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* The Analogy */}
      <section className="py-24 border-t">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center gap-12 max-w-6xl mx-auto">
            <div className="flex-1">
              <h2 className="text-3xl font-serif mb-6 text-foreground">The Real Estate Analogy</h2>
              <div className="space-y-6 text-lg text-muted-foreground">
                <p>
                  Imagine you own a large commercial building. If you don't know the square footage, the rental yield per floor, or the maintenance costs of the HVAC system, you can't make smart decisions about renovations.
                </p>
                <p>
                  Most companies treat their capabilities like that opaque building. They know the total budget, but they don't know the "rental yield" of their customer onboarding process versus their product development process.
                </p>
                <p className="font-medium text-foreground border-l-4 border-primary pl-4 py-1">
                  Capability Economics provides the blueprint and the ledger, allowing you to renovate the exact floors that generate the highest returns.
                </p>
              </div>
            </div>
            <div className="flex-1 bg-muted p-8 flex items-center justify-center relative overflow-hidden rounded-sm">
               <Building2 className="w-48 h-48 text-primary/10 absolute -right-8 -bottom-8" />
               <div className="relative z-10 flex flex-col gap-6 w-full max-w-sm">
                  <div className="bg-background p-6 border-l-4 border-muted shadow-sm">
                    <span className="text-sm text-muted-foreground font-semibold uppercase tracking-wider block mb-1">Traditional View</span>
                    <span className="text-2xl font-serif text-foreground block">IT Budget: $4.2M</span>
                    <span className="text-sm text-muted-foreground">Opaque cost center</span>
                  </div>
                  <div className="bg-background p-6 border-l-4 border-primary shadow-md transform translate-x-4">
                    <span className="text-sm text-primary font-semibold uppercase tracking-wider block mb-1">Capability View</span>
                    <span className="text-2xl font-serif text-foreground block">Digital Onboarding: $1.8M</span>
                    <span className="text-sm text-muted-foreground">Generates $8.5M in retained value</span>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Editor-managed educational content (CMS) */}
      <EducationalLibrary />

      {/* Autonomous Agent Memory Showcase */}
      <AgentMemoryShowcase />

      {/* Navigation Cards */}
      <section className="py-24 bg-foreground text-background">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-serif mb-4 text-background">Continue Your Briefing</h2>
            <p className="text-muted/80 text-lg">Explore how Capability Economics transforms decision-making across industries and leadership roles.</p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <Link href="/insurance-example" className="group block h-full" data-testid="nav-card-insurance">
              <Card className="h-full bg-background/10 border-none hover:bg-background/20 transition-colors cursor-pointer rounded-none text-background">
                <CardHeader>
                  <Shield className="w-8 h-8 text-primary mb-2" />
                  <CardTitle className="font-serif text-2xl group-hover:text-primary transition-colors text-background">Industry Case: Insurance</CardTitle>
                  <CardDescription className="text-muted/80 text-base">
                    See capability economics in action. Watch how an insurance carrier optimized claims processing and underwriting.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
            
            <Link href="/c-suite" className="group block h-full" data-testid="nav-card-csuite">
              <Card className="h-full bg-background/10 border-none hover:bg-background/20 transition-colors cursor-pointer rounded-none text-background">
                <CardHeader>
                  <Users className="w-8 h-8 text-accent mb-2" />
                  <CardTitle className="font-serif text-2xl group-hover:text-accent transition-colors text-background">C-Suite Perspectives</CardTitle>
                  <CardDescription className="text-muted/80 text-base">
                    How different executives leverage capability economics to drive strategy.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
