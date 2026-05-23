/**
 * OSHA → capability requirement mapping seed.
 *
 * Maps the US Occupational Safety and Health Act (OSH Act 1970, plus
 * OSHA standards under 29 CFR 1910 general industry and 29 CFR 1926
 * construction) to Manufacturing capabilities. Core obligation
 * families:
 *   - General Duty Clause (§5(a)(1)) — recognized hazards causing or
 *     likely to cause death or serious physical harm
 *   - Hazard Communication (29 CFR 1910.1200) — chemical labels, SDSs,
 *     written program, employee training
 *   - PPE (29 CFR 1910 Subpart I) — assessment, selection, training,
 *     payment
 *   - Recordkeeping (29 CFR 1904) — Form 300/300A/301; incident
 *     reporting (8-hour for fatalities, 24-hour for inpatient
 *     hospitalization/amputation/eye loss)
 *   - Lockout/tagout (29 CFR 1910.147)
 *   - Confined spaces (29 CFR 1910.146)
 *   - Process Safety Management (PSM) for highly hazardous chemicals
 *     (29 CFR 1910.119) — applies above threshold quantities
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Hazard Assessment + General Duty Clause ──
  {
    capabilitySlug: "hazard-assessment-risk-management-modw3qg2-3t",
    requiredMaturity: 85,
    priority: "required",
    article: "OSH Act §5(a)(1) + 29 CFR 1910 Subpart I (PPE) §1910.132(d)",
    evidenceNotes: "Workplace hazard assessment per 29 CFR 1910.132(d): identify recognized hazards causing or likely to cause death or serious physical harm; document hazards + selected controls + PPE.",
  },

  // ── Safety training + competency ──
  {
    capabilitySlug: "safety-training-competency-certification-modw3qg6-4g",
    requiredMaturity: 80,
    priority: "required",
    article: "29 CFR 1910 (training requirements throughout) + 1910.1200(h)",
    evidenceNotes: "Hazard-Communication training at initial assignment + when new hazards introduced; LOTO authorized/affected employee training; PPE training; confined-space training. Documented competency + retraining cadence.",
  },

  // ── Behavioral safety + culture ──
  {
    capabilitySlug: "safety-culture-behavioral-engagement-modw3qgg-ei",
    requiredMaturity: 75,
    priority: "required",
    article: "OSH Act §11(c) (anti-retaliation)",
    evidenceNotes: "Safety culture supports employee right to report hazards without retaliation; near-miss reporting, behavioral observation programs, leading-indicator tracking.",
  },

  // ── Workforce safety operations (PPE, ergonomic, etc.) ──
  {
    capabilitySlug: "workforce-safety",
    requiredMaturity: 80,
    priority: "required",
    article: "29 CFR 1910 + 1910.132 (PPE)",
    evidenceNotes: "PPE program: assessment, selection, employer payment (1910.132(h)), training, fit testing (for respirators per 1910.134), recordkeeping. Coverage of ergonomic + biological + chemical hazards.",
  },

  // ── Occupational health monitoring ──
  {
    capabilitySlug: "occupational-health-monitoring-wellness-modw3qgb-l6",
    requiredMaturity: 75,
    priority: "required",
    article: "29 CFR 1910.1020 (Access to medical + exposure records) + 29 CFR 1904",
    evidenceNotes: "Employee medical + exposure record retention (duration of employment + 30 years per 1910.1020); employee right of access; OSHA 300/300A/301 recordkeeping per 29 CFR 1904.",
  },

  // ── Emergency response + business continuity ──
  {
    capabilitySlug: "emergency-response-business-continuity-modw3qgj-mv",
    requiredMaturity: 80,
    priority: "required",
    article: "29 CFR 1910.38 (Emergency Action Plans) + 1910.39 (Fire Prevention)",
    evidenceNotes: "Written emergency action plan: procedures for emergency reporting, evacuation, employee accounting, rescue/medical duties; fire prevention plan with hazardous-material control.",
  },

  // ── Incident reporting (29 CFR 1904) ──
  {
    capabilitySlug: "adverse-event-reporting-learning-systems-modw13ng-7w", // healthcare? Yes — but a manufacturing-side similar cap may exist
    requiredMaturity: 75,
    priority: "required",
    article: "29 CFR 1904.39",
    evidenceNotes: "Severe-injury reporting: fatalities within 8 hours; inpatient hospitalizations, amputations, eye losses within 24 hours; Form 300/300A/301 maintained 5 years.",
  },

  // ── Process Safety Management (PSM) — for chemical-handling facilities ──
  // Maps to safety + risk-management capabilities; conditional on highly hazardous chemicals above threshold quantity.
  {
    capabilitySlug: "supply-chain-compliance-risk-management-modw35nf-fl",
    requiredMaturity: 70,
    priority: "recommended",
    article: "29 CFR 1910.119 (PSM)",
    evidenceNotes: "PSM 14 elements: process safety information, PHA, operating procedures, MOC, pre-startup safety reviews, mechanical integrity, hot-work permits, contractors, training, incident investigation, emergency planning, compliance audits, trade-secrets, employee participation.",
  },

  // ── Carbon + emissions tracking — OSHA-adjacent for exposure thresholds (PELs) ──
  {
    capabilitySlug: "carbon-accounting-emissions-tracking-modw3uxu-kk",
    requiredMaturity: 65,
    priority: "recommended",
    article: "29 CFR 1910 Subpart Z (Toxic + Hazardous Substances) PELs",
    evidenceNotes: "While carbon-accounting focuses on Scope 1-3 GHG, the underlying emissions inventory + monitoring infrastructure supports PEL compliance for workplace-air contaminants under Subpart Z.",
  },

  // ── Water + pollutant control — OSHA-EPA overlap ──
  {
    capabilitySlug: "water-stewardship-pollutant-management-modw3uya-3t",
    requiredMaturity: 60,
    priority: "recommended",
    article: "29 CFR 1910 Subpart Z (chemical exposure controls)",
    evidenceNotes: "Workplace chemical exposure controls integrate with environmental pollutant management; spill containment + worker-exposure boundary management.",
  },
];

proposeRequirements({
  regulationShortCode: "OSHA",
  proposedBy: "seed:osha-requirements",
  logLabel: "seed:osha-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:osha-reqs] fatal:", err);
    process.exit(1);
  });
