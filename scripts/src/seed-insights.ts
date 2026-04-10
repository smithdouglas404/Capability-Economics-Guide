import { db } from "@workspace/db";
import {
  capabilitiesTable,
  industriesTable,
  capabilityThresholdsTable,
  capabilityInsightsTable,
  industryWhitePapersTable,
  industryLeaderboardTable,
  ontologyRelationshipsTable,
  ontologyIndustryAdaptersTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";

export async function seedInsights() {
  console.log("Seeding insights, thresholds, leaderboard, white papers, and ontology...");

  await db.execute(sql`TRUNCATE capability_thresholds, capability_insights, industry_white_papers, industry_leaderboard, ontology_relationships, ontology_industry_adapters RESTART IDENTITY CASCADE`);

  const allCaps = await db.select({ id: capabilitiesTable.id, slug: capabilitiesTable.slug, benchmarkScore: capabilitiesTable.benchmarkScore, industryId: capabilitiesTable.industryId }).from(capabilitiesTable);
  const allIndustries = await db.select().from(industriesTable);

  const industryMap: Record<string, number> = {};
  for (const ind of allIndustries) industryMap[ind.slug] = ind.id;

  const capMap: Record<string, { id: number; benchmarkScore: number; industryId: number }> = {};
  for (const cap of allCaps) capMap[cap.slug] = { id: cap.id, benchmarkScore: cap.benchmarkScore, industryId: cap.industryId };

  for (const cap of allCaps) {
    let greenMin = 70, yellowMin = 40;
    if (cap.benchmarkScore >= 65) { greenMin = 75; yellowMin = 50; }
    else if (cap.benchmarkScore >= 55) { greenMin = 65; yellowMin = 40; }
    else { greenMin = 55; yellowMin = 30; }

    await db.insert(capabilityThresholdsTable).values({
      capabilityId: cap.id,
      greenMin,
      yellowMin,
      redMax: yellowMin - 1,
      description: `Threshold for capability maturity: Green >= ${greenMin}, Yellow >= ${yellowMin}, Red < ${yellowMin}`,
    });
  }
  console.log(`Seeded ${allCaps.length} capability thresholds`);

  const insightsData: Array<{
    capabilityId?: number;
    industryId?: number;
    insightType: string;
    title: string;
    content: string;
    severity: string;
    recommendation: string;
  }> = [
    { industryId: industryMap["insurance"], insightType: "industry_trend", title: "AI-Driven Underwriting is Becoming Table Stakes", content: "78% of top-quartile insurers have deployed AI underwriting models. Organizations below the 65th percentile in Precision Underwriting face accelerating competitive disadvantage as automated decisioning becomes the market standard.", severity: "warning", recommendation: "Prioritize AI underwriting capability investment within 12 months to avoid falling below the competitive viability threshold." },
    { industryId: industryMap["insurance"], insightType: "gap_alert", title: "Digital Distribution Lags Industry Benchmark", content: "Digital Distribution maturity at 50 is 15 points below the industry median. Carriers at this level typically see 40% higher customer acquisition costs and 25% lower policy growth rates compared to digitally mature competitors.", severity: "critical", recommendation: "Implement a digital-first distribution strategy with API-enabled agent portals and self-service quoting to close the capability gap." },
    { industryId: industryMap["insurance"], insightType: "opportunity", title: "Fraud Detection ROI is Highest Among All Capabilities", content: "Every 1-point improvement in Fraud Detection maturity correlates with $2.3M in reduced leakage for mid-size carriers. Current benchmark of 55 suggests significant untapped value.", severity: "info", recommendation: "Deploy ML-based fraud detection models leveraging claims history patterns. Expected ROI: 400-600% within 18 months." },
    { industryId: industryMap["healthcare"], insightType: "industry_trend", title: "Value-Based Care Requires Population Health Maturity", content: "Healthcare organizations transitioning to value-based payment models need Population Health Management maturity above 60 to avoid financial losses. Current industry benchmark of 45 indicates widespread unpreparedness.", severity: "critical", recommendation: "Invest in risk stratification analytics and care management platforms before value-based contracts represent more than 30% of revenue." },
    { industryId: industryMap["healthcare"], insightType: "gap_alert", title: "Health Data Interoperability is the Weakest Link", content: "At a benchmark of 40, Health Data Interoperability is the lowest-scoring capability across healthcare. This bottleneck suppresses the ROI of Clinical Decision Support, Population Health, and Telehealth investments.", severity: "critical", recommendation: "Prioritize FHIR-based interoperability infrastructure. This foundational capability unlocks value in 4+ downstream capabilities." },
    { industryId: industryMap["healthcare"], insightType: "opportunity", title: "Telehealth Scaling Creates Operating Leverage", content: "Virtual care delivery has near-zero marginal cost. Organizations that push Telehealth maturity above 70 see 35% reduction in facility costs and 20% improvement in access metrics.", severity: "info", recommendation: "Expand telehealth beyond primary care into specialty consultations, chronic care management, and post-acute follow-up." },
    { industryId: industryMap["banking"], insightType: "industry_trend", title: "Open Banking APIs Are Reshaping Revenue Models", content: "Banking-as-a-Service revenue from API ecosystems is growing 45% YoY. Banks with Open Banking maturity below 50 risk being disintermediated by fintech platforms that aggregate banking services.", severity: "warning", recommendation: "Develop an API monetization strategy and partner ecosystem. Target 50+ active API partners within 18 months." },
    { industryId: industryMap["banking"], insightType: "gap_alert", title: "Core Banking Modernization is Urgent", content: "Core Banking maturity at 45 is the critical bottleneck. Every other banking capability — digital banking, payments, credit decisioning — is constrained by core system limitations. Delaying modernization compounds technical debt exponentially.", severity: "critical", recommendation: "Begin phased core modernization with API-layer abstraction to decouple front-end innovation from back-end constraints." },
    { industryId: industryMap["banking"], insightType: "opportunity", title: "AML/KYC Automation Reduces Onboarding Friction", content: "Banks that automate KYC verification reduce onboarding time from 24 hours to under 5 minutes. With 90% false alert rates in current AML systems, AI-driven compliance creates both cost savings and customer experience improvements.", severity: "info", recommendation: "Deploy AI-powered identity verification and transaction monitoring to reduce false positives by 70% while improving detection rates." },
    { industryId: industryMap["manufacturing"], insightType: "industry_trend", title: "Smart Factory Adoption is Accelerating", content: "Industry 4.0 adoption among manufacturing leaders has increased 60% in 2 years. Organizations with Smart Factory maturity below 50 face widening productivity gaps as connected manufacturing becomes the baseline.", severity: "warning", recommendation: "Implement IoT sensor networks on critical production lines and establish real-time OEE dashboards as a foundation for smart factory evolution." },
    { industryId: industryMap["manufacturing"], insightType: "gap_alert", title: "Predictive Maintenance Gap Costs $2.1M Annually", content: "At benchmark 50, the industry average for Predictive Maintenance indicates most manufacturers still rely on reactive or scheduled maintenance. The gap between reactive and predictive maintenance represents $2.1M in avoided downtime per facility annually.", severity: "critical", recommendation: "Deploy condition-based monitoring on top-10 critical assets within 6 months. Expand predictive analytics coverage to 80% of production equipment within 18 months." },
    { industryId: industryMap["technology"], insightType: "industry_trend", title: "Platform Engineering is the New Competitive Moat", content: "Developer productivity varies 10x between organizations with mature vs. immature platform engineering. Companies investing in internal developer platforms see 40% faster feature delivery and 60% fewer production incidents.", severity: "warning", recommendation: "Establish a dedicated platform engineering team focused on developer experience, CI/CD automation, and infrastructure abstraction." },
    { industryId: industryMap["technology"], insightType: "opportunity", title: "AI/ML Platform Maturity Drives Product Differentiation", content: "Technology companies with mature AI/ML capabilities release AI-powered features 3x faster than competitors. The window for AI-driven product differentiation is narrowing as foundation models become commoditized.", severity: "info", recommendation: "Invest in ML infrastructure (feature stores, model serving, experiment tracking) to enable rapid AI feature iteration across product lines." },
    { industryId: industryMap["retail"], insightType: "industry_trend", title: "Unified Commerce is Replacing Omnichannel", content: "Leading retailers are moving beyond omnichannel to unified commerce — a single platform that treats every customer interaction as part of one continuous journey. Retailers with Omnichannel Integration below 55 risk fragmented customer experiences.", severity: "warning", recommendation: "Consolidate commerce platforms to create a single customer view across physical stores, e-commerce, mobile, and marketplace channels." },
    { industryId: industryMap["retail"], insightType: "gap_alert", title: "Supply Chain Visibility is a Critical Weakness", content: "Retail supply chain visibility at benchmark 55 leaves most retailers unable to predict disruptions or optimize inventory across channels. Post-pandemic supply chain volatility makes this capability existentially important.", severity: "critical", recommendation: "Deploy end-to-end supply chain visibility platforms with real-time tracking, demand sensing, and automated reorder triggers." },
  ];

  for (const insight of insightsData) {
    if (insight.industryId) {
      await db.insert(capabilityInsightsTable).values(insight);
    }
  }
  console.log(`Seeded ${insightsData.length} capability insights`);

  const whitePapers = [
    { industryId: industryMap["insurance"], title: "The Economic Value of Insurance Capabilities", author: "Dr. Sarah Chen", organization: "MIT Sloan", abstract: "This research examines how insurance organizations can quantify the economic value of their core capabilities, moving beyond traditional cost-center thinking to capability-as-asset valuation.", category: "Research", publishedYear: 2024, relevanceScore: 95, tags: "capability valuation|insurance|economic modeling" },
    { industryId: industryMap["insurance"], title: "AI-Driven Underwriting: From Cost Center to Profit Engine", author: "James Morrison", organization: "McKinsey & Company", abstract: "How leading insurers are using AI to transform underwriting from a manual bottleneck into a scalable competitive advantage, with case studies showing 15-30% improvement in loss ratios.", category: "Industry Report", publishedYear: 2024, relevanceScore: 92, tags: "AI|underwriting|automation" },
    { industryId: industryMap["insurance"], title: "The Capability Maturity Model for Insurance Digital Transformation", author: "Lisa Park", organization: "Deloitte Digital", abstract: "A comprehensive maturity model for assessing insurance digital capabilities across underwriting, claims, distribution, and customer experience dimensions.", category: "Framework", publishedYear: 2023, relevanceScore: 88, tags: "maturity model|digital transformation|assessment" },
    { industryId: industryMap["healthcare"], title: "Capability Economics in Healthcare: Valuing Clinical and Operational Assets", author: "Dr. Michael Torres", organization: "Harvard Business School", abstract: "This paper introduces a framework for healthcare organizations to value their clinical and operational capabilities as economic assets, with implications for M&A, investment prioritization, and strategic planning.", category: "Research", publishedYear: 2024, relevanceScore: 94, tags: "healthcare|capability valuation|strategy" },
    { industryId: industryMap["healthcare"], title: "The Interoperability Imperative: Why Data Liquidity Drives Healthcare Value", author: "Dr. Raj Patel", organization: "HIMSS", abstract: "An analysis of how health data interoperability capability maturity directly correlates with clinical outcomes, operational efficiency, and financial performance across health systems.", category: "Industry Report", publishedYear: 2024, relevanceScore: 90, tags: "interoperability|data|outcomes" },
    { industryId: industryMap["banking"], title: "Core Banking Modernization: A Capability Economics Perspective", author: "Dr. Angela Wei", organization: "Boston Consulting Group", abstract: "Why core banking modernization should be evaluated through the lens of capability economics — measuring the platform's impact on downstream capability velocity rather than technology TCO alone.", category: "Strategy Brief", publishedYear: 2024, relevanceScore: 93, tags: "core banking|modernization|platform" },
    { industryId: industryMap["banking"], title: "Open Banking and the Capability Portfolio: Building Ecosystem Value", author: "Thomas Chen", organization: "World Economic Forum", abstract: "How open banking APIs create new capability portfolios that extend beyond traditional banking boundaries, with frameworks for valuing ecosystem capabilities.", category: "Research", publishedYear: 2023, relevanceScore: 89, tags: "open banking|API|ecosystem" },
    { industryId: industryMap["manufacturing"], title: "Industry 4.0 Capability Maturity: From Smart Factory to Intelligent Enterprise", author: "Dr. Klaus Schmidt", organization: "Fraunhofer Institute", abstract: "A staged capability maturity model for manufacturing organizations pursuing Industry 4.0 transformation, with benchmarks from 200+ factories across 12 countries.", category: "Research", publishedYear: 2024, relevanceScore: 91, tags: "Industry 4.0|smart factory|IoT" },
    { industryId: industryMap["manufacturing"], title: "Predictive Maintenance ROI: Quantifying Capability Investment Returns", author: "Maria Gonzalez", organization: "PwC Strategy&", abstract: "Financial modeling of predictive maintenance capability investments across discrete and process manufacturing, showing 300-500% ROI within 24 months for mature implementations.", category: "Industry Report", publishedYear: 2023, relevanceScore: 87, tags: "predictive maintenance|ROI|analytics" },
    { industryId: industryMap["technology"], title: "Platform Engineering as a Capability: The Developer Productivity Multiplier", author: "Dr. Nicole Forsgren", organization: "Microsoft Research", abstract: "Research demonstrating that platform engineering capability maturity is the single strongest predictor of overall software delivery performance, based on analysis of 3,000+ engineering organizations.", category: "Research", publishedYear: 2024, relevanceScore: 96, tags: "platform engineering|developer experience|productivity" },
    { industryId: industryMap["technology"], title: "Dynamic Capabilities in the Age of AI", author: "Dr. David Teece", organization: "UC Berkeley Haas", abstract: "An updated framework for dynamic capabilities theory that incorporates AI as both a capability enabler and a new category of organizational capability, with implications for competitive strategy.", category: "Academic Paper", publishedYear: 2024, relevanceScore: 97, tags: "dynamic capabilities|AI|strategy|theory" },
    { industryId: industryMap["retail"], title: "Unified Commerce Capability Architecture", author: "Sophie Laurent", organization: "Gartner", abstract: "A capability reference architecture for retailers transitioning from omnichannel to unified commerce, with maturity benchmarks and investment prioritization frameworks.", category: "Industry Report", publishedYear: 2024, relevanceScore: 90, tags: "unified commerce|omnichannel|retail" },
  ];

  for (const wp of whitePapers) {
    await db.insert(industryWhitePapersTable).values(wp);
  }
  console.log(`Seeded ${whitePapers.length} white papers`);

  const leaderboardData = [
    { industryId: industryMap["insurance"], companyName: "Progressive", overallMaturity: 82, topCapability: "Data & Analytics Platform", topCapabilityScore: 92, weakestCapability: "Agent Enablement", weakestCapabilityScore: 58, investmentLevel: "high", trend: "improving", rank: 1 },
    { industryId: industryMap["insurance"], companyName: "Lemonade", overallMaturity: 78, topCapability: "Digital Distribution", topCapabilityScore: 95, weakestCapability: "Reinsurance Optimization", weakestCapabilityScore: 45, investmentLevel: "high", trend: "improving", rank: 2 },
    { industryId: industryMap["insurance"], companyName: "USAA", overallMaturity: 76, topCapability: "Customer Retention", topCapabilityScore: 90, weakestCapability: "Fraud Detection", weakestCapabilityScore: 62, investmentLevel: "high", trend: "stable", rank: 3 },
    { industryId: industryMap["insurance"], companyName: "Industry Average", overallMaturity: 60, topCapability: "Regulatory Compliance", topCapabilityScore: 75, weakestCapability: "Digital Distribution", weakestCapabilityScore: 50, investmentLevel: "medium", trend: "stable", rank: 4 },
    { industryId: industryMap["healthcare"], companyName: "Kaiser Permanente", overallMaturity: 80, topCapability: "Population Health Management", topCapabilityScore: 88, weakestCapability: "Health Data Interoperability", weakestCapabilityScore: 55, investmentLevel: "high", trend: "improving", rank: 1 },
    { industryId: industryMap["healthcare"], companyName: "Cleveland Clinic", overallMaturity: 78, topCapability: "Quality & Patient Safety", topCapabilityScore: 92, weakestCapability: "Telehealth", weakestCapabilityScore: 52, investmentLevel: "high", trend: "stable", rank: 2 },
    { industryId: industryMap["healthcare"], companyName: "Teladoc Health", overallMaturity: 72, topCapability: "Telehealth & Virtual Care", topCapabilityScore: 90, weakestCapability: "Revenue Cycle Management", weakestCapabilityScore: 48, investmentLevel: "high", trend: "improving", rank: 3 },
    { industryId: industryMap["healthcare"], companyName: "Industry Average", overallMaturity: 54, topCapability: "Quality & Patient Safety", topCapabilityScore: 70, weakestCapability: "Health Data Interoperability", weakestCapabilityScore: 40, investmentLevel: "medium", trend: "stable", rank: 4 },
    { industryId: industryMap["banking"], companyName: "JPMorgan Chase", overallMaturity: 84, topCapability: "Payment Processing", topCapabilityScore: 95, weakestCapability: "Open Banking & APIs", weakestCapabilityScore: 60, investmentLevel: "high", trend: "improving", rank: 1 },
    { industryId: industryMap["banking"], companyName: "Nubank", overallMaturity: 80, topCapability: "Digital Banking Platform", topCapabilityScore: 93, weakestCapability: "Wealth Management", weakestCapabilityScore: 42, investmentLevel: "high", trend: "improving", rank: 2 },
    { industryId: industryMap["banking"], companyName: "Goldman Sachs", overallMaturity: 76, topCapability: "Enterprise Risk Management", topCapabilityScore: 90, weakestCapability: "Digital Banking Platform", weakestCapabilityScore: 55, investmentLevel: "high", trend: "stable", rank: 3 },
    { industryId: industryMap["banking"], companyName: "Industry Average", overallMaturity: 58, topCapability: "Payment Processing", topCapabilityScore: 75, weakestCapability: "Open Banking & APIs", weakestCapabilityScore: 40, investmentLevel: "medium", trend: "stable", rank: 4 },
    { industryId: industryMap["manufacturing"], companyName: "Siemens", overallMaturity: 82, topCapability: "Smart Factory / IoT", topCapabilityScore: 90, weakestCapability: "Sustainability & ESG", weakestCapabilityScore: 60, investmentLevel: "high", trend: "improving", rank: 1 },
    { industryId: industryMap["manufacturing"], companyName: "Toyota", overallMaturity: 80, topCapability: "Quality Management", topCapabilityScore: 95, weakestCapability: "Smart Factory / IoT", weakestCapabilityScore: 55, investmentLevel: "high", trend: "stable", rank: 2 },
    { industryId: industryMap["manufacturing"], companyName: "Industry Average", overallMaturity: 55, topCapability: "Workforce Safety", topCapabilityScore: 70, weakestCapability: "Smart Factory / IoT", weakestCapabilityScore: 40, investmentLevel: "medium", trend: "stable", rank: 3 },
    { industryId: industryMap["technology"], companyName: "Google", overallMaturity: 88, topCapability: "Platform Engineering", topCapabilityScore: 96, weakestCapability: "Enterprise Sales", weakestCapabilityScore: 65, investmentLevel: "high", trend: "stable", rank: 1 },
    { industryId: industryMap["technology"], companyName: "Microsoft", overallMaturity: 86, topCapability: "Cloud & Infrastructure", topCapabilityScore: 94, weakestCapability: "Developer Experience", weakestCapabilityScore: 68, investmentLevel: "high", trend: "improving", rank: 2 },
    { industryId: industryMap["technology"], companyName: "Industry Average", overallMaturity: 58, topCapability: "Product Development", topCapabilityScore: 68, weakestCapability: "Data Governance", weakestCapabilityScore: 42, investmentLevel: "medium", trend: "stable", rank: 3 },
    { industryId: industryMap["retail"], companyName: "Amazon", overallMaturity: 90, topCapability: "Supply Chain Management", topCapabilityScore: 96, weakestCapability: "In-Store Experience", weakestCapabilityScore: 40, investmentLevel: "high", trend: "improving", rank: 1 },
    { industryId: industryMap["retail"], companyName: "Walmart", overallMaturity: 78, topCapability: "Inventory Management", topCapabilityScore: 88, weakestCapability: "Personalization", weakestCapabilityScore: 52, investmentLevel: "high", trend: "improving", rank: 2 },
    { industryId: industryMap["retail"], companyName: "Industry Average", overallMaturity: 52, topCapability: "Merchandise Planning", topCapabilityScore: 65, weakestCapability: "Sustainability", weakestCapabilityScore: 38, investmentLevel: "medium", trend: "stable", rank: 3 },
  ];

  for (const entry of leaderboardData) {
    await db.insert(industryLeaderboardTable).values(entry);
  }
  console.log(`Seeded ${leaderboardData.length} leaderboard entries`);

  const ontologyRels: Array<{
    sourceSlug: string;
    targetSlug: string;
    relationshipType: string;
    strength: string;
    description: string;
  }> = [
    { sourceSlug: "data-analytics", targetSlug: "precision-underwriting", relationshipType: "enables", strength: "strong", description: "Data platform capabilities directly enable AI-driven underwriting accuracy" },
    { sourceSlug: "data-analytics", targetSlug: "fraud-detection", relationshipType: "enables", strength: "strong", description: "Analytics platform provides the data foundation for fraud pattern detection" },
    { sourceSlug: "precision-underwriting", targetSlug: "digital-distribution", relationshipType: "enables", strength: "moderate", description: "Automated underwriting enables real-time digital quoting and binding" },
    { sourceSlug: "rapid-claims", targetSlug: "customer-retention", relationshipType: "enables", strength: "strong", description: "Claims experience is the primary driver of customer loyalty and retention" },
    { sourceSlug: "fraud-detection", targetSlug: "rapid-claims", relationshipType: "enables", strength: "moderate", description: "Effective fraud screening allows straight-through claims processing" },
    { sourceSlug: "digital-distribution", targetSlug: "agent-enablement", relationshipType: "competes_with", strength: "moderate", description: "Digital and agent channels compete for the same customer acquisition budget" },
    { sourceSlug: "actuarial-modeling", targetSlug: "reinsurance-optimization", relationshipType: "enables", strength: "strong", description: "Actuarial models drive reinsurance treaty optimization and pricing" },
    { sourceSlug: "health-data-interop", targetSlug: "clinical-decision-support", relationshipType: "enables", strength: "strong", description: "Interoperable data is the prerequisite for effective clinical decision support" },
    { sourceSlug: "health-data-interop", targetSlug: "population-health", relationshipType: "enables", strength: "strong", description: "Population health management requires cross-system data aggregation" },
    { sourceSlug: "telehealth", targetSlug: "patient-experience", relationshipType: "enables", strength: "moderate", description: "Virtual care options improve access and convenience in the patient journey" },
    { sourceSlug: "revenue-cycle", targetSlug: "clinical-workforce", relationshipType: "enables", strength: "moderate", description: "Efficient revenue cycle funds clinical workforce investment" },
    { sourceSlug: "core-banking", targetSlug: "digital-banking", relationshipType: "enables", strength: "strong", description: "Core banking platform velocity determines digital banking feature delivery speed" },
    { sourceSlug: "core-banking", targetSlug: "payment-processing", relationshipType: "enables", strength: "strong", description: "Payment processing reliability depends on core banking system stability" },
    { sourceSlug: "open-banking", targetSlug: "digital-banking", relationshipType: "enables", strength: "moderate", description: "Open APIs enable third-party integrations that enrich digital banking" },
    { sourceSlug: "credit-decisioning", targetSlug: "risk-management-bank", relationshipType: "enables", strength: "strong", description: "Credit decisions feed directly into enterprise risk portfolio management" },
    { sourceSlug: "predictive-maintenance", targetSlug: "quality-management", relationshipType: "enables", strength: "moderate", description: "Predicting equipment failures prevents quality degradation in production" },
    { sourceSlug: "smart-factory", targetSlug: "predictive-maintenance", relationshipType: "enables", strength: "strong", description: "IoT sensor data is the input for predictive maintenance models" },
    { sourceSlug: "smart-factory", targetSlug: "production-planning", relationshipType: "enables", strength: "moderate", description: "Real-time factory data enables dynamic production scheduling" },
    { sourceSlug: "supply-chain-mgmt", targetSlug: "inventory-optimization", relationshipType: "enables", strength: "strong", description: "Supply chain visibility drives inventory optimization decisions" },
    { sourceSlug: "platform-engineering", targetSlug: "product-development", relationshipType: "enables", strength: "strong", description: "Platform engineering multiplies developer productivity across all product teams" },
  ];

  for (const rel of ontologyRels) {
    const source = capMap[rel.sourceSlug];
    const target = capMap[rel.targetSlug];
    if (source && target) {
      await db.insert(ontologyRelationshipsTable).values({
        sourceCapabilityId: source.id,
        targetCapabilityId: target.id,
        relationshipType: rel.relationshipType,
        strength: rel.strength,
        description: rel.description,
      });
    }
  }
  console.log(`Seeded ontology relationships`);

  const adapters = [
    { industryId: industryMap["insurance"], adapterName: "Insurance Capability Ontology", adapterDescription: "Adapts the base capability economics ontology for the insurance industry, emphasizing risk-based valuation, regulatory constraints, and actuarial precision.", capabilityFocusAreas: "Underwriting precision|Claims efficiency|Fraud prevention|Distribution optimization|Regulatory agility", maturityModel: "Level 1: Manual/Reactive - Paper-based processes, expert-dependent decisions|Level 2: Standardized - Documented processes, basic automation|Level 3: Optimized - Data-driven decisions, workflow automation|Level 4: Predictive - AI-augmented, predictive analytics integrated|Level 5: Autonomous - Self-optimizing, continuous learning systems", keyDifferentiators: "Insurance capabilities are uniquely constrained by regulatory approval cycles, actuarial requirements, and the inverse production cycle (premium collected before cost is known). The ontology must account for these constraints when modeling capability interdependencies and investment timing." },
    { industryId: industryMap["healthcare"], adapterName: "Healthcare Capability Ontology", adapterDescription: "Adapts capability economics for healthcare, balancing clinical outcomes, patient safety, regulatory compliance (HIPAA), and financial sustainability under value-based care models.", capabilityFocusAreas: "Clinical quality|Patient access|Data interoperability|Care coordination|Revenue integrity", maturityModel: "Level 1: Reactive - Ad-hoc care delivery, minimal data use|Level 2: Informed - EHR-enabled, basic quality metrics|Level 3: Proactive - Risk stratification, care management programs|Level 4: Predictive - AI-driven clinical insights, population health|Level 5: Precision - Personalized medicine, real-time adaptive care", keyDifferentiators: "Healthcare capabilities must be evaluated through a dual lens: clinical effectiveness and economic sustainability. Unlike other industries, healthcare capability failures can have life-or-death consequences, creating a unique risk calculus for capability investment prioritization." },
    { industryId: industryMap["banking"], adapterName: "Banking Capability Ontology", adapterDescription: "Adapts capability economics for banking and financial services, addressing capital adequacy requirements, fintech disruption, and the tension between innovation velocity and regulatory compliance.", capabilityFocusAreas: "Risk management|Digital experience|Regulatory compliance|Payment infrastructure|Ecosystem integration", maturityModel: "Level 1: Legacy - Batch processing, manual compliance|Level 2: Digitized - Online channels, automated reporting|Level 3: Platform - API-enabled, real-time processing|Level 4: Intelligent - AI-driven risk, personalized services|Level 5: Ecosystem - Open banking, embedded finance", keyDifferentiators: "Banking capabilities operate under unique constraints: capital adequacy requirements, real-time settlement obligations, and systemic risk considerations. The ontology must model how regulatory requirements both constrain and create capability investment opportunities." },
    { industryId: industryMap["manufacturing"], adapterName: "Manufacturing Capability Ontology", adapterDescription: "Adapts capability economics for manufacturing, connecting operational technology with information technology, and modeling the physical-digital convergence of Industry 4.0.", capabilityFocusAreas: "Production efficiency|Quality assurance|Supply chain resilience|Workforce capability|Sustainability", maturityModel: "Level 1: Manual - Paper-based, reactive maintenance|Level 2: Automated - PLC-controlled, scheduled maintenance|Level 3: Connected - IoT-enabled, condition monitoring|Level 4: Intelligent - AI-optimized, predictive operations|Level 5: Autonomous - Self-organizing, lights-out capable", keyDifferentiators: "Manufacturing capabilities uniquely bridge physical and digital domains. The ontology must model OT/IT convergence, safety constraints, and the cascading impact of equipment failures on downstream capabilities. Cycle time, yield, and safety are the trinity of manufacturing capability economics." },
    { industryId: industryMap["technology"], adapterName: "Technology Capability Ontology", adapterDescription: "Adapts capability economics for technology companies, where capabilities are both the product and the production system, creating unique recursive dynamics.", capabilityFocusAreas: "Developer productivity|Platform scalability|Product innovation|Data leverage|Talent retention", maturityModel: "Level 1: Ad-hoc - Heroic individual efforts, no platforms|Level 2: Repeatable - Basic CI/CD, team-level tools|Level 3: Defined - Platform teams, self-service infrastructure|Level 4: Managed - Metric-driven, automated optimization|Level 5: Optimizing - Continuous experimentation, AI-augmented development", keyDifferentiators: "Technology companies exhibit unique recursive capability dynamics — their capabilities are used to build capabilities. Platform engineering maturity has a multiplicative effect on all other capabilities. The ontology must model this amplification effect and the compounding returns of developer productivity investments." },
    { industryId: industryMap["retail"], adapterName: "Retail Capability Ontology", adapterDescription: "Adapts capability economics for retail, addressing the convergence of physical and digital commerce, real-time demand sensing, and the economics of customer lifetime value across channels.", capabilityFocusAreas: "Customer experience|Supply chain agility|Pricing optimization|Channel integration|Data monetization", maturityModel: "Level 1: Single-channel - Isolated store/online operations|Level 2: Multi-channel - Multiple channels operating independently|Level 3: Cross-channel - Channels share data, partial integration|Level 4: Omnichannel - Unified view, seamless transitions|Level 5: Unified Commerce - Single platform, real-time everywhere", keyDifferentiators: "Retail capability economics must account for the high velocity of consumer demand, thin margins, and the existential importance of customer experience. Unlike B2B industries, retail capabilities are constantly tested by millions of individual consumer interactions, creating rapid feedback loops that can be leveraged for capability optimization." },
  ];

  for (const adapter of adapters) {
    await db.insert(ontologyIndustryAdaptersTable).values(adapter);
  }
  console.log(`Seeded ${adapters.length} industry ontology adapters`);

  console.log("Insights seeding complete!");
}

