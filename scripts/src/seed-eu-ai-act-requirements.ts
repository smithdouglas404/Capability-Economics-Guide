/**
 * EU AI Act → capability requirement mapping seed.
 *
 * Maps the EU AI Act (Regulation (EU) 2024/1689) to capabilities across
 * the six industries. Risk-tiered framework:
 *   - Prohibited (Art. 5) — unacceptable-risk practices banned
 *   - High-risk (Art. 6-49, Annex III) — conformity assessment, risk
 *     management, data governance, transparency, human oversight,
 *     accuracy/robustness/cybersecurity, post-market monitoring
 *   - Limited-risk (Art. 50) — transparency obligations for chatbots,
 *     deepfakes, emotion recognition
 *   - Minimal-risk — voluntary codes of conduct
 *   - General-purpose AI (Art. 51-55) — additional obligations for GPAI
 *     and systemic-risk GPAI models
 *
 * Phased application: prohibitions effective Feb 2025, GPAI rules Aug
 * 2025, full Annex III high-risk obligations Aug 2026, remaining
 * provisions Aug 2027.
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index to
 * upsert. Re-running refreshes required_maturity / priority / article /
 * evidence_notes without duplicating rows.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Banking (industry 3) — high-risk classification: credit-scoring + insurance/risk underwriting (Annex III §5) ──
  {
    capabilitySlug: "credit-decisioning",
    requiredMaturity: 80,
    priority: "required",
    article: "AI Act Art. 6, Annex III §5(b)",
    evidenceNotes: "Credit scoring is high-risk under Annex III. Requires risk-management system, data governance (Art. 10), technical documentation (Art. 11), record-keeping (Art. 12), transparency (Art. 13), human oversight (Art. 14), accuracy + robustness (Art. 15).",
  },
  {
    capabilitySlug: "behavioral-affordability-assessment-modw192k-49",
    requiredMaturity: 75,
    priority: "required",
    article: "AI Act Art. 10, 13, 14",
    evidenceNotes: "Affordability assessment using AI must meet data-governance, transparency, and human-oversight requirements; explainability of declined applications.",
  },
  {
    capabilitySlug: "regulatory-explainable-compliance-scoring-modw2js9-pd",
    requiredMaturity: 80,
    priority: "required",
    article: "AI Act Art. 13",
    evidenceNotes: "Transparency + provision of information to deployers; user-facing explanations on automated decisions affecting the customer.",
  },
  {
    capabilitySlug: "ai-powered-conversational-commerce-modw1dyu-9k",
    requiredMaturity: 65,
    priority: "required",
    article: "AI Act Art. 50",
    evidenceNotes: "Limited-risk transparency: customers must be informed they are interacting with an AI system; bot identification required by Aug 2026.",
  },

  // ── Insurance (industry 1) — Annex III §5(c): risk + pricing for life + health insurance ──
  {
    capabilitySlug: "pricing-model-development-predictive-underwriting-modvyrex-4",
    requiredMaturity: 80,
    priority: "required",
    article: "AI Act Art. 6, Annex III §5(c)",
    evidenceNotes: "Risk assessment + pricing for life and health insurance is high-risk; full Art. 9-15 obligations on the AI provider + deployer.",
  },
  {
    capabilitySlug: "personalization-usage-based-pricing-engines-modvywz2-8t",
    requiredMaturity: 75,
    priority: "required",
    article: "AI Act Art. 10, 13",
    evidenceNotes: "Usage-based pricing engines using AI: data quality + governance, explainability of pricing factors, customer transparency.",
  },
  {
    capabilitySlug: "actuarial-pricing-rate-making-modvyar5-8g",
    requiredMaturity: 75,
    priority: "required",
    article: "AI Act Art. 14, 15",
    evidenceNotes: "Human oversight + actuarial review of AI-derived rates; accuracy and robustness testing across protected categories.",
  },

  // ── Healthcare (industry 2) — high-risk for medical devices (Annex III §5(a) where AI-based) + workforce + biometric ──
  {
    capabilitySlug: "diagnostic-decision-support-modvzw1c-7y",
    requiredMaturity: 80,
    priority: "required",
    article: "AI Act Art. 6, Annex I + III",
    evidenceNotes: "AI-based diagnostic decision support is high-risk (intersects MDR + IVDR). Conformity assessment, post-market monitoring, robustness testing.",
  },
  {
    capabilitySlug: "clinical-decision-support",
    requiredMaturity: 75,
    priority: "required",
    article: "AI Act Art. 9-15",
    evidenceNotes: "Clinical AI tools require risk management, data governance, transparency, human oversight, and accuracy/robustness/cybersecurity controls.",
  },
  {
    capabilitySlug: "population-risk-stratification-modvzw1q-pa",
    requiredMaturity: 70,
    priority: "required",
    article: "AI Act Art. 10, 14",
    evidenceNotes: "Risk-stratification models — data-quality + bias mitigation; human-in-the-loop for individual-level interventions.",
  },

  // ── Technology (industry 5) — General-Purpose AI providers + AI-system providers ──
  {
    capabilitySlug: "governance-compliance-experimentation-modw4g8w-hf",
    requiredMaturity: 80,
    priority: "required",
    article: "AI Act Art. 9, 17",
    evidenceNotes: "Quality + risk management system covering the AI lifecycle; documented experimentation governance with traceability.",
  },
  {
    capabilitySlug: "ml-monitoring-observability-modw4g8m-f6",
    requiredMaturity: 80,
    priority: "required",
    article: "AI Act Art. 12, 72",
    evidenceNotes: "Record-keeping (automatic event logging) over the AI system's lifetime; post-market monitoring obligations.",
  },
  {
    capabilitySlug: "model-training-optimization-modw4g7s-42",
    requiredMaturity: 75,
    priority: "required",
    article: "AI Act Art. 10, 53-55",
    evidenceNotes: "Training data governance — quality, representativeness, bias mitigation. GPAI providers: technical documentation, copyright compliance, training-data summary publication.",
  },
  {
    capabilitySlug: "model-deployment-serving-modw4g8b-fb",
    requiredMaturity: 75,
    priority: "required",
    article: "AI Act Art. 14, 26",
    evidenceNotes: "Deployer obligations: ensure human oversight measures are operational; usage monitoring; suspension if serious risk identified.",
  },
  {
    capabilitySlug: "data-protection-privacy-compliance-modw4q8j-gx",
    requiredMaturity: 75,
    priority: "required",
    article: "AI Act Art. 10, 15",
    evidenceNotes: "AI-system cybersecurity + data-protection controls; resistance to adversarial inputs, data-poisoning, model evasion.",
  },

  // ── Retail (industry 6) — personalization + recommendation engines + biometric/emotion (Annex III §1 prohibited for retail) ──
  {
    capabilitySlug: "real-time-decisioning-contextual-ranking-modw5sfy-ex",
    requiredMaturity: 70,
    priority: "required",
    article: "AI Act Art. 50, Annex III",
    evidenceNotes: "AI-powered ranking + recommendation: transparency to consumers, opt-out where automated decisions have significant effects; emotion-recognition prohibited in workplace + education.",
  },
  {
    capabilitySlug: "personalization-recommendation-engine-modw6s76-cu",
    requiredMaturity: 70,
    priority: "required",
    article: "AI Act Art. 50",
    evidenceNotes: "Limited-risk transparency: consumers informed of AI use; profiling boundaries respected (no subliminal manipulation per Art. 5).",
  },
  {
    capabilitySlug: "predictive-analytics-propensity-modeling-modw72ir-om",
    requiredMaturity: 65,
    priority: "required",
    article: "AI Act Art. 5, 50",
    evidenceNotes: "Predictive analytics may not exploit vulnerabilities (Art. 5(1)(b)); social-scoring practices prohibited (Art. 5(1)(c)).",
  },

  // ── Manufacturing (industry 4) — high-risk for safety components (Annex I) + workforce monitoring (Annex III §4) ──
  {
    capabilitySlug: "ai-driven-predictive-maintenance-modw3lhs-f5",
    requiredMaturity: 70,
    priority: "required",
    article: "AI Act Art. 6, Annex I",
    evidenceNotes: "AI as safety component of machinery covered by harmonized EU legislation — high-risk classification; conformity assessment integrated with machinery-directive procedures.",
  },
  {
    capabilitySlug: "autonomous-production-control-systems-modw3li1-dk",
    requiredMaturity: 70,
    priority: "required",
    article: "AI Act Art. 9-15",
    evidenceNotes: "AI in production control must meet high-risk obligations: risk management, data governance, transparency, human oversight, robustness.",
  },
  {
    capabilitySlug: "anomaly-detection-pattern-recognition-modw2ufp-4p",
    requiredMaturity: 65,
    priority: "recommended",
    article: "AI Act Art. 12",
    evidenceNotes: "Automatic event logging for anomaly-detection AI feeding safety decisions; supports traceability + incident investigation.",
  },
];

proposeRequirements({
  regulationShortCode: "EU-AI-Act",
  proposedBy: "seed:eu-ai-act-requirements",
  logLabel: "seed:eu-ai-act-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:eu-ai-act-reqs] fatal:", err);
    process.exit(1);
  });
