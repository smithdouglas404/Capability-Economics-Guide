import { Link } from "wouter";
import { ArrowLeft, BookOpen, Calculator, Database, Scale, Sigma, GitBranch, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-none bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
        <h2 className="font-serif text-2xl tracking-tight text-foreground">{title}</h2>
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/85 leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 px-4 py-3 rounded-none border border-border/60 bg-muted/40 font-mono text-[12.5px] text-foreground/90 overflow-x-auto whitespace-pre-wrap">
      {children}
    </div>
  );
}

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "data-sources", label: "Data sources & weights" },
  { id: "bayesian", label: "Bayesian posterior" },
  { id: "confidence", label: "Confidence math" },
  { id: "gdp-weighting", label: "GDP weighting & scale" },
  { id: "lifecycle", label: "Lifecycle derivation" },
  { id: "worked-example", label: "Worked example" },
  { id: "limits", label: "Limits & caveats" },
];

export default function Methodology() {
  return (
    <div className="min-h-[calc(100dvh-64px)] bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to home
          </Link>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              v1.1 — Methodology white paper
            </Badge>
            <Badge variant="secondary" className="text-[10px]">Public</Badge>
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl tracking-tight text-foreground">
            How the Capability Value Index is calculated
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-3xl leading-relaxed">
            Every numeric score in this product is a posterior estimate from a transparent Bayesian
            model fed by independently-cited sources. This page documents the math, the source weights,
            the confidence formula, and a fully worked example so any score in the app can be audited
            end-to-end against the open-source engine.
          </p>
        </div>

        <div className="grid lg:grid-cols-[220px_1fr] gap-10">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                On this page
              </div>
              <nav className="space-y-1">
                {TOC.map((t) => (
                  <a
                    key={t.id}
                    href={`#${t.id}`}
                    className="block text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                  >
                    {t.label}
                  </a>
                ))}
              </nav>
              <Separator className="my-4" />
              <Card className="rounded-none">
                <CardContent className="p-3 text-[11px] text-muted-foreground leading-relaxed">
                  Hover or focus any score in the app to see its sources, citation count,
                  last-updated time, and confidence band — every number traces back to this document.
                </CardContent>
              </Card>
            </div>
          </aside>

          <div className="space-y-12">
            <Section id="overview" icon={BookOpen} title="Overview">
              <p>
                The <strong>Capability Value Index (CVI)</strong> measures how well an industry —
                and each capability inside it — is performing. Per-capability <em>consensus scores</em>{" "}
                live on a <strong>0–100 scale</strong>; per-industry indices and the global rollup are
                multiplied by a fixed <strong>×10 scale factor</strong> for display, so industry indices
                read on a 0–1000 range.
              </p>
              <p>
                Three principles govern every number:
              </p>
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>
                  <strong>No editorial fallback.</strong> If we don&apos;t have a Perplexity-cited
                  source, the score is not produced. Industries without a backing GDP weight are
                  excluded from the rollup, never assigned a default.
                </li>
                <li>
                  <strong>Posterior over point estimate.</strong> Every score ships with a 95% credible
                  interval derived from posterior variance, never a hand-tuned confidence label.
                </li>
                <li>
                  <strong>Provenance on every number.</strong> Open the popover on any score in the app
                  to see source list, citation URLs, last-update timestamp, and the model version used.
                </li>
              </ol>
            </Section>

            <Section id="data-sources" icon={Database} title="Data sources & weights">
              <p>
                Each capability is scored independently by four perspective groups. Each perspective
                contributes a <code>rawScore ∈ [0, 100]</code> and a <code>weight ∈ (0, 1]</code> that
                reflects its empirical reliability on that capability domain:
              </p>
              <div className="not-prose grid sm:grid-cols-2 gap-3 my-3">
                {[
                  { label: "Consulting Analyst", weight: "0.30", note: "McKinsey, BCG, Bain–style benchmarks (Digital Quotient, DAI, Deloitte DMM). High signal on operational maturity and strategic alignment." },
                  { label: "Market Data Analyst", weight: "0.30", note: "Quantitative reports (Gartner, IDC, Statista, CB Insights). Strong on measurable adoption, spend trends, vendor penetration." },
                  { label: "Academic Researcher", weight: "0.20", note: "Peer-reviewed research and maturity models (CMMI, TDWI). Strong on causal claims, lagging on real-time signal." },
                  { label: "Industry Practitioner", weight: "0.20", note: "Seasoned CDO insight, CIO surveys (Harvey Nash, Foundry, Flexera). High realism on blockers and timelines, narrower sample." },
                ].map((s) => (
                  <Card key={s.label} className="rounded-none">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-semibold">{s.label}</div>
                        <Badge variant="outline" className="font-mono text-[10px]">w = {s.weight}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{s.note}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <p>
                These weights live in <code>artifacts/api-server/src/services/triangulation.ts</code>
                (the <code>PERSPECTIVES</code> array) and are versioned via{" "}
                <code>methodology_version</code> on every <code>cei_snapshots</code> row, so historical
                scores remain reproducible against the methodology that produced them. The two
                quantitative perspectives (consulting + market data) are intentionally the highest-weighted
                because they ground the score in observable benchmarks, while academic + practitioner
                perspectives cross-check for theoretical and on-the-ground reality.
              </p>
            </Section>

            <Section id="bayesian" icon={Sigma} title="Bayesian posterior">
              <p>
                For each capability we treat the unknown &ldquo;true&rdquo; consensus score{" "}
                <code>θ ∈ [0, 100]</code> as a random variable with a deliberately wide,
                weakly-informative Gaussian prior:
              </p>
              <Formula>
                p(θ) = N(μ₀ = 50, σ₀² = 1500)   ⇒  σ₀ ≈ 38.7
              </Formula>
              <p>
                The wide prior (<code>σ₀² = 1500</code>) means that with no triangulation evidence the
                posterior CI is intentionally near-uninformative — we&apos;d rather show a wide band
                than fake precision. <strong>When a capability has zero triangulated sources</strong>,
                the engine takes the prior-only path and falls back to the capability&apos;s seeded{" "}
                <code>benchmarkScore</code> as <code>μ_post</code> (with the full prior variance
                <code>σ_post² = 1500</code>), so the score still has a transparent provenance — the
                seeded benchmark, not a hand-typed default.
              </p>
              <p>
                Each source <em>i</em> reports a noisy observation <code>xᵢ</code> with effective
                variance <code>σᵢ² = 40 / wᵢ</code> where <code>wᵢ</code> is the source weight above.
                Lower weight ⇒ wider observation noise ⇒ less influence on the posterior.
              </p>
              <p>
                The posterior, under conjugacy of independent Gaussian observations and a Gaussian
                prior, is Gaussian with <strong>precision-weighted</strong> mean and variance:
              </p>
              <Formula>
                τ_post = 1/σ₀² + Σᵢ 1/σᵢ²   = 1/1500 + Σᵢ wᵢ/40
                {"\n"}μ_post = ( μ₀/σ₀² + Σᵢ xᵢ/σᵢ² ) / τ_post
                {"\n"}σ_post² = 1 / τ_post
              </Formula>
              <p>
                The <code>consensusScore</code> stored on each <code>cei_components</code> row is{" "}
                <code>μ_post</code>, clamped to <code>[0, 100]</code>. The{" "}
                <code>posteriorVariance</code> column is <code>σ_post²</code>, used to derive the
                credible interval below.
              </p>
              <p>
                <strong>Parent rollups.</strong> Non-leaf capabilities aggregate their children: the
                rollup score is the average of child posterior means, and the rollup variance is{" "}
                <code>(Σ child variance) / n²</code> (variance of the sample mean assuming independent
                children).
              </p>
            </Section>

            <Section id="confidence" icon={Scale} title="Confidence math">
              <p>
                The 95% credible interval reported on every score is the standard ±1.96σ band, clamped
                to the legal <code>[0, 100]</code> range:
              </p>
              <Formula>
                ciLow  = max(0,   μ_post − 1.96 · σ_post)
                {"\n"}ciHigh = min(100, μ_post + 1.96 · σ_post)
              </Formula>
              <p>
                Alongside the CI, a separate scalar <code>confidence ∈ [0, 1]</code> is published for UI
                affordances (badge colours, sort order). It blends two intuitions: do the sources{" "}
                <em>agree</em> with each other, and do we have <em>enough</em> of them?
              </p>
              <Formula>
                agreementFactor = max(0, 1 − range(xᵢ) / 50)
                {"\n"}coverageFactor  = n_sources / 4
                {"\n"}confidence      = min(1, 0.6 · agreementFactor + 0.4 · coverageFactor)
              </Formula>
              <p>
                Where <code>range(xᵢ)</code> is the max minus min of the source observations on the
                0–100 scale. A 50-point spread between sources zeros the agreement term; four diverse
                sources saturates the coverage term. The 60/40 weighting prioritises agreement —
                because a tight cluster of sources is stronger evidence than many sources that disagree.
              </p>
              <p>
                For parent rollups, confidence is{" "}
                <code>avg(child confidence) · max(0, 1 − stddev(child scores)/50)</code>, floored at
                0.1, so a parent loses confidence when its children diverge.
              </p>
            </Section>

            <Section id="gdp-weighting" icon={Calculator} title="GDP weighting & scale">
              <p>
                Industry indices are rolled up using <strong>nominal world GDP share</strong> as
                weights. Each share lives in <code>industry_gdp_weights</code> and{" "}
                <em>must</em> have a backing <code>sourceUrl</code>, <code>sourceYear</code>, and at
                least one citation — there is no editorial fallback.
              </p>
              <Formula>
                industryIndex = ( Σ_cap consensusScore_cap · multiplier_cap · confidence_cap · (1+velocity_cap) )
                {"\n"}              ÷ ( Σ_cap multiplier_cap · confidence_cap · (1+velocity_cap) )
                {"\n"}              × 10
              </Formula>
              <p>
                The <strong>×10 scale factor</strong> turns the underlying 0–100 capability scale into
                the 0–1000 industry index range you see in the dashboard. The global CVI is then the
                GDP-share-weighted mean of industry indices:
              </p>
              <Formula>
                CEI_global = ( Σ_industry industryIndex · gdpShare ) / ( Σ_industry gdpShare )
              </Formula>
              <p>
                Industries with no cited GDP weight are <strong>excluded from both numerator and
                denominator</strong>, never silently zero-weighted. The UI flags those rows with a
                &ldquo;no GDP weight&rdquo; marker so the omission is visible.
              </p>
              <p>
                Posterior variance is propagated through the weighted sum so the global CI shrinks
                naturally as more capabilities accumulate sources.
              </p>
            </Section>

            <Section id="lifecycle" icon={GitBranch} title="Lifecycle derivation">
              <p>
                Each capability is assigned one of <strong>five lifecycle stages</strong> —{" "}
                <code>emerging</code>, <code>adopted</code>, <code>mature</code>,{" "}
                <code>decaying</code>, <code>obsolete</code> — derived on read from{" "}
                <code>consensusScore</code> and <code>velocity</code>. The stage is never persisted;
                the derivation lives in <code>artifacts/api-server/src/services/lifecycle.ts</code>{" "}
                and is deterministic so any client computing it from the same inputs gets the same
                answer. Rules are evaluated in this order (first match wins):
              </p>
              <Formula>
                obsolete  ← score &lt; 30   ∧ velocity ≤ −0.03   (low + actively losing ground)
                {"\n"}decaying  ← velocity ≤ −0.03                (any score, sustained downward)
                {"\n"}emerging  ← score &lt; 40   ∧ velocity ≥ +0.03   (still small, climbing fast)
                {"\n"}mature    ← score ≥ 65   ∧ |velocity| &lt; 0.015  (table stakes, stable)
                {"\n"}adopted   ← otherwise                            (mainstream, between extremes)
              </Formula>
              <p>
                Velocity is the EMA-smoothed change in <code>consensusScore</code> divided by 100,
                so a velocity of <code>+0.03</code> means roughly &ldquo;3 points of score per period&rdquo;.
                Thresholds are deliberately conservative so the stage label only flips on meaningful,
                sustained movement.
              </p>
            </Section>

            <Section id="worked-example" icon={Calculator} title="Worked example">
              <p>
                Suppose we&apos;re scoring &ldquo;Generative AI in Underwriting&rdquo; inside the
                Insurance industry. Four perspectives report:
              </p>
              <div className="not-prose my-4 border border-border/60 rounded-none overflow-hidden">
                <table className="w-full text-xs font-mono responsive-table">
                  <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">Source</th>
                      <th className="text-right px-3 py-2">x_i</th>
                      <th className="text-right px-3 py-2">w_i</th>
                      <th className="text-right px-3 py-2">σ_i² = 40/w</th>
                      <th className="text-right px-3 py-2">1/σ_i² = w/40</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {[
                      { s: "Consulting Analyst", x: 62, w: 0.30, var: 133.33, prec: 0.00750 },
                      { s: "Market Data Analyst", x: 70, w: 0.30, var: 133.33, prec: 0.00750 },
                      { s: "Academic Researcher", x: 55, w: 0.20, var: 200.00, prec: 0.00500 },
                      { s: "Industry Practitioner", x: 78, w: 0.20, var: 200.00, prec: 0.00500 },
                    ].map((r) => (
                      <tr key={r.s}>
                        <td className="px-3 py-1.5 text-foreground">{r.s}</td>
                        <td className="px-3 py-1.5 text-right">{r.x}</td>
                        <td className="px-3 py-1.5 text-right">{r.w.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right">{r.var.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right">{r.prec.toFixed(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Prior: <code>μ₀ = 50</code>, <code>σ₀² = 1500</code> ⇒{" "}
                <code>1/σ₀² ≈ 0.000667</code>.
              </p>
              <Formula>
                τ_post  = 0.000667 + 0.00750 + 0.00750 + 0.00500 + 0.00500 = 0.025667
                {"\n"}weighted num = 50·0.000667 + 62·0.00750 + 70·0.00750 + 55·0.00500 + 78·0.00500
                {"\n"}             = 0.03333 + 0.46500 + 0.52500 + 0.27500 + 0.39000
                {"\n"}             = 1.68833
                {"\n"}μ_post  = 1.68833 / 0.025667 ≈ 65.78   (consensusScore)
                {"\n"}σ_post² = 1 / 0.025667 ≈ 38.96   ⇒  σ_post ≈ 6.24
                {"\n"}95% CI  = 65.78 ± 1.96·6.24 = [53.55, 78.01]
              </Formula>
              <p>
                With 4 sources spanning <code>[55, 78]</code> (range = 23):
              </p>
              <Formula>
                agreementFactor = max(0, 1 − 23/50) = 0.54
                {"\n"}coverageFactor  = 4/4         = 1.00
                {"\n"}confidence      = min(1, 0.6·0.54 + 0.4·1.00) = 0.724
              </Formula>
              <p>
                If the Insurance industry index rolls up to ~58 on the 0–100 scale, after the ×10 scale
                factor it surfaces as <strong>580</strong> in the dashboard. With an Insurance GDP
                share of, say, 7.4% (cited from an IMF release with sourceYear 2024), the industry
                contributes <code>580 · 0.074 ≈ 42.9</code> to the global CVI numerator — one of dozens
                of contributions summed across all industries with cited weights.
              </p>
            </Section>

            <Section id="quadrant-multiples" icon={Calculator} title="Quadrant → EV multiples">
              <p>
                The /alpha tab translates a capability's quadrant into an
                enterprise-value-equivalent dollar figure using annual-margin
                multiples. The mapping comes from public-comp medians on growth-stage
                SaaS / financial-services valuations as of 2024–2026:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 mt-3">
                <li><strong>Hot</strong> (rapid scoring, top-quartile velocity) — <code>15× annual margin</code>. Approximates rule-of-40 SaaS comps at high-growth tier.</li>
                <li><strong>Emerging</strong> — <code>10×</code>. Mainstream growth-stage software.</li>
                <li><strong>Cooling</strong> — <code>7×</code>. Mature SaaS / vertical infrastructure.</li>
                <li><strong>Table stakes</strong> — <code>4×</code>. Commodity infrastructure, slow-growth utility tier.</li>
                <li><strong>Declining</strong> — <code>1×</code>. Run-off business, no multiple expansion.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                These multiples are tunable via the <code>alpha_config</code> table
                (no frontend deploy needed for adjustments) and live-fetched by
                the /alpha tab via <code>GET /api/alpha/config/quadrant-multiples</code>.
                They are not derived from any single capability's data — they
                are an industry-wide valuation prior applied uniformly across
                capabilities in the arbitrage view.
              </p>
            </Section>

            <Section id="limits" icon={Scale} title="Limits & caveats">
              <ul className="list-disc pl-5 space-y-1.5">
                <li>
                  <strong>Source independence is assumed, not enforced.</strong> When two perspectives
                  cite the same upstream report, the posterior is over-confident. The agreement term in
                  the confidence formula partially mitigates this but cannot fully eliminate it.
                </li>
                <li>
                  <strong>The Gaussian prior is intentionally vague.</strong>{" "}
                  <code>μ₀ = 50, σ₀² = 1500</code> is broad on purpose — the posterior should be
                  dominated by sources, not by the prior.
                </li>
                <li>
                  <strong>The confidence scalar is a heuristic, not a probability.</strong> It exists
                  for UI affordances; the credible interval is the rigorous uncertainty quantity. Two
                  scores with the same confidence can still have very different CI widths.
                </li>
                <li>
                  <strong>Lifecycle stages are heuristics, not classifiers.</strong> They are useful
                  as a first cut; downstream consumers should rely on the underlying score and velocity.
                </li>
                <li>
                  <strong>GDP weights lag.</strong> They refresh on IMF/World-Bank release cadence;
                  intra-year shifts are not reflected.
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground italic">
                The current methodology version is <code>1.1</code>. Material changes will increment
                the version on every snapshot row, so historical scores remain reproducible against
                the methodology that produced them.
              </p>
              <div className="mt-6">
                <a
                  href="https://github.com/replit/capability-economics"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  View the open-source implementation
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
