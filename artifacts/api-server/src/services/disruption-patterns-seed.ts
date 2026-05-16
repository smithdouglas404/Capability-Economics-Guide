/**
 * Idempotent seed of the three flagship design-thinking pattern stories
 * (Uber, Stripe, OpenAI). Extracted into its own module so the same content
 * is reachable from:
 *   - the admin endpoint POST /api/admin/patterns/seed
 *   - the CLI seeder scripts/src/seed-patterns.ts (Railway boot chain)
 *
 * Each pattern is keyed on `slug` for upsert. Re-running updates existing
 * rows in place — never duplicates, never drops featured flags.
 */
import { db, disruptionPatternsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface PatternSeed {
  slug: string;
  title: string;
  headline: string;
  disruptorCompany: string;
  incumbentsDisplaced: string[];
  industriesAffected: string[];
  existingCapabilitiesUsed: string[];
  newCapabilityCreated: string;
  crossIndustryAnalogues: string[];
  narrative: string;
  whatToLookFor: string[];
  sources: Array<{ url: string; title: string }>;
  featured: boolean;
}

export const PATTERN_SEEDS: PatternSeed[] = [
  {
    slug: "uber-ride-hailing-platform",
    title: "Uber: inventing the ride-hailing platform",
    headline: "Combined mobile GPS, payments, ratings, and two-sided supply matching into a new capability that displaced taxis and rental cars.",
    disruptorCompany: "Uber",
    incumbentsDisplaced: ["Yellow Cab Co-Op", "Hertz", "Avis", "Local taxi medallions"],
    industriesAffected: ["Transportation", "Logistics", "Local services"],
    existingCapabilitiesUsed: [
      "Mobile GPS / location services",
      "Online payment rails (Stripe / Braintree)",
      "Two-sided ratings / reputation systems",
      "Real-time supply-demand matching algorithms",
      "Push notifications",
    ],
    newCapabilityCreated: "Ride-hailing platform — on-demand matching of distributed drivers to riders with embedded payment, rating, and trust.",
    crossIndustryAnalogues: [
      "DoorDash applied the same pattern to restaurant delivery.",
      "Instacart applied it to grocery shopping.",
      "Airbnb applied a similar two-sided trust pattern to short-term housing.",
    ],
    narrative: `Uber's founders did not improve the taxi. They observed five separately-mature capabilities — mobile GPS, online payments, two-sided ratings, supply-demand matching, and push notifications — and asked: what new capability would emerge if these were assembled into a single user experience?

The answer was the ride-hailing platform: an on-demand network of distributed drivers, summoned by a tap, paid without cash, rated after the trip. None of the underlying capabilities were Uber's invention. The composition was.

The incumbents — Yellow Cab, Hertz, Avis — could not respond because they were optimizing within a different capability. Taxis competed on dispatch efficiency; rental cars on fleet utilization. Neither moved toward the assembled capability because their existing margin came from the unassembled one.

The lesson for a Inflexcvi operator: when you see several mature capabilities in adjacent industries, ask "what new capability could I build by assembling them?" The disruption opportunity is rarely in any one capability — it is in the composition no incumbent has incentive to attempt.`,
    whatToLookFor: [
      "Industries where several capabilities are mature but never assembled into one product surface.",
      "Incumbent margin structures that would be destroyed by the assembly.",
      "Friction points (cash, waiting, dispatch lag) that an assembled capability erases.",
      "Two-sided market dynamics — the assembled capability matches two underserved populations.",
    ],
    sources: [
      { url: "https://www.uber.com/newsroom/history/", title: "Uber: Our company history" },
      { url: "https://hbr.org/2014/11/the-managerial-economics-of-uber", title: "HBR: The Managerial Economics of Uber" },
    ],
    featured: true,
  },
  {
    slug: "stripe-developer-first-payments",
    title: "Stripe: inventing developer-first payments",
    headline: "Built a payments capability that treated the developer experience as the product, displacing decades of merchant-gateway complexity.",
    disruptorCompany: "Stripe",
    incumbentsDisplaced: ["Authorize.Net", "First Data merchant accounts", "PayPal Payments Pro"],
    industriesAffected: ["FinTech", "SaaS", "E-commerce"],
    existingCapabilitiesUsed: [
      "Card network APIs (Visa / Mastercard / Amex)",
      "RESTful API design",
      "Developer documentation as a UX surface",
      "Webhook / event-driven integration patterns",
      "Risk scoring & fraud detection",
    ],
    newCapabilityCreated: "Developer-first payments — programmable money movement integrable in minutes, not weeks, with documentation and SDKs that work the way developers think.",
    crossIndustryAnalogues: [
      "Twilio applied the same pattern to telephony.",
      "Plaid applied it to bank account data.",
      "AWS S3 applied it to file storage two decades earlier.",
    ],
    narrative: `Stripe's bet was not that payments could be processed cheaper. It was that the *integration experience* of payments could become the product. Every existing payments incumbent treated developer experience as documentation overhead; Stripe treated it as the moat.

The capability Stripe invented was not "process a credit card." Card processing was mature. The capability was "a payments API any developer can wire up in a Tuesday afternoon, with onboarding that doesn't require a fax machine and a merchant agreement."

Once that capability existed, every SaaS startup adopted it as the default. Stripe's volume grew on a base of developer-led adoption that the incumbents had no way to match — they were structured around enterprise sales, not API documentation.

The lesson: when an incumbent treats the user experience of integration as a cost center, the integration experience IS the capability worth inventing.`,
    whatToLookFor: [
      "Industries where the developer / operator experience is treated as overhead, not product.",
      "Capabilities that are technically mature but bottlenecked by access friction.",
      "Adjacent industries where the same UX pattern would unlock self-serve adoption.",
    ],
    sources: [
      { url: "https://stripe.com/blog/online-platforms-of-the-future", title: "Stripe blog: Online platforms" },
      { url: "https://www.notboring.co/p/stripe-platform-of-platforms", title: "Not Boring: Stripe — platform of platforms" },
    ],
    featured: true,
  },
  {
    slug: "openai-foundation-model-substrate",
    title: "OpenAI: inventing the foundation-model substrate",
    headline: "Productized a general-purpose foundation model as an API, creating the substrate every subsequent AI agent capability composes against.",
    disruptorCompany: "OpenAI",
    incumbentsDisplaced: ["Per-task supervised ML pipelines", "Bespoke NLP vendors", "Voice transcription point solutions"],
    industriesAffected: ["AI / ML tooling", "SaaS productivity", "Customer support automation", "Content production"],
    existingCapabilitiesUsed: [
      "Transformer architectures (open research)",
      "Web-scale unsupervised pretraining",
      "Reinforcement learning from human feedback (RLHF)",
      "Cloud-scale inference infrastructure",
      "API economy distribution",
    ],
    newCapabilityCreated: "General-purpose foundation model accessible via API — the substrate against which every downstream AI agent, copilot, and automation composes.",
    crossIndustryAnalogues: [
      "Linux played a similar substrate role for cloud-server software.",
      "iOS / Android played the same role for mobile applications.",
      "Postgres has played it (more quietly) for transactional data.",
    ],
    narrative: `Before GPT-3 was made available as an API in 2020, every "AI" capability was a bespoke per-task supervised pipeline: separate models for translation, sentiment analysis, summarization, classification. Each pipeline required labeled data, custom training, and ongoing maintenance. The capability was *task-specific NLP*.

OpenAI's bet was that a single sufficiently-scaled language model could become the substrate against which all of these tasks were composed — and that the right way to distribute the substrate was as an API, not as a model file.

The result was a new capability called "foundation-model substrate." Every downstream AI agent, copilot, retrieval system, and automation platform now composes against it. The substrate is so generative that an entire layer of capabilities — agentic orchestration, structured output, tool use, multi-step reasoning — emerged on top of it within three years.

The lesson: when a single primitive can subsume an entire category of point solutions, the primitive itself is the capability to invent. Distribution as API is non-negotiable — local checkpoints lose to APIs every time on adoption velocity.`,
    whatToLookFor: [
      "Categories of point solutions that share a hidden underlying primitive.",
      "Inference / compute costs that are dropping fast enough to make a general-purpose approach pay off.",
      "Adjacent industries where the same general-purpose substrate unlocks new agent or automation capabilities.",
    ],
    sources: [
      { url: "https://openai.com/blog/openai-api", title: "OpenAI API launch announcement" },
      { url: "https://arxiv.org/abs/2005.14165", title: "GPT-3 paper: Language Models are Few-Shot Learners" },
    ],
    featured: true,
  },
];

export interface SeedSummary {
  inserted: number;
  updated: number;
}

export async function seedDisruptionPatterns(): Promise<SeedSummary> {
  let inserted = 0;
  let updated = 0;
  for (const p of PATTERN_SEEDS) {
    const [existing] = await db.select({ id: disruptionPatternsTable.id }).from(disruptionPatternsTable).where(eq(disruptionPatternsTable.slug, p.slug));
    if (existing) {
      await db.update(disruptionPatternsTable).set({ ...p, updatedAt: new Date() }).where(eq(disruptionPatternsTable.id, existing.id));
      updated += 1;
    } else {
      await db.insert(disruptionPatternsTable).values(p);
      inserted += 1;
    }
  }
  return { inserted, updated };
}
