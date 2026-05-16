/**
 * Persona registry for synthetic agents. Each persona is a fully-specified
 * identity template: name, demographics, address, professional role,
 * behavioral biases, and a default industry focus. The provisioning service
 * pulls these into rows across organizations / kyc_verifications /
 * user_memberships / billing_organizations so the bot looks like a real
 * onboarded customer end-to-end.
 *
 * Naming, addresses, and emails are deliberately realistic but use the
 * .test TLD (RFC 2606 reserved) so the email can never resolve to a real
 * recipient. The "Synthetic agent · [Persona]" badge applied at the UI
 * layer is the disclosure surface — these fields are designed to populate
 * the database authentically without being a deception risk.
 *
 * Only PE Partner is exposed initially per the user's launch-with-one-bot
 * decision; the others are kept here as templates the admin can spawn from
 * the bot roster UI when ready.
 */
export interface PersonaTemplate {
  key: string;
  displayName: string;
  title: string;
  email: string;
  // Identity fields populated into kyc_verifications.
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  nationality: string; // ISO 3166-1 alpha-2
  documentType: string;
  documentNumber: string; // synthetic, looks valid but isn't
  // Address fields populated into bots row.
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2
  // Org-level metadata for organizations / billing_organizations rows.
  entityName: string;
  entityType: string; // "fund" | "corp" | "consultancy"
  entitySize: string; // "small" | "mid" | "large" | "enterprise"
  entityRole: string;
  entityGeography: "na" | "emea" | "apac" | "latam" | "global" | "other";
  entityRevenueBand: "lt_10m" | "10m_100m" | "100m_1b" | "1b_10b" | "gt_10b";
  industrySlug: string; // looked up by services/bots/provisioning.ts
  // Marketing-facing bio and avatar.
  bio: string;
  avatarUrl: string;
  // Behavioral biases consumed by the action loop. Free-form jsonb; the
  // action loop reads documented keys and ignores the rest, so adding new
  // keys here is non-breaking.
  biases: {
    weightEvar: number;       // 0-1, preference for EVaR-heavy capabilities
    weightEmergingQuadrant: number;
    weightAiExposure: number;
    weightDependencyDepth: number;
    commentTone: "analytical" | "skeptical" | "operator" | "consultative";
    assessmentFrequencyDays: number; // how often this persona runs a self-assessment
    marketplaceActivityPerWeek: number; // listings + bids combined per week
    capabilityBrowsesPerDay: number;
  };
}

export const PERSONAS: Record<string, PersonaTemplate> = {
  pe_partner: {
    key: "pe_partner",
    displayName: "Marcus Chen",
    title: "Partner, Mid-Market Growth",
    email: "marcus.chen@aurelius-capital.test",
    firstName: "Marcus",
    lastName: "Chen",
    dateOfBirth: "1978-06-14",
    nationality: "US",
    documentType: "drivers_license",
    documentNumber: "NY-MC-781406-A",
    addressLine1: "1271 Avenue of the Americas",
    addressLine2: "Suite 4200",
    city: "New York",
    region: "NY",
    postalCode: "10020",
    country: "US",
    entityName: "Aurelius Growth Capital",
    entityType: "fund",
    entitySize: "mid",
    entityRole: "investor",
    entityGeography: "na",
    entityRevenueBand: "100m_1b",
    industrySlug: "financial-services",
    bio: "Twenty years investing across financial services and enterprise SaaS. Particular focus on capabilities with proven revenue durability and clear path to margin expansion. Three closed funds, $2.4B AUM.",
    avatarUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=marcus-chen&backgroundColor=b6e3f4",
    biases: {
      weightEvar: 0.85,
      weightEmergingQuadrant: 0.25,
      weightAiExposure: 0.45,
      weightDependencyDepth: 0.70,
      commentTone: "analytical",
      assessmentFrequencyDays: 14,
      marketplaceActivityPerWeek: 2,
      capabilityBrowsesPerDay: 3,
    },
  },
  vc_associate: {
    key: "vc_associate",
    displayName: "Priya Raghavan",
    title: "Senior Associate, Early-Stage",
    email: "priya.raghavan@longviewventures.test",
    firstName: "Priya",
    lastName: "Raghavan",
    dateOfBirth: "1991-03-22",
    nationality: "US",
    documentType: "passport",
    documentNumber: "P91-RG-22034",
    addressLine1: "535 Mission Street",
    addressLine2: "Floor 14",
    city: "San Francisco",
    region: "CA",
    postalCode: "94105",
    country: "US",
    entityName: "Longview Ventures",
    entityType: "fund",
    entitySize: "small",
    entityRole: "investor",
    entityGeography: "na",
    entityRevenueBand: "10m_100m",
    industrySlug: "technology",
    bio: "Sourcing and diligence for Series A through B in fintech, vertical SaaS, and AI infrastructure. Looks for capabilities at the inflection point — past technical risk, before consensus pricing.",
    avatarUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=priya-raghavan&backgroundColor=ffd5dc",
    biases: {
      weightEvar: 0.35,
      weightEmergingQuadrant: 0.90,
      weightAiExposure: 0.75,
      weightDependencyDepth: 0.30,
      commentTone: "skeptical",
      assessmentFrequencyDays: 7,
      marketplaceActivityPerWeek: 4,
      capabilityBrowsesPerDay: 6,
    },
  },
  f500_strategy: {
    key: "f500_strategy",
    displayName: "James Okonkwo",
    title: "Director of Strategy",
    email: "james.okonkwo@meridianholdings.test",
    firstName: "James",
    lastName: "Okonkwo",
    dateOfBirth: "1975-11-08",
    nationality: "US",
    documentType: "drivers_license",
    documentNumber: "IL-JO-751108-C",
    addressLine1: "233 South Wacker Drive",
    addressLine2: "Floor 78",
    city: "Chicago",
    region: "IL",
    postalCode: "60606",
    country: "US",
    entityName: "Meridian Holdings",
    entityType: "corp",
    entitySize: "enterprise",
    entityRole: "operator",
    entityGeography: "na",
    entityRevenueBand: "gt_10b",
    industrySlug: "insurance",
    bio: "Corporate strategy for a Fortune 200 insurer. Owns the capability portfolio across underwriting, claims, distribution, and adjacent fintech bets. Reports to the CEO and the strategy committee of the board.",
    avatarUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=james-okonkwo&backgroundColor=c0aede",
    biases: {
      weightEvar: 0.55,
      weightEmergingQuadrant: 0.40,
      weightAiExposure: 0.50,
      weightDependencyDepth: 0.85,
      commentTone: "operator",
      assessmentFrequencyDays: 30,
      marketplaceActivityPerWeek: 1,
      capabilityBrowsesPerDay: 4,
    },
  },
  sovereign_wealth: {
    key: "sovereign_wealth",
    displayName: "Khalid Al-Sayed",
    title: "Investment Director",
    email: "khalid.alsayed@nordstarfund.test",
    firstName: "Khalid",
    lastName: "Al-Sayed",
    dateOfBirth: "1973-09-30",
    nationality: "AE",
    documentType: "passport",
    documentNumber: "AE-KS-73930",
    addressLine1: "Emirates Towers",
    addressLine2: "Level 41",
    city: "Dubai",
    region: "Dubai",
    postalCode: "00000",
    country: "AE",
    entityName: "Nordstar Sovereign Fund",
    entityType: "fund",
    entitySize: "enterprise",
    entityRole: "investor",
    entityGeography: "emea",
    entityRevenueBand: "gt_10b",
    industrySlug: "energy",
    bio: "Long-horizon allocator for a $180B sovereign fund. Focused on capabilities with multi-decade durability, structural pricing power, and meaningful exposure to global macro shifts.",
    avatarUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=khalid-alsayed&backgroundColor=d1d4f9",
    biases: {
      weightEvar: 0.75,
      weightEmergingQuadrant: 0.20,
      weightAiExposure: 0.30,
      weightDependencyDepth: 0.60,
      commentTone: "analytical",
      assessmentFrequencyDays: 60,
      marketplaceActivityPerWeek: 1,
      capabilityBrowsesPerDay: 2,
    },
  },
  big4_consultant: {
    key: "big4_consultant",
    displayName: "Sarah O'Brien",
    title: "Strategy Principal",
    email: "sarah.obrien@thackerydeloittealliance.test",
    firstName: "Sarah",
    lastName: "O'Brien",
    dateOfBirth: "1985-04-17",
    nationality: "GB",
    documentType: "passport",
    documentNumber: "GB-SO-85417",
    addressLine1: "Hill House",
    addressLine2: "1 Little New Street",
    city: "London",
    region: "England",
    postalCode: "EC4A 3TR",
    country: "GB",
    entityName: "Thackery & Co Strategy",
    entityType: "consultancy",
    entitySize: "large",
    entityRole: "advisor",
    entityGeography: "emea",
    entityRevenueBand: "1b_10b",
    industrySlug: "healthcare",
    bio: "Eighteen years in management consulting. Leads transformation engagements for healthcare incumbents — payer / provider / pharma — with particular focus on operating-model redesign tied to capability investment.",
    avatarUrl: "https://api.dicebear.com/9.x/avataaars/svg?seed=sarah-obrien&backgroundColor=fde68a",
    biases: {
      weightEvar: 0.50,
      weightEmergingQuadrant: 0.45,
      weightAiExposure: 0.55,
      weightDependencyDepth: 0.75,
      commentTone: "consultative",
      assessmentFrequencyDays: 21,
      marketplaceActivityPerWeek: 3,
      capabilityBrowsesPerDay: 5,
    },
  },
};

export function listPersonas(): PersonaTemplate[] {
  return Object.values(PERSONAS);
}

export function getPersona(key: string): PersonaTemplate | null {
  return PERSONAS[key] ?? null;
}
