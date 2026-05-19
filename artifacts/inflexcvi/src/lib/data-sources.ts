/**
 * Data-source registry — the canonical list of where Capability Economics
 * gets its data. Move 9 of the strategic UX overhaul reframes the
 * platform's epistemic position: we're not just a Perplexity wrapper, we
 * route through World Bank for GDP, Palantir Foundry for enrichment
 * pipelines, World Economic Forum frameworks for scoring calibration,
 * BEA for sector splits, and so on. This registry is the single source
 * of truth for the per-score SourceBadge UI and the /provenance page.
 *
 * Adding a new source: append below and re-use the slug as the SourceBadge
 * `source` prop. The tone classes map to standard Tailwind colors so the
 * chip palette stays coherent across the app.
 *
 * NOTE: "perplexity-seeded" is a real but lower-confidence tier — used
 * for LLM-augmented research where the source URL is the primary
 * citation, not the model itself. Distinguished from "perplexity" (no
 * such label exists) to avoid implying we trust raw model output.
 */

export type DataSourceSlug =
  | "world-bank"
  | "world-economic-forum"
  | "palantir-foundry"
  | "us-bea"
  | "uspto"
  | "edgar"
  | "perplexity-seeded"
  | "openai"
  | "anthropic"
  | "internal"
  | "user-input";

export interface DataSource {
  slug: DataSourceSlug;
  label: string;
  /** What kind of data it provides. */
  kind: "primary-data" | "framework" | "pipeline" | "llm-research" | "llm-model" | "user-input";
  /** One-line summary used in tooltips and the /provenance table. */
  description: string;
  /** Confidence tier — affects how scores cited from this source are weighted in the engine. */
  trust: "high" | "medium" | "low";
  /** Public methodology / homepage URL. */
  homepage?: string;
  /** Where in our app this source's data shows up. */
  surfaceExamples?: string[];
  /** Tone class for the SourceBadge chip. */
  tone: "blue" | "emerald" | "amber" | "rose" | "violet" | "slate";
}

export const DATA_SOURCES: Record<DataSourceSlug, DataSource> = {
  "world-bank": {
    slug: "world-bank",
    label: "World Bank",
    kind: "primary-data",
    description: "Official sector value-added (% of GDP) indicators NV.IND.MANF.ZS, NV.IND.TOTL.ZS, NV.SRV.TOTL.ZS — drives our industry GDP weights for the CVI rollup.",
    trust: "high",
    homepage: "https://data.worldbank.org/",
    surfaceExamples: ["Industry GDP weights on /cvi", "Sector splits in /alpha capital-flow"],
    tone: "blue",
  },
  "world-economic-forum": {
    slug: "world-economic-forum",
    label: "World Economic Forum",
    kind: "framework",
    description: "Global Competitiveness Index 4.0 (12 pillars), Future of Jobs Report, Human Capital Index — used as calibration scaffolding for capability scoring at /assess.",
    trust: "high",
    homepage: "https://www.weforum.org/publications/",
    surfaceExamples: ["Scoring calibration in /assess prompts", "Methodology references in agent tool prompts"],
    tone: "blue",
  },
  "palantir-foundry": {
    slug: "palantir-foundry",
    label: "Palantir Foundry",
    kind: "pipeline",
    description: "Enterprise data pipelines — syncs canonical industry / capability / quadrant data through Foundry's transaction-safe upload API. Hourly catch-up cron runs in production.",
    trust: "high",
    homepage: "https://www.palantir.com/platforms/foundry/",
    surfaceExamples: ["Hourly capability sync", "ce_industries / ce_capabilities / ce_companies datasets"],
    tone: "emerald",
  },
  "us-bea": {
    slug: "us-bea",
    label: "US BEA",
    kind: "primary-data",
    description: "US Bureau of Economic Analysis sector splits — used to refine World Bank industry-level weights for US-specific applications.",
    trust: "high",
    homepage: "https://www.bea.gov/data/",
    surfaceExamples: ["GDP weight refinements on US-focused industries"],
    tone: "blue",
  },
  "uspto": {
    slug: "uspto",
    label: "USPTO",
    kind: "primary-data",
    description: "US patent + trademark filings — counted into the patents-by-stage column on /companies value-chain profile (via the external-signals ingest).",
    trust: "high",
    homepage: "https://www.uspto.gov/",
    surfaceExamples: ["Patents column on /companies value-chain table"],
    tone: "emerald",
  },
  edgar: {
    slug: "edgar",
    label: "SEC EDGAR",
    kind: "primary-data",
    description: "SEC EDGAR current-filings RSS feed — polled every 15 minutes; macro events flagged from material 8-K / S-1 filings feed the disruption detector.",
    trust: "high",
    homepage: "https://www.sec.gov/edgar/",
    surfaceExamples: ["Macro events on /cvi sidebar", "Disruption Watch triggers on /disruption"],
    tone: "emerald",
  },
  "perplexity-seeded": {
    slug: "perplexity-seeded",
    label: "Perplexity (seeded)",
    kind: "llm-research",
    description: "Perplexity Sonar models cite their sources — we use Perplexity for cited research where the cited URL (not the model itself) is what we record. Lower-confidence tier than primary-data sources.",
    trust: "low",
    homepage: "https://www.perplexity.ai/",
    surfaceExamples: ["External-signals fallback when no primary source", "Capability discovery for new industries"],
    tone: "amber",
  },
  openai: {
    slug: "openai",
    label: "OpenAI",
    kind: "llm-model",
    description: "Whisper for audio transcription on /vcr voice intake; TTS for the audio responses on /vcr. Both via direct OpenAI API.",
    trust: "medium",
    homepage: "https://platform.openai.com/",
    surfaceExamples: ["/vcr voice intake transcription", "/vcr audio responses"],
    tone: "violet",
  },
  anthropic: {
    slug: "anthropic",
    label: "Anthropic Claude",
    kind: "llm-model",
    description: "Claude Sonnet + Haiku via OpenRouter for narrative synthesis, structured workflows, capability decomposition, and the tour guide. Cost reported per-call via OpenRouter's usage flag.",
    trust: "medium",
    homepage: "https://www.anthropic.com/",
    surfaceExamples: ["AI tour guide", "Insights narrative", "VCR report synthesis", "Sub-capability decomposition"],
    tone: "violet",
  },
  internal: {
    slug: "internal",
    label: "Capability Economics",
    kind: "framework",
    description: "Our own Bayesian posterior model, confidence formula, and capability taxonomy — see /methodology for the full derivation.",
    trust: "high",
    surfaceExamples: ["CVI / DVX index math", "Capability dependency graph", "Sub-capability rollup"],
    tone: "slate",
  },
  "user-input": {
    slug: "user-input",
    label: "Your data",
    kind: "user-input",
    description: "Data you uploaded — your assessments, your business plan, your scorecard. Never shared without your consent; processed in your account scope only.",
    trust: "high",
    surfaceExamples: ["/assess self-assessment", "Future: /upload business-plan analysis"],
    tone: "slate",
  },
};

/**
 * Common groupings for the /provenance page. Keep this in the same file
 * so adding a new source updates both the registry and the grouping in
 * one edit.
 */
export const SOURCE_GROUPS: Array<{ heading: string; description: string; slugs: DataSourceSlug[] }> = [
  {
    heading: "Primary data",
    description: "Authoritative third-party data feeds. High trust — score citations from these sources are weighted the most heavily in our engine.",
    slugs: ["world-bank", "world-economic-forum", "us-bea", "uspto", "edgar", "palantir-foundry"],
  },
  {
    heading: "Internal models",
    description: "Our own work — the math, the taxonomy, the engine. See /methodology for the derivation.",
    slugs: ["internal"],
  },
  {
    heading: "LLM-augmented research",
    description: "Where we use language models. We distinguish research (URLs cited, lower-trust tier) from synthesis (narrative wrapping of already-cited data).",
    slugs: ["perplexity-seeded", "anthropic", "openai"],
  },
  {
    heading: "Your data",
    description: "Anything you put into the platform — assessments, uploads, scorecards.",
    slugs: ["user-input"],
  },
];

export function sourceFor(slug: DataSourceSlug): DataSource {
  return DATA_SOURCES[slug];
}
