import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Clock, ExternalLink } from "lucide-react";
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
    <section className="border-t border-border/60">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
        <div className="grid lg:grid-cols-[260px_1fr] gap-10 lg:gap-16 mb-12">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-3">
              § Library
            </div>
            <h2 className="font-serif text-4xl lg:text-5xl leading-[1.05] tracking-tight">
              Learn the<br /><span className="italic text-foreground/85">discipline.</span>
            </h2>
          </div>
          <p className="font-serif italic text-lg text-foreground/70 leading-relaxed self-end max-w-2xl">
            A curated reading list — the foundational ideas, frameworks, and primary sources behind capability economics.
          </p>
        </div>

        <div className="border-t border-border/60">
          {items.map((entry, i) => (
            <Link key={entry.id} href={`#`} className="block group">
              <article
                data-testid={`edu-card-${entry.slug}`}
                className="grid lg:grid-cols-[60px_140px_1fr_auto] gap-x-8 gap-y-3 py-8 border-b border-border/60 hover:bg-muted/30 transition-colors px-2 -mx-2"
              >
                <div className="font-mono text-[11px] tabular-nums tracking-[0.18em] text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                  {entry.category}
                </div>
                <div>
                  <h3 className="font-serif text-2xl lg:text-[1.625rem] leading-tight tracking-tight group-hover:text-foreground/70 transition-colors">
                    {entry.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
                    {entry.summary}
                  </p>
                  {entry.keyTakeaways.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-foreground/70">
                      {entry.keyTakeaways.slice(0, 3).map((t, ti) => (
                        <li key={ti} className="flex gap-2 before:content-['—'] before:text-muted-foreground/60">
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {entry.sources.length > 0 && (
                    <a
                      href={entry.sources[0].url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-accent inline-flex items-center gap-1.5 mt-3"
                    >
                      <ExternalLink className="w-3 h-3" /> {entry.sources[0].title}
                    </a>
                  )}
                </div>
                <div className="font-mono text-[11px] tabular-nums uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5 self-start">
                  <Clock className="w-3 h-3" />
                  {entry.estimatedReadMinutes} min
                </div>
              </article>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

type SlotResponse = {
  source: "slot" | "fallback" | "empty";
  type: "case_study" | null;
  content: {
    industrySlug: string;
    industryName: string;
    title: string;
    executiveSummary: string;
  } | null;
};

function useSlot(slotKey: string) {
  const [state, setState] = useState<SlotResponse | null>(null);
  useEffect(() => {
    fetch(`/api/featured-content/${slotKey}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: SlotResponse | null) => setState(j))
      .catch(() => setState(null));
  }, [slotKey]);
  return state;
}

const fade = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

export default function Home() {
  const heroSlot = useSlot("homepage_hero");
  const cardSlot = useSlot("homepage_case_card");

  const hero = heroSlot?.content;
  const heroSlug = hero?.industrySlug ?? "insurance";
  const heroName = hero?.industryName ?? "Insurance";
  const heroHref = `/case-study/${heroSlug}`;

  const card = cardSlot?.content;
  const cardSlug = card?.industrySlug ?? heroSlug;
  const cardName = card?.industryName ?? heroName;
  const cardBlurb = card?.executiveSummary
    ?? "See capability economics in action. Watch how an organization optimized its core operating capabilities.";
  const cardHref = `/case-study/${cardSlug}`;

  const principles = [
    { id: "01", title: "Identify", body: "Isolate the specific combinations of people, process, and technology that create distinct value in the market." },
    { id: "02", title: "Measure",  body: "Quantify the baseline cost, performance, and revenue impact of each capability using hard economic metrics." },
    { id: "03", title: "Optimize", body: "Direct capital and leadership attention to the capabilities that drive the highest return on strategic investment." },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead + Hero */}
      <section className="border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-12 pb-20 lg:pt-16 lg:pb-28">
          <motion.div
            initial="hidden"
            animate="show"
            variants={fade}
            className="grid lg:grid-cols-[1fr_300px] gap-12 lg:gap-20 items-end"
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-6 flex items-center gap-3">
                <span>Vol. I</span>
                <span className="h-px w-8 bg-border" />
                <span>The Briefing</span>
              </div>
              <h1 className="font-serif text-5xl md:text-7xl lg:text-[5.5rem] leading-[0.95] tracking-tight max-w-5xl">
                Master the value of<br />
                <span className="italic text-foreground/85">what you can do.</span>
              </h1>
              <p className="font-serif text-lg lg:text-xl text-foreground/70 leading-relaxed mt-8 max-w-2xl italic">
                Capability Economics is the discipline of understanding, measuring, and optimizing the economic value of your organization's core capabilities.
              </p>
              <div className="mt-6">
                <WhatIsCEModal />
              </div>
              <div className="flex flex-col sm:flex-row gap-3 mt-10">
                <Link
                  href="/c-suite"
                  data-testid="hero-cta-csuite"
                  className="inline-flex h-11 items-center justify-center px-7 font-sans text-[13px] uppercase tracking-wide bg-foreground text-background hover:bg-foreground/90 transition-colors"
                >
                  C-Suite Perspectives
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Link>
                <Link
                  href={heroHref}
                  data-testid="hero-cta-case-study"
                  className="inline-flex h-11 items-center justify-center px-7 font-sans text-[13px] uppercase tracking-wide border border-border hover:bg-muted/50 transition-colors"
                >
                  {heroName} Case Study
                </Link>
              </div>
            </div>

            {/* Featured industry sidebar — pulls from admin slot */}
            <aside className="lg:border-l lg:border-border/60 lg:pl-10 lg:self-stretch flex flex-col justify-end">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent mb-3">
                Featured Industry
              </div>
              <div className="font-serif text-3xl leading-tight tracking-tight">
                {heroName}
              </div>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                {hero?.executiveSummary ? hero.executiveSummary.slice(0, 180) + (hero.executiveSummary.length > 180 ? "…" : "") : "Read how the framework reshapes capital allocation in this vertical."}
              </p>
              <Link href={heroHref} className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground hover:text-accent mt-4 inline-flex items-center gap-1.5">
                Read the case <ArrowRight className="w-3 h-3" />
              </Link>
            </aside>
          </motion.div>
        </div>
      </section>

      {/* § 01 — Definition + Three principles */}
      <section className="border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
          <div className="grid lg:grid-cols-[260px_1fr] gap-10 lg:gap-16 mb-16">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-3">
                § 01 — Premise
              </div>
              <h2 className="font-serif text-4xl lg:text-5xl leading-[1.05] tracking-tight">
                What is<br /><span className="italic text-foreground/85">capability economics?</span>
              </h2>
            </div>
            <p className="font-serif text-xl lg:text-2xl text-foreground/80 leading-relaxed self-end max-w-3xl">
              Think of a capability as a muscle your organization has built — like <em>rapid order fulfillment</em> or <em>precision underwriting</em>. Capability Economics stops treating these muscles as operational processes, and starts treating them as <span className="text-foreground font-medium not-italic">economic assets</span> that can be measured, valued, and invested in.
            </p>
          </div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
            className="grid lg:grid-cols-3 border-t border-border/60"
          >
            {principles.map((p, i) => (
              <motion.div
                key={p.id}
                variants={fade}
                className={`py-10 lg:py-12 lg:px-10 ${i > 0 ? "lg:border-l lg:border-border/60 border-t lg:border-t-0 border-border/60" : "lg:pl-0 lg:pr-10"}`}
              >
                <div className="font-mono text-[11px] tabular-nums tracking-[0.22em] text-accent mb-4">
                  {p.id}
                </div>
                <h3 className="font-serif text-3xl lg:text-4xl leading-tight tracking-tight mb-4">
                  {p.title}
                </h3>
                <p className="text-base text-foreground/75 leading-relaxed max-w-md">
                  {p.body}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* § 02 — Real estate analogy */}
      <section className="border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
          <div className="grid lg:grid-cols-[1fr_1fr] gap-12 lg:gap-20 items-start">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-3">
                § 02 — Analogy
              </div>
              <h2 className="font-serif text-4xl lg:text-5xl leading-[1.05] tracking-tight mb-8">
                The real estate<br /><span className="italic text-foreground/85">parallel.</span>
              </h2>
              <div className="space-y-5 font-serif text-lg lg:text-xl text-foreground/75 leading-relaxed">
                <p>
                  Imagine you own a commercial building. Without the square footage, the rental yield per floor, or the maintenance costs of the HVAC, you cannot make smart decisions about renovations.
                </p>
                <p>
                  Most companies treat their capabilities exactly like that — opaque. They know the total budget, but not the rental yield of customer onboarding versus product development.
                </p>
              </div>
              <p className="font-serif text-xl lg:text-2xl text-foreground leading-relaxed mt-8 pl-6 border-l-2 border-accent">
                Capability Economics is the blueprint and the ledger — so you renovate the floors that generate the highest returns.
              </p>
            </div>

            <div className="lg:sticky lg:top-24">
              <div className="border border-border/60">
                <div className="border-b border-border/60 p-6 lg:p-8">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-2">
                    Traditional view
                  </div>
                  <div className="font-serif text-3xl lg:text-4xl tracking-tight">IT Budget: <span className="font-mono font-light tabular-nums">$4.2M</span></div>
                  <div className="text-sm text-muted-foreground mt-1.5">Opaque cost center</div>
                </div>
                <div className="p-6 lg:p-8 bg-accent/[0.06] relative">
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent" aria-hidden />
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent mb-2">
                    Capability view
                  </div>
                  <div className="font-serif text-3xl lg:text-4xl tracking-tight leading-tight">
                    Digital Onboarding: <span className="font-mono font-light tabular-nums">$1.8M</span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1.5">
                    Generates <span className="font-mono tabular-nums text-foreground">$8.5M</span> in retained value
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Editor-managed CMS library */}
      <EducationalLibrary />

      {/* Autonomous Agent Memory Showcase (kept as-is) */}
      <AgentMemoryShowcase />

      {/* § Next — Continue your briefing */}
      <section className="bg-foreground text-background">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
          <div className="grid lg:grid-cols-[260px_1fr] gap-10 lg:gap-16 mb-12">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-background/60 mb-3">
                § Next
              </div>
              <h2 className="font-serif text-4xl lg:text-5xl leading-[1.05] tracking-tight">
                Continue your<br /><span className="italic text-background/80">briefing.</span>
              </h2>
            </div>
            <p className="font-serif italic text-lg text-background/70 leading-relaxed self-end max-w-2xl">
              Two paths through the framework — by industry, or by the executive seat where the decisions are made.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 border-t border-background/20">
            <Link
              href={cardHref}
              data-testid="nav-card-case-study"
              className="group block lg:border-r border-background/20 py-12 lg:px-10 lg:py-14"
            >
              <div className="font-mono text-[11px] tabular-nums tracking-[0.22em] text-accent mb-4">
                01 — Industry
              </div>
              <h3 className="font-serif text-3xl lg:text-4xl leading-tight tracking-tight mb-3 group-hover:text-accent transition-colors">
                {cardName} case study
              </h3>
              <p className="text-base text-background/70 leading-relaxed max-w-md mb-5 line-clamp-3">
                {cardBlurb}
              </p>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-background/80 group-hover:text-accent inline-flex items-center gap-1.5 transition-colors">
                Read the case <ArrowRight className="w-3 h-3" />
              </span>
            </Link>

            <Link
              href="/c-suite"
              data-testid="nav-card-csuite"
              className="group block py-12 border-t lg:border-t-0 border-background/20 lg:px-10 lg:py-14"
            >
              <div className="font-mono text-[11px] tabular-nums tracking-[0.22em] text-accent mb-4">
                02 — Role
              </div>
              <h3 className="font-serif text-3xl lg:text-4xl leading-tight tracking-tight mb-3 group-hover:text-accent transition-colors">
                C-Suite perspectives
              </h3>
              <p className="text-base text-background/70 leading-relaxed max-w-md mb-5">
                How different executives leverage capability economics to drive strategy — by seat, by question, by lever.
              </p>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-background/80 group-hover:text-accent inline-flex items-center gap-1.5 transition-colors">
                Browse perspectives <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
