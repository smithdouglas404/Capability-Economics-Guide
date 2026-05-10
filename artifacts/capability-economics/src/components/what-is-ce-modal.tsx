import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, Settings, Cpu, AlertTriangle, Bot, ArrowRight } from "lucide-react";

export default function WhatIsCEModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        What is Capability Economics?
        <ArrowRight className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Dialog */}
            <motion.div
              key="dialog"
              initial={{ opacity: 0, y: 40, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-background border border-border shadow-2xl pointer-events-auto"
                onClick={e => e.stopPropagation()}
              >
                {/* Close */}
                <button
                  onClick={() => setOpen(false)}
                  className="absolute top-4 right-4 z-10 p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Header */}
                <div className="px-8 pt-8 pb-6 border-b border-border">
                  <div className="inline-flex items-center gap-2 mb-2">
                    <span className="h-px w-4 bg-accent" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Executive Primer</span>
                  </div>
                  <h2 className="text-3xl font-serif tracking-tight text-foreground">What is Capability Economics?</h2>
                  <p className="mt-3 text-muted-foreground text-base leading-relaxed max-w-xl">
                    The study of how a company's internal capabilities — the unique combination of people, processes, and technology — drive financial performance.
                  </p>
                </div>

                <div className="px-8 py-8 space-y-10">

                  {/* Core question */}
                  <blockquote className="border-l-4 border-primary pl-5 py-1">
                    <p className="text-lg font-serif text-foreground leading-relaxed">
                      "Does doing this specific thing make us more money than it costs us to maintain the ability to do it?"
                    </p>
                  </blockquote>

                  {/* Traditional vs Capability */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Two Lenses</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-muted/40 border border-border p-5">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Traditional Economics</div>
                        <p className="text-sm text-foreground leading-relaxed">
                          Focuses on market share, pricing power, and external competition. Treats the firm as a black box that responds to market forces.
                        </p>
                      </div>
                      <div className="bg-primary/5 border border-primary/20 p-5">
                        <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">Capability Economics</div>
                        <p className="text-sm text-foreground leading-relaxed">
                          Focuses on the cost of complexity versus the value of excellence. Opens the black box and puts a dollar value on what's inside.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CEOs and CFOs */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Do CEOs and CFOs Still Care?</h3>
                    <p className="text-sm text-muted-foreground mb-4">Absolutely — they use different labels.</p>
                    <div className="space-y-3">
                      {[
                        {
                          icon: TrendingUp,
                          label: "Operating Leverage",
                          desc: "How well the company can increase revenue without a corresponding increase in costs — this is capability efficiency in financial terms.",
                        },
                        {
                          icon: Settings,
                          label: "Core vs. Context",
                          desc: "Spending on what makes the company unique (Core) while automating or outsourcing everything else (Context). Pure Capability Economics.",
                        },
                        {
                          icon: Cpu,
                          label: "Digital Transformation",
                          desc: "Upgrading tech stacks to lower the marginal cost of serving customers. Capability Economics for the modern age.",
                        },
                      ].map(({ icon: Icon, label, desc }) => (
                        <div key={label} className="flex gap-4 p-4 border border-border hover:bg-muted/30 transition-colors">
                          <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <div>
                            <div className="text-sm font-semibold text-foreground mb-0.5">{label}</div>
                            <div className="text-sm text-muted-foreground leading-relaxed">{desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Why CFOs are obsessed */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Why CFOs Are Currently Obsessed</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="flex gap-3 p-4 border border-border">
                        <AlertTriangle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-foreground mb-1">Complexity Killers</div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            Companies often have too many capabilities that don't move the needle — leading to high overhead, slow execution, and invisible cost drag.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3 p-4 border border-border">
                        <Bot className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-foreground mb-1">AI Integration</div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            Every CEO is asking "How does AI change our capabilities?" This is Capability Economics in real time — does an AI-driven capability generate better ROI than a human-heavy one?
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Comparison table */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">The Strategic Shift</h3>
                    <div className="border border-border overflow-hidden">
                      <div className="grid grid-cols-2 bg-muted/50">
                        <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground border-r border-border">The Old Way</div>
                        <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary">The Modern Approach</div>
                      </div>
                      {[
                        ["Focus on internal processes only", "The AI Capability Gap: how to bridge it"],
                        ["Manual cost-benefit analysis", "Capability Benchmarking: compare to the best"],
                        ["Long-term strategic planning only", "Agile Capability Building: respond to market shifts"],
                      ].map(([old, modern], i) => (
                        <div key={i} className="grid grid-cols-2 border-t border-border">
                          <div className="px-4 py-3 text-sm text-muted-foreground border-r border-border">{old}</div>
                          <div className="px-4 py-3 text-sm text-foreground font-medium">{modern}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* Footer */}
                <div className="px-8 py-5 border-t border-border bg-muted/20 flex items-center justify-between gap-4">
                  <p className="text-xs text-muted-foreground">
                    The Capability Economics Index (CEI) quantifies these principles into a live, benchmarked score updated 3× daily.
                  </p>
                  <button
                    onClick={() => setOpen(false)}
                    className="shrink-0 inline-flex h-9 items-center px-4 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Got it
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
