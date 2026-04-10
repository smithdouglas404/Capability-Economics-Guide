import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  capabilityMetricsTable,
  capabilityDependenciesTable,
  cSuiteRolesTable,
  capabilityRoleMappingsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding knowledge graph...");

  await db.execute(sql`TRUNCATE capability_role_mappings, capability_dependencies, capability_metrics, capabilities, c_suite_roles, industries RESTART IDENTITY CASCADE`);

  const roles = await db.insert(cSuiteRolesTable).values([
    { slug: "ceo", title: "CEO", name: "Chief Executive Officer", focus: "Strategic Vision & Competitive Advantage", icon: "Briefcase", color: "text-blue-500" },
    { slug: "coo", title: "COO", name: "Chief Operating Officer", focus: "Operational Efficiency & Process Optimization", icon: "Cog", color: "text-emerald-500" },
    { slug: "cfo", title: "CFO", name: "Chief Financial Officer", focus: "Financial Valuation & ROI of Capabilities", icon: "CircleDollarSign", color: "text-amber-500" },
    { slug: "cto", title: "CTO", name: "Chief Technology Officer", focus: "Technology Capabilities & Digital Transformation", icon: "MonitorSmartphone", color: "text-purple-500" },
    { slug: "cio", title: "CIO", name: "Chief Information Officer", focus: "Information Management & Data-Driven Decisions", icon: "Database", color: "text-cyan-500" },
    { slug: "cmo", title: "CMO", name: "Chief Marketing Officer", focus: "Market-Facing Capabilities & Customer Experience", icon: "Megaphone", color: "text-rose-500" },
    { slug: "chro", title: "CHRO", name: "Chief Human Resources Officer", focus: "Talent & Workforce Capabilities", icon: "Users", color: "text-indigo-500" },
    { slug: "cpo", title: "CPO", name: "Chief Product Officer", focus: "Product Capabilities & Innovation", icon: "Lightbulb", color: "text-orange-500" },
  ]).returning();

  const roleMap = Object.fromEntries(roles.map(r => [r.slug, r.id]));

  const industriesData = [
    {
      slug: "insurance", name: "Insurance", icon: "Shield",
      description: "Insurance is fundamentally a business of capabilities. Carriers sell promises, and their value is dictated by how well they execute core capabilities like underwriting, claims processing, and risk management.",
      capabilities: [
        { slug: "precision-underwriting", name: "Precision Underwriting", description: "The ability to accurately assess risk and price policies competitively.", traditionalView: "A manual, expert-driven process viewed as fixed headcount cost.", economicView: "A scalable risk-arbitrage engine where speed and accuracy drive margin.", benchmarkScore: 65, metrics: [{ name: "Quote Turnaround Time", description: "Average time to produce a quote", unit: "hours", benchmarkValue: 4 }, { name: "Loss Ratio Impact", description: "Improvement in loss ratio from capability investment", unit: "percent", benchmarkValue: 3.5 }] },
        { slug: "rapid-claims", name: "Rapid Claims Resolution", description: "End-to-end process of receiving, adjudicating, and paying customer claims.", traditionalView: "A back-office operational necessity and unavoidable cost center.", economicView: "The primary driver of customer retention and brand trust.", benchmarkScore: 60, metrics: [{ name: "First-Touch Resolution Rate", description: "Percentage of claims resolved on first contact", unit: "percent", benchmarkValue: 40 }, { name: "NPS Post-Claim", description: "Net Promoter Score after claim resolution", unit: "score", benchmarkValue: 25 }] },
        { slug: "fraud-detection", name: "Fraud Detection & Prevention", description: "Identifying and preventing fraudulent claims and applications.", traditionalView: "An IT security function with fixed annual budget.", economicView: "A direct P&L lever reducing leakage by millions annually.", benchmarkScore: 55, metrics: [{ name: "Fraud Detection Rate", description: "Percentage of fraudulent claims caught", unit: "percent", benchmarkValue: 70 }, { name: "False Positive Rate", description: "Percentage of legitimate claims incorrectly flagged", unit: "percent", benchmarkValue: 5 }] },
        { slug: "actuarial-modeling", name: "Actuarial Modeling", description: "Statistical analysis and modeling of risk for pricing and reserving.", traditionalView: "An academic function producing annual rate filings.", economicView: "A real-time competitive intelligence engine for dynamic pricing.", benchmarkScore: 70, metrics: [{ name: "Model Accuracy", description: "Prediction accuracy of loss models", unit: "percent", benchmarkValue: 85 }, { name: "Rate Filing Speed", description: "Time from data to approved rate change", unit: "weeks", benchmarkValue: 8 }] },
        { slug: "digital-distribution", name: "Digital Distribution", description: "Online and mobile channels for policy sales and servicing.", traditionalView: "A website add-on to the agent channel.", economicView: "A zero-marginal-cost acquisition engine with data-rich feedback loops.", benchmarkScore: 50, metrics: [{ name: "Digital Quote-to-Bind", description: "Conversion rate from digital quote to bound policy", unit: "percent", benchmarkValue: 15 }, { name: "Cost per Acquisition", description: "Cost to acquire one new customer via digital", unit: "dollars", benchmarkValue: 250 }] },
        { slug: "customer-retention", name: "Customer Retention", description: "Programs and processes to retain existing policyholders.", traditionalView: "Renewal notices and annual rate adjustments.", economicView: "A lifetime-value maximization system driven by proactive engagement.", benchmarkScore: 55, metrics: [{ name: "Retention Rate", description: "Year-over-year policy renewal rate", unit: "percent", benchmarkValue: 85 }, { name: "Customer Lifetime Value", description: "Average revenue per customer over lifetime", unit: "dollars", benchmarkValue: 3500 }] },
        { slug: "regulatory-compliance", name: "Regulatory Compliance", description: "Adherence to state and federal insurance regulations.", traditionalView: "A necessary cost of doing business managed by legal.", economicView: "A speed-to-market differentiator when built as an automated capability.", benchmarkScore: 75, metrics: [{ name: "Filing Approval Time", description: "Average time to regulatory approval", unit: "days", benchmarkValue: 30 }, { name: "Compliance Violation Rate", description: "Number of regulatory violations per year", unit: "count", benchmarkValue: 2 }] },
        { slug: "reinsurance-optimization", name: "Reinsurance Optimization", description: "Strategic management of reinsurance programs to optimize risk transfer.", traditionalView: "An annual negotiation with treaty partners.", economicView: "A dynamic capital efficiency tool that unlocks underwriting capacity.", benchmarkScore: 60, metrics: [{ name: "Ceded Premium Ratio", description: "Percentage of premium ceded to reinsurers", unit: "percent", benchmarkValue: 25 }, { name: "Net Retention Efficiency", description: "Return on net retained premium", unit: "percent", benchmarkValue: 12 }] },
        { slug: "agent-enablement", name: "Agent Enablement", description: "Tools, training, and support for independent agent networks.", traditionalView: "A field marketing expense with hard-to-measure ROI.", economicView: "A force-multiplier capability that scales distribution without fixed cost.", benchmarkScore: 50, metrics: [{ name: "Agent Productivity", description: "Policies bound per agent per month", unit: "count", benchmarkValue: 15 }, { name: "Agent Satisfaction", description: "Net Promoter Score from agent surveys", unit: "score", benchmarkValue: 35 }] },
        { slug: "data-analytics", name: "Data & Analytics Platform", description: "Enterprise data infrastructure supporting all analytical capabilities.", traditionalView: "An IT infrastructure cost center.", economicView: "The foundational capability that amplifies the ROI of every other capability.", benchmarkScore: 55, metrics: [{ name: "Data Freshness", description: "Average latency of analytical data", unit: "hours", benchmarkValue: 4 }, { name: "Self-Service Adoption", description: "Percentage of business users using self-service analytics", unit: "percent", benchmarkValue: 30 }] },
      ]
    },
    {
      slug: "healthcare", name: "Healthcare", icon: "Heart",
      description: "Healthcare organizations must balance clinical excellence with operational efficiency. Capability economics reveals which investments in care delivery, patient experience, and technology actually drive better outcomes and financial sustainability.",
      capabilities: [
        { slug: "clinical-decision-support", name: "Clinical Decision Support", description: "Systems and processes that assist clinicians in making evidence-based care decisions.", traditionalView: "An EHR feature checkbox.", economicView: "A patient-outcome amplifier that reduces variation and drives quality-based revenue.", benchmarkScore: 55, metrics: [{ name: "Alert Override Rate", description: "Percentage of CDS alerts overridden by clinicians", unit: "percent", benchmarkValue: 45 }, { name: "Readmission Reduction", description: "Reduction in 30-day readmissions from CDS", unit: "percent", benchmarkValue: 8 }] },
        { slug: "patient-experience", name: "Patient Experience Management", description: "End-to-end management of the patient journey from scheduling to follow-up.", traditionalView: "A satisfaction survey program run by marketing.", economicView: "A revenue-protection capability that drives retention and referrals.", benchmarkScore: 50, metrics: [{ name: "Patient Satisfaction Score", description: "Overall patient satisfaction rating", unit: "score", benchmarkValue: 78 }, { name: "Wait Time", description: "Average patient wait time", unit: "minutes", benchmarkValue: 20 }] },
        { slug: "revenue-cycle", name: "Revenue Cycle Management", description: "The financial processes from patient registration through final payment.", traditionalView: "A billing department expense.", economicView: "A cash-flow optimization engine that directly impacts financial viability.", benchmarkScore: 60, metrics: [{ name: "Clean Claim Rate", description: "Percentage of claims accepted on first submission", unit: "percent", benchmarkValue: 90 }, { name: "Days in A/R", description: "Average days in accounts receivable", unit: "days", benchmarkValue: 40 }] },
        { slug: "population-health", name: "Population Health Management", description: "Proactive management of health outcomes across defined patient populations.", traditionalView: "A public health initiative with unclear ROI.", economicView: "A value-based care engine that converts prevention into predictable revenue.", benchmarkScore: 45, metrics: [{ name: "Risk Score Accuracy", description: "Accuracy of patient risk stratification", unit: "percent", benchmarkValue: 75 }, { name: "Preventive Care Compliance", description: "Percentage of patients completing preventive measures", unit: "percent", benchmarkValue: 60 }] },
        { slug: "supply-chain-clinical", name: "Clinical Supply Chain", description: "Procurement and management of medical supplies and pharmaceuticals.", traditionalView: "A materials management cost to be minimized.", economicView: "A clinical-quality enabler where stockouts have outsized patient and financial impact.", benchmarkScore: 60, metrics: [{ name: "Supply Waste Rate", description: "Percentage of expired or unused supplies", unit: "percent", benchmarkValue: 5 }, { name: "Stockout Incidents", description: "Number of critical supply stockouts per quarter", unit: "count", benchmarkValue: 3 }] },
        { slug: "telehealth", name: "Telehealth & Virtual Care", description: "Remote healthcare delivery through digital channels.", traditionalView: "A COVID-era stopgap measure.", economicView: "A scalable access-expansion capability with near-zero marginal delivery cost.", benchmarkScore: 50, metrics: [{ name: "Virtual Visit Utilization", description: "Percentage of visits conducted virtually", unit: "percent", benchmarkValue: 25 }, { name: "Patient No-Show Rate", description: "No-show rate for virtual vs in-person", unit: "percent", benchmarkValue: 5 }] },
        { slug: "clinical-workforce", name: "Clinical Workforce Management", description: "Recruitment, scheduling, and retention of clinical staff.", traditionalView: "An HR staffing function.", economicView: "A mission-critical capability where burnout directly erodes care quality and revenue.", benchmarkScore: 55, metrics: [{ name: "Nurse Turnover Rate", description: "Annual nursing staff turnover", unit: "percent", benchmarkValue: 18 }, { name: "Staff-to-Patient Ratio", description: "Average staff to patient ratio", unit: "ratio", benchmarkValue: 4.5 }] },
        { slug: "health-data-interop", name: "Health Data Interoperability", description: "Ability to exchange and use health data across systems and organizations.", traditionalView: "An IT compliance requirement.", economicView: "A data-liquidity capability that unlocks cross-system care coordination value.", benchmarkScore: 40, metrics: [{ name: "Data Exchange Success Rate", description: "Percentage of successful cross-system data exchanges", unit: "percent", benchmarkValue: 80 }, { name: "Duplicate Record Rate", description: "Percentage of duplicate patient records", unit: "percent", benchmarkValue: 8 }] },
        { slug: "quality-safety", name: "Quality & Patient Safety", description: "Programs ensuring clinical quality standards and patient safety.", traditionalView: "A regulatory compliance checkbox.", economicView: "A brand-protection and value-based payment optimization capability.", benchmarkScore: 70, metrics: [{ name: "Hospital-Acquired Infection Rate", description: "HAI rate per 1000 patient days", unit: "rate", benchmarkValue: 1.2 }, { name: "Medication Error Rate", description: "Medication errors per 1000 orders", unit: "rate", benchmarkValue: 0.5 }] },
      ]
    },
    {
      slug: "banking", name: "Banking & Financial Services", icon: "Landmark",
      description: "Banking is being disrupted by fintechs that understand capability economics instinctively. Traditional banks must learn to value their capabilities as economic assets or risk being unbundled by more agile competitors.",
      capabilities: [
        { slug: "credit-decisioning", name: "Credit Decisioning", description: "The process of evaluating creditworthiness and making lending decisions.", traditionalView: "A risk management function with fixed approval criteria.", economicView: "A revenue-generating engine where speed and accuracy drive market share in lending.", benchmarkScore: 65, metrics: [{ name: "Decision Speed", description: "Average time from application to decision", unit: "minutes", benchmarkValue: 15 }, { name: "Default Rate", description: "Percentage of loans that default", unit: "percent", benchmarkValue: 2.5 }] },
        { slug: "digital-banking", name: "Digital Banking Platform", description: "Mobile and online banking interfaces for customer self-service.", traditionalView: "A channel migration project to reduce branch costs.", economicView: "The primary customer relationship platform that drives engagement and cross-sell.", benchmarkScore: 55, metrics: [{ name: "Mobile Adoption Rate", description: "Percentage of customers using mobile banking", unit: "percent", benchmarkValue: 70 }, { name: "Digital Sales Conversion", description: "Percentage of digital interactions leading to product sales", unit: "percent", benchmarkValue: 8 }] },
        { slug: "aml-kyc", name: "AML/KYC Compliance", description: "Anti-money laundering and know-your-customer verification processes.", traditionalView: "A regulatory cost burden.", economicView: "A competitive advantage when automated — enabling faster onboarding and lower friction.", benchmarkScore: 60, metrics: [{ name: "Onboarding Time", description: "Average time to complete KYC verification", unit: "hours", benchmarkValue: 24 }, { name: "False Alert Rate", description: "Percentage of AML alerts that are false positives", unit: "percent", benchmarkValue: 90 }] },
        { slug: "payment-processing", name: "Payment Processing", description: "Infrastructure for processing payments, transfers, and settlements.", traditionalView: "A utility function that simply needs to work.", economicView: "A platform capability whose speed and reliability drive ecosystem value.", benchmarkScore: 75, metrics: [{ name: "Transaction Success Rate", description: "Percentage of transactions completed successfully", unit: "percent", benchmarkValue: 99.5 }, { name: "Settlement Speed", description: "Average time to final settlement", unit: "hours", benchmarkValue: 2 }] },
        { slug: "wealth-advisory", name: "Wealth Management & Advisory", description: "Personalized financial planning and investment advisory services.", traditionalView: "A high-touch, relationship-driven service for HNW clients.", economicView: "A scalable advisory capability where technology amplifies advisor impact.", benchmarkScore: 50, metrics: [{ name: "AUM per Advisor", description: "Assets under management per financial advisor", unit: "millions", benchmarkValue: 150 }, { name: "Client Retention Rate", description: "Annual client retention rate", unit: "percent", benchmarkValue: 92 }] },
        { slug: "fraud-prevention-bank", name: "Fraud Prevention", description: "Real-time detection and prevention of financial fraud.", traditionalView: "A loss-prevention function.", economicView: "A customer-trust capability where false positives erode revenue more than fraud itself.", benchmarkScore: 60, metrics: [{ name: "Fraud Loss Rate", description: "Fraud losses as percentage of transaction volume", unit: "basis_points", benchmarkValue: 5 }, { name: "False Decline Rate", description: "Percentage of legitimate transactions declined", unit: "percent", benchmarkValue: 3 }] },
        { slug: "core-banking", name: "Core Banking Modernization", description: "The foundational technology platform for all banking operations.", traditionalView: "A massive multi-year IT replacement project.", economicView: "A platform capability that determines the velocity of all other capability improvements.", benchmarkScore: 45, metrics: [{ name: "API Response Time", description: "Average core system API latency", unit: "milliseconds", benchmarkValue: 200 }, { name: "System Availability", description: "Core banking uptime percentage", unit: "percent", benchmarkValue: 99.9 }] },
        { slug: "risk-management-bank", name: "Enterprise Risk Management", description: "Holistic identification, assessment, and mitigation of business risks.", traditionalView: "A compliance-driven reporting function.", economicView: "A strategic capability that enables informed risk-taking for growth.", benchmarkScore: 65, metrics: [{ name: "Risk-Adjusted Return", description: "Return on risk-weighted assets", unit: "percent", benchmarkValue: 1.2 }, { name: "Stress Test Compliance", description: "Margin above minimum capital requirements", unit: "percent", benchmarkValue: 3 }] },
        { slug: "customer-analytics-bank", name: "Customer Analytics", description: "Data-driven insights into customer behavior and preferences.", traditionalView: "A marketing analytics function.", economicView: "A cross-sell and retention optimization engine.", benchmarkScore: 50, metrics: [{ name: "Products per Customer", description: "Average number of products per household", unit: "count", benchmarkValue: 3.5 }, { name: "Next-Best-Action Accuracy", description: "Conversion rate of recommended actions", unit: "percent", benchmarkValue: 12 }] },
        { slug: "open-banking", name: "Open Banking & APIs", description: "Standardized APIs enabling third-party access to banking services.", traditionalView: "A regulatory mandate to comply with.", economicView: "An ecosystem-expansion capability creating new revenue streams from banking-as-a-service.", benchmarkScore: 40, metrics: [{ name: "API Partner Count", description: "Number of active third-party API consumers", unit: "count", benchmarkValue: 50 }, { name: "API Revenue Share", description: "Revenue generated from API-based services", unit: "percent", benchmarkValue: 5 }] },
      ]
    },
    {
      slug: "manufacturing", name: "Manufacturing", icon: "Factory",
      description: "Manufacturing leaders who apply capability economics shift from managing costs to managing value chains. Every production capability has an economic profile that can be measured, optimized, and invested in strategically.",
      capabilities: [
        { slug: "predictive-maintenance", name: "Predictive Maintenance", description: "Using data and analytics to predict equipment failures before they occur.", traditionalView: "A maintenance department expense.", economicView: "An uptime-maximization capability with direct impact on production revenue.", benchmarkScore: 50, metrics: [{ name: "Unplanned Downtime", description: "Hours of unplanned equipment downtime per month", unit: "hours", benchmarkValue: 8 }, { name: "Maintenance Cost Ratio", description: "Maintenance cost as percentage of asset value", unit: "percent", benchmarkValue: 3 }] },
        { slug: "quality-management", name: "Quality Management", description: "Systems and processes ensuring product quality from raw materials to finished goods.", traditionalView: "An inspection and defect-catching function.", economicView: "A brand-protection and waste-reduction capability with compounding returns.", benchmarkScore: 65, metrics: [{ name: "First Pass Yield", description: "Percentage of products passing quality on first attempt", unit: "percent", benchmarkValue: 92 }, { name: "Cost of Quality", description: "Total quality costs as percentage of revenue", unit: "percent", benchmarkValue: 4 }] },
        { slug: "supply-chain-mgmt", name: "Supply Chain Management", description: "End-to-end management of the supply chain from procurement to delivery.", traditionalView: "A logistics and purchasing function.", economicView: "A strategic flexibility capability that determines speed-to-market and resilience.", benchmarkScore: 60, metrics: [{ name: "Order Fulfillment Cycle", description: "Average time from order to delivery", unit: "days", benchmarkValue: 5 }, { name: "Supply Chain Cost", description: "Total supply chain cost as percentage of revenue", unit: "percent", benchmarkValue: 8 }] },
        { slug: "production-planning", name: "Production Planning & Scheduling", description: "Optimizing production schedules to maximize throughput and minimize waste.", traditionalView: "A scheduling spreadsheet managed by plant managers.", economicView: "A throughput-optimization capability where minutes of efficiency drive millions in value.", benchmarkScore: 55, metrics: [{ name: "Schedule Adherence", description: "Percentage of production runs completed on schedule", unit: "percent", benchmarkValue: 88 }, { name: "Changeover Time", description: "Average time to switch between product runs", unit: "minutes", benchmarkValue: 45 }] },
        { slug: "product-engineering", name: "Product Engineering & Design", description: "Designing and engineering new products for manufacturability and market fit.", traditionalView: "An R&D cost center.", economicView: "A market-capture capability where design-for-manufacturing reduces lifecycle costs.", benchmarkScore: 60, metrics: [{ name: "Time to Market", description: "Average time from concept to production", unit: "months", benchmarkValue: 12 }, { name: "Engineering Change Orders", description: "Number of ECOs per product launch", unit: "count", benchmarkValue: 15 }] },
        { slug: "smart-factory", name: "Smart Factory / IoT", description: "Connected factory floor with sensors, automation, and real-time analytics.", traditionalView: "An Industry 4.0 technology initiative.", economicView: "A productivity-amplification capability with data-driven continuous improvement.", benchmarkScore: 40, metrics: [{ name: "OEE Score", description: "Overall Equipment Effectiveness", unit: "percent", benchmarkValue: 75 }, { name: "Connected Device Count", description: "Number of IoT sensors per production line", unit: "count", benchmarkValue: 50 }] },
        { slug: "workforce-safety", name: "Workforce Safety & Training", description: "Programs ensuring worker safety and continuous skills development.", traditionalView: "An OSHA compliance requirement.", economicView: "A productivity and retention capability — safe workers are productive workers.", benchmarkScore: 70, metrics: [{ name: "Incident Rate", description: "OSHA recordable incidents per 200,000 hours", unit: "rate", benchmarkValue: 2.5 }, { name: "Training Hours", description: "Average training hours per employee per year", unit: "hours", benchmarkValue: 40 }] },
        { slug: "sustainability-mfg", name: "Sustainability & ESG", description: "Environmental sustainability and responsible manufacturing practices.", traditionalView: "A PR initiative and regulatory compliance cost.", economicView: "A market-access capability — increasingly required by customers and investors.", benchmarkScore: 45, metrics: [{ name: "Carbon Intensity", description: "CO2 emissions per unit of production", unit: "kg", benchmarkValue: 2.5 }, { name: "Waste Diversion Rate", description: "Percentage of waste diverted from landfill", unit: "percent", benchmarkValue: 75 }] },
        { slug: "inventory-optimization", name: "Inventory Optimization", description: "Balancing inventory levels to minimize carrying costs while preventing stockouts.", traditionalView: "A warehousing and materials management function.", economicView: "A working-capital optimization capability with direct impact on cash flow.", benchmarkScore: 55, metrics: [{ name: "Inventory Turns", description: "Annual inventory turnover rate", unit: "turns", benchmarkValue: 8 }, { name: "Stockout Rate", description: "Percentage of orders impacted by stockouts", unit: "percent", benchmarkValue: 3 }] },
      ]
    },
    {
      slug: "technology", name: "Technology", icon: "Cpu",
      description: "Technology companies live and die by their capabilities. In an industry where every competitor has access to similar talent and tools, capability economics reveals which organizational capabilities create genuine competitive moats.",
      capabilities: [
        { slug: "platform-engineering", name: "Platform Engineering", description: "Building and maintaining the core technology platform that other teams build upon.", traditionalView: "An internal infrastructure cost.", economicView: "A developer-productivity multiplier — every efficiency gain compounds across all teams.", benchmarkScore: 55, metrics: [{ name: "Developer Velocity", description: "Average deployments per developer per week", unit: "count", benchmarkValue: 5 }, { name: "Platform Reliability", description: "Platform uptime percentage", unit: "percent", benchmarkValue: 99.9 }] },
        { slug: "product-development", name: "Product Development", description: "The end-to-end process of building and shipping software products.", traditionalView: "A project-managed delivery function.", economicView: "A revenue-generation engine where cycle time directly correlates to market capture.", benchmarkScore: 60, metrics: [{ name: "Feature Lead Time", description: "Average time from idea to production", unit: "days", benchmarkValue: 14 }, { name: "Release Frequency", description: "Number of production releases per month", unit: "count", benchmarkValue: 20 }] },
        { slug: "ai-ml-ops", name: "AI/ML Operations", description: "Building, deploying, and managing machine learning models at scale.", traditionalView: "A data science experimentation budget.", economicView: "A product-differentiation capability where model quality drives competitive advantage.", benchmarkScore: 45, metrics: [{ name: "Model Deployment Time", description: "Average time from model training to production", unit: "days", benchmarkValue: 7 }, { name: "Model Accuracy Drift", description: "Average model accuracy degradation per quarter", unit: "percent", benchmarkValue: 2 }] },
        { slug: "cloud-infrastructure", name: "Cloud Infrastructure", description: "Management of cloud computing resources and architecture.", traditionalView: "An IT cost to be minimized.", economicView: "A scalability and reliability capability that enables business growth without proportional cost.", benchmarkScore: 65, metrics: [{ name: "Cloud Cost per Transaction", description: "Infrastructure cost per user transaction", unit: "cents", benchmarkValue: 0.5 }, { name: "Auto-Scaling Efficiency", description: "Percentage of optimal resource utilization", unit: "percent", benchmarkValue: 70 }] },
        { slug: "cybersecurity", name: "Cybersecurity", description: "Protection of systems, data, and users from cyber threats.", traditionalView: "An insurance policy — a cost to prevent bad things.", economicView: "A trust-building capability that enables business growth and customer confidence.", benchmarkScore: 60, metrics: [{ name: "Mean Time to Detect", description: "Average time to detect a security incident", unit: "hours", benchmarkValue: 4 }, { name: "Vulnerability Patch Time", description: "Average time to patch critical vulnerabilities", unit: "days", benchmarkValue: 3 }] },
        { slug: "developer-experience", name: "Developer Experience", description: "Tools, processes, and culture that make developers productive and engaged.", traditionalView: "A nice-to-have perk for engineers.", economicView: "A talent-retention and productivity capability with 10x impact on output.", benchmarkScore: 50, metrics: [{ name: "Build Time", description: "Average CI/CD pipeline execution time", unit: "minutes", benchmarkValue: 10 }, { name: "Developer Satisfaction", description: "Internal developer satisfaction score", unit: "score", benchmarkValue: 72 }] },
        { slug: "data-engineering", name: "Data Engineering", description: "Building and maintaining data pipelines and infrastructure.", traditionalView: "An ETL job management function.", economicView: "A data-liquidity capability that determines the speed of every data-driven decision.", benchmarkScore: 55, metrics: [{ name: "Pipeline Reliability", description: "Percentage of data pipelines running without failure", unit: "percent", benchmarkValue: 95 }, { name: "Data Freshness", description: "Average latency of data in analytics systems", unit: "minutes", benchmarkValue: 30 }] },
        { slug: "product-analytics", name: "Product Analytics", description: "Measuring and analyzing user behavior to inform product decisions.", traditionalView: "A reporting dashboard for product managers.", economicView: "A decision-quality capability that reduces the cost of wrong product bets.", benchmarkScore: 55, metrics: [{ name: "Experiment Velocity", description: "Number of A/B tests run per month", unit: "count", benchmarkValue: 15 }, { name: "Feature Adoption Rate", description: "Percentage of users adopting new features within 30 days", unit: "percent", benchmarkValue: 25 }] },
        { slug: "customer-success-tech", name: "Customer Success", description: "Proactive management of customer health and expansion.", traditionalView: "A support cost center.", economicView: "A net-revenue-retention engine where expansion revenue compounds.", benchmarkScore: 55, metrics: [{ name: "Net Revenue Retention", description: "Year-over-year revenue from existing customers", unit: "percent", benchmarkValue: 110 }, { name: "Time to Value", description: "Average days from signup to first value moment", unit: "days", benchmarkValue: 14 }] },
        { slug: "api-ecosystem", name: "API Ecosystem & Partnerships", description: "Building and managing APIs and integrations with partner ecosystems.", traditionalView: "An integration maintenance burden.", economicView: "A network-effect capability where each integration increases platform value.", benchmarkScore: 45, metrics: [{ name: "Active Integrations", description: "Number of active partner integrations", unit: "count", benchmarkValue: 100 }, { name: "API-Driven Revenue", description: "Percentage of revenue from API-connected customers", unit: "percent", benchmarkValue: 30 }] },
      ]
    },
    {
      slug: "retail", name: "Retail", icon: "ShoppingCart",
      description: "Retail is being transformed by companies that understand their capabilities as economic assets. The winners invest strategically in capabilities like personalization, supply chain, and omnichannel — not just in stores or e-commerce.",
      capabilities: [
        { slug: "omnichannel-experience", name: "Omnichannel Experience", description: "Seamless customer experience across physical stores, online, and mobile.", traditionalView: "A channel management challenge.", economicView: "A customer-capture capability where channel integration drives higher LTV.", benchmarkScore: 50, metrics: [{ name: "Cross-Channel Conversion", description: "Conversion rate for customers using multiple channels", unit: "percent", benchmarkValue: 12 }, { name: "Channel Attribution Accuracy", description: "Accuracy of revenue attribution across channels", unit: "percent", benchmarkValue: 65 }] },
        { slug: "personalization-retail", name: "Personalization Engine", description: "Delivering tailored product recommendations and experiences.", traditionalView: "A marketing automation feature.", economicView: "A revenue-per-visit multiplier that drives basket size and repeat purchases.", benchmarkScore: 45, metrics: [{ name: "Recommendation Click-Through", description: "Click-through rate on personalized recommendations", unit: "percent", benchmarkValue: 8 }, { name: "Average Order Value Lift", description: "Increase in AOV from personalization", unit: "percent", benchmarkValue: 15 }] },
        { slug: "supply-chain-retail", name: "Supply Chain & Logistics", description: "End-to-end supply chain from supplier to customer doorstep.", traditionalView: "A warehousing and shipping cost.", economicView: "A customer-promise capability — delivery speed and reliability drive purchase decisions.", benchmarkScore: 60, metrics: [{ name: "Order-to-Delivery Time", description: "Average time from order to customer receipt", unit: "days", benchmarkValue: 3 }, { name: "Last-Mile Cost", description: "Cost per package for last-mile delivery", unit: "dollars", benchmarkValue: 8 }] },
        { slug: "inventory-management-retail", name: "Inventory Management", description: "Optimizing stock levels across stores, warehouses, and distribution centers.", traditionalView: "A warehouse management function.", economicView: "A margin-protection capability — markdowns and stockouts are the silent profit killers.", benchmarkScore: 55, metrics: [{ name: "Inventory Accuracy", description: "Percentage accuracy of inventory records", unit: "percent", benchmarkValue: 95 }, { name: "Markdown Rate", description: "Percentage of units sold at markdown", unit: "percent", benchmarkValue: 20 }] },
        { slug: "customer-loyalty", name: "Customer Loyalty & Engagement", description: "Programs and strategies for building customer loyalty and repeat business.", traditionalView: "A points-based rewards program.", economicView: "A behavioral-economics capability that turns transactions into relationships.", benchmarkScore: 50, metrics: [{ name: "Loyalty Program Penetration", description: "Percentage of sales from loyalty members", unit: "percent", benchmarkValue: 55 }, { name: "Repeat Purchase Rate", description: "Percentage of customers making repeat purchases", unit: "percent", benchmarkValue: 40 }] },
        { slug: "merchandise-planning", name: "Merchandise Planning", description: "Strategic planning of product assortments, pricing, and promotions.", traditionalView: "A seasonal buying function.", economicView: "A demand-shaping capability where data-driven assortment drives sell-through.", benchmarkScore: 55, metrics: [{ name: "Sell-Through Rate", description: "Percentage of inventory sold at full price", unit: "percent", benchmarkValue: 70 }, { name: "Forecast Accuracy", description: "Accuracy of demand forecasts", unit: "percent", benchmarkValue: 75 }] },
        { slug: "store-operations", name: "Store Operations Excellence", description: "Optimizing in-store processes, staffing, and customer service.", traditionalView: "A labor cost to be minimized.", economicView: "A customer-conversion capability where in-store experience drives brand loyalty.", benchmarkScore: 60, metrics: [{ name: "Sales per Square Foot", description: "Annual revenue per square foot of retail space", unit: "dollars", benchmarkValue: 400 }, { name: "Employee Engagement", description: "Store associate engagement score", unit: "score", benchmarkValue: 65 }] },
        { slug: "ecommerce-platform", name: "E-Commerce Platform", description: "Digital commerce infrastructure including website, checkout, and fulfillment.", traditionalView: "A website that needs to work.", economicView: "A zero-friction revenue engine where every millisecond of load time impacts conversion.", benchmarkScore: 55, metrics: [{ name: "Conversion Rate", description: "Online visitor to purchase conversion", unit: "percent", benchmarkValue: 3.5 }, { name: "Page Load Time", description: "Average page load time", unit: "seconds", benchmarkValue: 2.5 }] },
        { slug: "private-label", name: "Private Label Development", description: "Design, sourcing, and management of private-label product lines.", traditionalView: "A low-cost alternative to national brands.", economicView: "A margin-expansion and differentiation capability that builds brand identity.", benchmarkScore: 45, metrics: [{ name: "Private Label Penetration", description: "Percentage of revenue from private label", unit: "percent", benchmarkValue: 25 }, { name: "Private Label Margin Premium", description: "Margin premium over national brands", unit: "percent", benchmarkValue: 15 }] },
        { slug: "customer-data-retail", name: "Customer Data Platform", description: "Unified customer data infrastructure powering analytics and personalization.", traditionalView: "A CRM system.", economicView: "The data backbone that amplifies ROI of every customer-facing capability.", benchmarkScore: 45, metrics: [{ name: "Customer Identity Resolution", description: "Percentage of customers with unified profiles", unit: "percent", benchmarkValue: 60 }, { name: "Data-Driven Campaign Lift", description: "Revenue lift from data-driven campaigns", unit: "percent", benchmarkValue: 20 }] },
      ]
    },
  ];

  for (const industryData of industriesData) {
    const [industry] = await db.insert(industriesTable).values({
      slug: industryData.slug,
      name: industryData.name,
      description: industryData.description,
      icon: industryData.icon,
    }).returning();

    console.log(`  Created industry: ${industry.name}`);

    const capMap: Record<string, number> = {};

    for (const capData of industryData.capabilities) {
      const [cap] = await db.insert(capabilitiesTable).values({
        industryId: industry.id,
        slug: capData.slug,
        name: capData.name,
        description: capData.description,
        traditionalView: capData.traditionalView,
        economicView: capData.economicView,
        benchmarkScore: capData.benchmarkScore,
      }).returning();

      capMap[capData.slug] = cap.id;

      if (capData.metrics && capData.metrics.length > 0) {
        await db.insert(capabilityMetricsTable).values(
          capData.metrics.map(m => ({
            capabilityId: cap.id,
            name: m.name,
            description: m.description,
            unit: m.unit,
            benchmarkValue: m.benchmarkValue,
          }))
        );
      }

      const roleMappings = getRoleMappingsForCapability(capData.slug, cap.id, roleMap);
      if (roleMappings.length > 0) {
        await db.insert(capabilityRoleMappingsTable).values(roleMappings);
      }
    }

    const deps = getDependenciesForIndustry(industryData.slug, capMap);
    if (deps.length > 0) {
      await db.insert(capabilityDependenciesTable).values(deps);
    }
  }

  console.log("Seed complete!");
}

function getRoleMappingsForCapability(capSlug: string, capId: number, roleMap: Record<string, number>) {
  const mappings: { capabilityId: number; roleId: number; relevance: string; perspective: string }[] = [];

  const perspectiveMap: Record<string, { role: string; relevance: string; perspective: string }[]> = {
    "precision-underwriting": [
      { role: "ceo", relevance: "high", perspective: "Core competitive advantage — determines market position." },
      { role: "cfo", relevance: "high", perspective: "Direct P&L lever — accuracy drives combined ratio." },
      { role: "cto", relevance: "medium", perspective: "Technology enabler for automated decisioning." },
    ],
    "rapid-claims": [
      { role: "ceo", relevance: "high", perspective: "Brand-defining capability and retention driver." },
      { role: "coo", relevance: "high", perspective: "Operational throughput and quality control." },
      { role: "cmo", relevance: "medium", perspective: "Key differentiator in marketing and brand trust." },
    ],
    "fraud-detection": [
      { role: "cfo", relevance: "high", perspective: "Direct savings impact on bottom line." },
      { role: "cto", relevance: "high", perspective: "AI/ML technology investment priority." },
      { role: "cio", relevance: "medium", perspective: "Data infrastructure and pattern detection." },
    ],
    "clinical-decision-support": [
      { role: "ceo", relevance: "high", perspective: "Patient outcomes drive reputation and revenue." },
      { role: "cto", relevance: "high", perspective: "AI-enabled clinical tooling." },
      { role: "cio", relevance: "medium", perspective: "Data governance for clinical data." },
    ],
    "credit-decisioning": [
      { role: "ceo", relevance: "high", perspective: "Core business — speed drives market share." },
      { role: "cfo", relevance: "high", perspective: "Risk-adjusted return optimization." },
      { role: "cto", relevance: "medium", perspective: "Real-time decisioning infrastructure." },
    ],
    "predictive-maintenance": [
      { role: "coo", relevance: "high", perspective: "Uptime is the primary operational KPI." },
      { role: "cfo", relevance: "medium", perspective: "CapEx vs OpEx optimization for maintenance." },
      { role: "cto", relevance: "high", perspective: "IoT and data analytics investment." },
    ],
    "platform-engineering": [
      { role: "cto", relevance: "high", perspective: "Foundation for all engineering velocity." },
      { role: "ceo", relevance: "medium", perspective: "Developer productivity drives time-to-market." },
      { role: "cpo", relevance: "medium", perspective: "Platform capabilities enable product speed." },
    ],
    "omnichannel-experience": [
      { role: "ceo", relevance: "high", perspective: "Defines the customer relationship." },
      { role: "cmo", relevance: "high", perspective: "Brand experience and customer journey." },
      { role: "cto", relevance: "medium", perspective: "Technology integration across channels." },
    ],
  };

  const entries = perspectiveMap[capSlug];
  if (entries) {
    for (const e of entries) {
      if (roleMap[e.role]) {
        mappings.push({ capabilityId: capId, roleId: roleMap[e.role], relevance: e.relevance, perspective: e.perspective });
      }
    }
  } else {
    const defaultRoles = ["ceo", "coo", "cfo"];
    for (const role of defaultRoles.slice(0, 2)) {
      if (roleMap[role]) {
        mappings.push({ capabilityId: capId, roleId: roleMap[role], relevance: "medium", perspective: `This capability has strategic implications for the ${role.toUpperCase()}'s objectives.` });
      }
    }
  }

  return mappings;
}

function getDependenciesForIndustry(industrySlug: string, capMap: Record<string, number>) {
  const deps: { capabilityId: number; dependsOnId: number; strength: string }[] = [];

  const depsMap: Record<string, [string, string, string][]> = {
    insurance: [
      ["precision-underwriting", "data-analytics", "strong"],
      ["precision-underwriting", "actuarial-modeling", "strong"],
      ["rapid-claims", "fraud-detection", "moderate"],
      ["digital-distribution", "data-analytics", "moderate"],
      ["customer-retention", "rapid-claims", "strong"],
      ["agent-enablement", "digital-distribution", "moderate"],
    ],
    healthcare: [
      ["clinical-decision-support", "health-data-interop", "strong"],
      ["population-health", "clinical-decision-support", "moderate"],
      ["telehealth", "health-data-interop", "moderate"],
      ["revenue-cycle", "patient-experience", "moderate"],
      ["quality-safety", "clinical-workforce", "strong"],
    ],
    banking: [
      ["credit-decisioning", "customer-analytics-bank", "strong"],
      ["digital-banking", "core-banking", "strong"],
      ["fraud-prevention-bank", "aml-kyc", "moderate"],
      ["wealth-advisory", "customer-analytics-bank", "moderate"],
      ["open-banking", "core-banking", "strong"],
    ],
    manufacturing: [
      ["predictive-maintenance", "smart-factory", "strong"],
      ["quality-management", "production-planning", "moderate"],
      ["supply-chain-mgmt", "inventory-optimization", "strong"],
      ["smart-factory", "data-analytics", "moderate"],
      ["product-engineering", "quality-management", "moderate"],
    ],
    technology: [
      ["product-development", "platform-engineering", "strong"],
      ["ai-ml-ops", "data-engineering", "strong"],
      ["product-analytics", "data-engineering", "moderate"],
      ["customer-success-tech", "product-analytics", "moderate"],
      ["api-ecosystem", "platform-engineering", "moderate"],
    ],
    retail: [
      ["personalization-retail", "customer-data-retail", "strong"],
      ["omnichannel-experience", "ecommerce-platform", "strong"],
      ["supply-chain-retail", "inventory-management-retail", "strong"],
      ["merchandise-planning", "customer-data-retail", "moderate"],
      ["customer-loyalty", "personalization-retail", "moderate"],
    ],
  };

  const industryDeps = depsMap[industrySlug] || [];
  for (const [from, to, strength] of industryDeps) {
    if (capMap[from] && capMap[to]) {
      deps.push({ capabilityId: capMap[from], dependsOnId: capMap[to], strength });
    }
  }

  return deps;
}

async function run() {
  await seed();
  const { seedProjects } = await import("./seed-projects");
  await seedProjects();
  const { seedInsights } = await import("./seed-insights");
  await seedInsights();
}

run().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
