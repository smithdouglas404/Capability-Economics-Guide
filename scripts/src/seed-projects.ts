import { db } from "@workspace/db";
import {
  technologyProjectsTable,
  projectCapabilityImpactsTable,
  projectExecutiveInsightsTable,
  projectRisksTable,
  capabilitiesTable,
  industriesTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";

async function seedProjects() {
  const existing = await db.select().from(technologyProjectsTable).limit(1);
  if (existing.length > 0) {
    console.log("Technology projects already exist — skipping projects seed.");
    return;
  }

  console.log("Seeding technology projects...");

  await db.execute(sql`TRUNCATE project_risks, project_executive_insights, project_capability_impacts, technology_projects RESTART IDENTITY CASCADE`);

  const allCaps = await db
    .select({
      id: capabilitiesTable.id,
      slug: capabilitiesTable.slug,
      industryId: capabilitiesTable.industryId,
      benchmarkScore: capabilitiesTable.benchmarkScore,
    })
    .from(capabilitiesTable);

  const cap = (slug: string) => {
    const found = allCaps.find(c => c.slug === slug);
    if (!found) throw new Error(`Capability not found: ${slug}`);
    return found;
  };

  const projects = await db.insert(technologyProjectsTable).values([
    {
      slug: "enterprise-ai-platform",
      name: "Enterprise AI Platform",
      category: "Artificial Intelligence",
      description: "Deploy a unified AI/ML platform enabling predictive analytics, natural language processing, and computer vision across business functions. Includes model training infrastructure, MLOps pipelines, and AI governance frameworks.",
      businessCase: "Organizations with mature AI platforms see 3-5x faster time-to-insight and 15-25% improvement in decision accuracy across underwriting, fraud detection, clinical decision support, and predictive maintenance.",
      typicalTimeline: "12-18 months",
      investmentRange: "$2M - $8M",
      complexityLevel: "high",
      icon: "Brain",
    },
    {
      slug: "intelligent-process-automation",
      name: "Intelligent Process Automation",
      category: "Artificial Intelligence",
      description: "Combine RPA with AI-powered document processing, decision engines, and workflow orchestration to automate complex business processes end-to-end. Goes beyond simple task automation to intelligent, adaptive process handling.",
      businessCase: "IPA delivers 40-60% cost reduction in targeted processes while improving accuracy and throughput. Claims processing, loan origination, and order fulfillment see the highest ROI within 6-9 months.",
      typicalTimeline: "6-12 months",
      investmentRange: "$500K - $3M",
      complexityLevel: "medium",
      icon: "Zap",
    },
    {
      slug: "cloud-native-modernization",
      name: "Cloud-Native Application Modernization",
      category: "Application Modernization",
      description: "Re-architect monolithic applications into cloud-native microservices with containerization, serverless computing, and managed cloud services. Includes CI/CD pipeline modernization and cloud-native security.",
      businessCase: "Cloud-native organizations deploy 200x more frequently with 24x faster recovery times. Infrastructure costs decrease 30-50% through auto-scaling, while developer productivity increases 40-60%.",
      typicalTimeline: "12-24 months",
      investmentRange: "$3M - $12M",
      complexityLevel: "high",
      icon: "Cloud",
    },
    {
      slug: "api-first-platform",
      name: "API-First Digital Platform",
      category: "Application Modernization",
      description: "Build a composable digital platform with API-first architecture enabling rapid integration, partner ecosystems, and omnichannel experiences. Includes API gateway, developer portal, and API lifecycle management.",
      businessCase: "API-first organizations create new revenue channels 3x faster and reduce integration costs by 60%. Open banking, embedded insurance, and marketplace models become viable with API monetization potential.",
      typicalTimeline: "9-15 months",
      investmentRange: "$1M - $5M",
      complexityLevel: "medium",
      icon: "Network",
    },
    {
      slug: "mainframe-migration",
      name: "Mainframe Migration & Modernization",
      category: "Mainframe Modernization",
      description: "Migrate critical workloads from legacy mainframe systems to modern cloud or hybrid infrastructure. Includes COBOL-to-modern language conversion, data migration, and parallel-run validation to ensure business continuity.",
      businessCase: "Mainframe costs grow 5-8% annually while talent pool shrinks. Migration reduces TCO by 40-70%, unlocks data trapped in legacy systems, and eliminates single-point-of-failure risk. Delayed migration compounds technical debt exponentially.",
      typicalTimeline: "18-36 months",
      investmentRange: "$5M - $25M",
      complexityLevel: "critical",
      icon: "Server",
    },
    {
      slug: "data-platform-modernization",
      name: "Data & Analytics Platform Modernization",
      category: "Data Modernization",
      description: "Build a modern data platform with real-time streaming, data mesh architecture, and self-service analytics. Replaces legacy data warehouses with cloud-native lakehouse architecture enabling AI/ML workloads.",
      businessCase: "Modern data platforms reduce time-to-insight from weeks to minutes. Organizations see 20-35% improvement in customer retention through real-time personalization and 15-25% operational cost reduction through data-driven optimization.",
      typicalTimeline: "9-18 months",
      investmentRange: "$2M - $8M",
      complexityLevel: "high",
      icon: "Database",
    },
  ]).returning();

  const projectMap = Object.fromEntries(projects.map(p => [p.slug, p.id]));

  const impactData: Array<{ projectSlug: string; capSlug: string; uplift: number; months: number; desc: string }> = [
    { projectSlug: "enterprise-ai-platform", capSlug: "precision-underwriting", uplift: 18, months: 12, desc: "AI-driven risk scoring replaces manual underwriting rules, enabling real-time pricing with 3x more variables and 15-20% improvement in loss ratio prediction." },
    { projectSlug: "enterprise-ai-platform", capSlug: "fraud-detection", uplift: 22, months: 9, desc: "ML anomaly detection identifies complex fraud patterns invisible to rules-based systems, improving detection rates by 30% while reducing false positives by 50%." },
    { projectSlug: "enterprise-ai-platform", capSlug: "clinical-decision-support", uplift: 20, months: 15, desc: "AI-assisted diagnosis and treatment recommendations reduce diagnostic errors by 25% and accelerate evidence-based care protocol adoption." },
    { projectSlug: "enterprise-ai-platform", capSlug: "predictive-maintenance", uplift: 25, months: 12, desc: "ML models analyzing IoT sensor data predict equipment failures 2-4 weeks in advance, reducing unplanned downtime by 35-50% and maintenance costs by 20%." },
    { projectSlug: "enterprise-ai-platform", capSlug: "personalization-retail", uplift: 20, months: 9, desc: "Real-time recommendation engines and dynamic pricing powered by ML increase average order value by 15-25% and conversion rates by 10-15%." },
    { projectSlug: "enterprise-ai-platform", capSlug: "ai-ml-ops", uplift: 30, months: 6, desc: "Establishes the foundational MLOps infrastructure that all other AI capabilities depend on — model versioning, monitoring, and governance at scale." },
    { projectSlug: "enterprise-ai-platform", capSlug: "credit-decisioning", uplift: 15, months: 12, desc: "AI credit models incorporate alternative data sources and real-time signals, improving approval rates by 20% while maintaining or reducing default rates." },
    { projectSlug: "enterprise-ai-platform", capSlug: "customer-analytics-bank", uplift: 18, months: 9, desc: "Advanced analytics with ML-driven segmentation enables hyper-personalized product recommendations and proactive churn intervention." },

    { projectSlug: "intelligent-process-automation", capSlug: "rapid-claims", uplift: 20, months: 6, desc: "Intelligent document processing auto-extracts claim data, while AI decision engines auto-adjudicate 40-60% of straightforward claims in minutes." },
    { projectSlug: "intelligent-process-automation", capSlug: "revenue-cycle", uplift: 18, months: 6, desc: "Automated coding, billing verification, and denial management reduces revenue cycle time by 30% and increases clean claim rates to 95%+." },
    { projectSlug: "intelligent-process-automation", capSlug: "aml-kyc", uplift: 15, months: 9, desc: "AI-powered identity verification and transaction monitoring automate 70% of KYC reviews while improving detection of suspicious activities." },
    { projectSlug: "intelligent-process-automation", capSlug: "regulatory-compliance", uplift: 12, months: 6, desc: "Automated compliance monitoring and reporting reduces manual effort by 60% and accelerates regulatory filing turnaround from weeks to days." },
    { projectSlug: "intelligent-process-automation", capSlug: "store-operations", uplift: 15, months: 6, desc: "Automated inventory counting, shelf monitoring, and workforce scheduling optimize store operations and reduce labor costs by 15-20%." },
    { projectSlug: "intelligent-process-automation", capSlug: "production-planning", uplift: 14, months: 9, desc: "AI-driven demand sensing and automated production scheduling improve capacity utilization by 15-20% and reduce changeover times." },

    { projectSlug: "cloud-native-modernization", capSlug: "digital-banking", uplift: 22, months: 18, desc: "Cloud-native banking platform enables 99.99% availability, sub-second response times, and the ability to deploy new features daily instead of quarterly." },
    { projectSlug: "cloud-native-modernization", capSlug: "ecommerce-platform", uplift: 20, months: 12, desc: "Microservices-based ecommerce handles 10x traffic spikes elastically, enables A/B testing at scale, and reduces infrastructure costs by 40%." },
    { projectSlug: "cloud-native-modernization", capSlug: "platform-engineering", uplift: 25, months: 12, desc: "Internal developer platform with container orchestration, service mesh, and observability enables 200x faster deployments and 24x faster recovery." },
    { projectSlug: "cloud-native-modernization", capSlug: "telehealth", uplift: 18, months: 12, desc: "Cloud-native telehealth platform scales to handle demand surges, integrates with EHR systems, and enables HIPAA-compliant video at global scale." },
    { projectSlug: "cloud-native-modernization", capSlug: "cloud-infrastructure", uplift: 28, months: 9, desc: "Infrastructure-as-code, container orchestration, and multi-cloud strategy eliminate vendor lock-in while reducing operational overhead by 50%." },
    { projectSlug: "cloud-native-modernization", capSlug: "cybersecurity", uplift: 15, months: 12, desc: "Cloud-native security with zero-trust architecture, automated threat detection, and immutable infrastructure reduces attack surface by 60%." },

    { projectSlug: "api-first-platform", capSlug: "open-banking", uplift: 25, months: 9, desc: "API-first open banking platform enables fintech partnerships, embedded finance products, and new revenue streams through API monetization." },
    { projectSlug: "api-first-platform", capSlug: "digital-distribution", uplift: 18, months: 9, desc: "API-enabled distribution creates embedded insurance products and affinity partnerships, opening 5-10 new distribution channels without fixed costs." },
    { projectSlug: "api-first-platform", capSlug: "health-data-interop", uplift: 22, months: 12, desc: "FHIR-compliant API platform enables seamless health data exchange across providers, payers, and patients, reducing care coordination gaps by 40%." },
    { projectSlug: "api-first-platform", capSlug: "omnichannel-experience", uplift: 18, months: 9, desc: "API-driven omnichannel orchestration delivers consistent, personalized experiences across web, mobile, in-store, and partner touchpoints." },
    { projectSlug: "api-first-platform", capSlug: "api-ecosystem", uplift: 30, months: 6, desc: "Developer portal, API gateway, and lifecycle management create a thriving ecosystem with 3rd-party integrations and new revenue via API-as-product." },
    { projectSlug: "api-first-platform", capSlug: "smart-factory", uplift: 15, months: 12, desc: "API-connected IoT sensors, MES systems, and ERP create a unified manufacturing data layer enabling real-time visibility across the production floor." },

    { projectSlug: "mainframe-migration", capSlug: "core-banking", uplift: 20, months: 24, desc: "Migrating core banking from mainframe to cloud-native platform reduces per-transaction cost by 80%, enables real-time processing, and eliminates COBOL talent risk." },
    { projectSlug: "mainframe-migration", capSlug: "payment-processing", uplift: 18, months: 18, desc: "Modern payment processing engine handles real-time payments, ISO 20022, and instant settlement — impossible to achieve on legacy mainframe architecture." },
    { projectSlug: "mainframe-migration", capSlug: "actuarial-modeling", uplift: 15, months: 18, desc: "Cloud-based actuarial computing enables 100x more model scenarios with elastic compute, reducing rate filing cycles from months to weeks." },
    { projectSlug: "mainframe-migration", capSlug: "quality-management", uplift: 12, months: 18, desc: "Migrating quality systems from mainframe enables real-time SPC, automated non-conformance tracking, and integration with modern IoT inspection systems." },
    { projectSlug: "mainframe-migration", capSlug: "inventory-optimization", uplift: 14, months: 18, desc: "Real-time inventory visibility replaces batch-processed mainframe data, enabling dynamic reorder points and reducing carrying costs by 20-30%." },
    { projectSlug: "mainframe-migration", capSlug: "supply-chain-retail", uplift: 16, months: 24, desc: "Modern supply chain platform replaces rigid mainframe EDI with real-time supplier collaboration, demand-driven replenishment, and end-to-end visibility." },

    { projectSlug: "data-platform-modernization", capSlug: "data-analytics", uplift: 25, months: 9, desc: "Cloud-native lakehouse architecture replaces siloed data warehouses, enabling self-service analytics adoption from 30% to 80% of business users." },
    { projectSlug: "data-platform-modernization", capSlug: "customer-data-retail", uplift: 22, months: 9, desc: "Unified customer data platform creates 360-degree customer views from fragmented touchpoints, enabling real-time personalization and LTV optimization." },
    { projectSlug: "data-platform-modernization", capSlug: "population-health", uplift: 20, months: 12, desc: "Real-time population health analytics identify at-risk cohorts proactively, enabling preventive interventions that reduce hospitalizations by 15-25%." },
    { projectSlug: "data-platform-modernization", capSlug: "data-engineering", uplift: 28, months: 6, desc: "Modern data engineering with streaming pipelines, data contracts, and observability reduces data pipeline failures by 80% and time-to-data from days to minutes." },
    { projectSlug: "data-platform-modernization", capSlug: "product-analytics", uplift: 22, months: 6, desc: "Real-time product analytics with event streaming and experimentation platforms enable data-driven product decisions with 10x faster feedback loops." },
    { projectSlug: "data-platform-modernization", capSlug: "risk-management-bank", uplift: 18, months: 12, desc: "Real-time risk analytics with streaming data replaces T+1 batch risk reporting, enabling intraday risk monitoring and faster response to market events." },
    { projectSlug: "data-platform-modernization", capSlug: "fraud-prevention-bank", uplift: 20, months: 9, desc: "Real-time transaction scoring with streaming analytics reduces fraud detection latency from hours to milliseconds, preventing losses before they occur." },
  ];

  for (const imp of impactData) {
    const c = cap(imp.capSlug);
    await db.insert(projectCapabilityImpactsTable).values({
      projectId: projectMap[imp.projectSlug],
      capabilityId: c.id,
      maturityUplift: imp.uplift,
      timeToImpactMonths: imp.months,
      impactDescription: imp.desc,
    });
  }

  console.log(`Seeded ${impactData.length} capability impacts`);

  const insightsData: Array<{ projectSlug: string; role: string; title: string; desc: string; metrics: string; framework: string }> = [
    { projectSlug: "enterprise-ai-platform", role: "CFO", title: "AI Investment ROI & Value Realization", desc: "The CFO must quantify AI's financial impact beyond cost savings — including revenue acceleration from better risk selection, reduced leakage from fraud prevention, and competitive moats from data-driven pricing. Without clear financial attribution models, AI investments risk becoming unaccountable R&D spend.", metrics: "Model ROI per use case | AI-driven revenue attribution | Cost per prediction | Time to value per model deployment | Total AI platform TCO vs. point solution costs", framework: "Evaluate each AI use case on a 2x2 matrix of financial impact (revenue/cost) vs. implementation readiness. Prioritize use cases with >3x ROI within 12 months. Require business sponsors to own P&L impact, not just IT." },
    { projectSlug: "enterprise-ai-platform", role: "CEO", title: "AI as Strategic Competitive Advantage", desc: "AI is no longer a technology decision — it's a strategic positioning decision. CEOs who treat AI as an IT project lose to competitors who embed AI into their business model. The question isn't whether to invest in AI, but whether your AI capabilities will define or disrupt your market position.", metrics: "AI-driven market share shifts | New AI-enabled products/revenue | Speed to market vs. competitors | Customer experience differentiation score", framework: "Define 2-3 'AI moonshots' that would fundamentally change competitive dynamics. Ensure AI strategy is a board-level agenda item. Evaluate strategic partnerships vs. build for each AI capability." },
    { projectSlug: "enterprise-ai-platform", role: "CIO", title: "AI Platform Architecture & Governance", desc: "The CIO must build a scalable AI platform that avoids the proliferation of siloed models while enabling rapid experimentation. Key risks include data quality debt, model governance gaps, and infrastructure that can't scale from proof-of-concept to production.", metrics: "Model deployment velocity | Model monitoring coverage | Data quality scores | AI infrastructure utilization | Models in production vs. POC ratio", framework: "Establish an AI Center of Excellence with clear model lifecycle governance. Choose platform vs. best-of-breed for core AI infrastructure. Implement model risk management framework before scaling production deployments." },

    { projectSlug: "intelligent-process-automation", role: "CFO", title: "Process Cost Optimization & Labor Arbitrage", desc: "IPA fundamentally changes the cost structure of operations-heavy processes. The CFO must model the transition from variable labor costs to fixed technology costs, including the impact on headcount, redeployment strategies, and the freed capacity for higher-value work.", metrics: "Cost per transaction before/after | FTE hours redirected to value-add | Process error rate reduction | Straight-through processing rate | Payback period per automated process", framework: "Map top 20 processes by cost × volume × error rate. Automate in waves: quick wins (RPA) in months 1-3, intelligent automation in months 4-9, end-to-end orchestration in months 9-12. Measure labor redeployment, not just elimination." },
    { projectSlug: "intelligent-process-automation", role: "CEO", title: "Operational Agility & Customer Speed", desc: "IPA isn't about cutting costs — it's about creating operational agility that competitors can't match. When claims are processed in minutes instead of days, when loans are approved in hours instead of weeks, the customer experience becomes a strategic weapon.", metrics: "End-to-end process cycle time | Customer effort score | Operational scalability ratio | Time to handle volume spikes", framework: "Identify the 3 customer-facing processes where speed creates the most competitive advantage. Set aggressive targets: 10x speed improvement. Use IPA as the foundation for digital-first customer experiences." },
    { projectSlug: "intelligent-process-automation", role: "CIO", title: "Automation Architecture & Integration", desc: "The CIO must prevent 'RPA sprawl' — hundreds of brittle bots that become tomorrow's technical debt. Build an automation platform with proper governance, integration patterns, and a progression path from simple RPA to AI-augmented process orchestration.", metrics: "Bot reliability/uptime | Integration complexity score | Automation coverage % | Bot maintenance hours | Exception handling automation rate", framework: "Establish automation CoE with reusable component library. Evaluate process mining before automating. Build API-first integrations instead of screen-scraping wherever possible. Plan for bot lifecycle management." },

    { projectSlug: "cloud-native-modernization", role: "CFO", title: "Infrastructure Economics & CapEx-to-OpEx Shift", desc: "Cloud-native modernization shifts spending from capital-intensive infrastructure to consumption-based pricing. The CFO must model the financial transition, including cloud cost optimization, reserved capacity planning, and the true total cost of ownership including migration spend.", metrics: "Infrastructure cost per transaction | CapEx-to-OpEx ratio shift | Cloud unit economics | Migration cost vs. 5-year TCO savings | Cloud waste/optimization rate", framework: "Build a 5-year financial model comparing current state TCO vs. cloud-native. Include migration costs, training, and temporary dual-running. Implement FinOps practice from day one. Set cloud cost guardrails at team level." },
    { projectSlug: "cloud-native-modernization", role: "CEO", title: "Digital Speed as Market Differentiator", desc: "Cloud-native isn't about infrastructure — it's about the speed at which the organization can respond to market opportunities. Companies deploying daily vs. quarterly have a fundamental strategic advantage in testing new products, entering markets, and responding to competitive threats.", metrics: "Deployment frequency | Time from idea to customer | Market response time | Feature experiment velocity | Digital revenue growth rate", framework: "Reframe cloud-native as a business agility investment, not an IT infrastructure project. Set executive-level speed targets. Align modernization priorities with strategic growth initiatives, not just technical debt." },
    { projectSlug: "cloud-native-modernization", role: "CIO", title: "Architecture Transformation & Team Enablement", desc: "The CIO owns the most complex transformation in the organization — moving from decades of monolithic architecture to cloud-native without disrupting operations. Success requires simultaneous changes in architecture, team structure, DevOps practices, and security posture.", metrics: "Application modernization velocity | Team deployment autonomy | MTTR improvement | Service reliability (SLOs) | Developer productivity metrics", framework: "Use the Strangler Fig pattern for incremental migration. Invest in platform engineering team first. Adopt 'you build it, you run it' team models. Prioritize applications by business value × technical risk × migration complexity." },

    { projectSlug: "api-first-platform", role: "CFO", title: "API Monetization & Ecosystem Revenue", desc: "APIs are no longer just integration infrastructure — they're revenue products. The CFO must evaluate API-as-product economics including partner revenue share models, usage-based pricing, and the marginal revenue potential of opening proprietary capabilities to external developers.", metrics: "API revenue per partner | Ecosystem GMV attribution | API development ROI | Integration cost reduction | Partner onboarding cost & velocity", framework: "Classify APIs into internal (cost reduction), partner (revenue share), and public (market expansion). Price based on value delivered, not call volume. Model ecosystem revenue as a portfolio with different maturity curves." },
    { projectSlug: "api-first-platform", role: "CEO", title: "Platform Business Model Evolution", desc: "API-first architecture enables the transition from product company to platform company. The CEO must evaluate whether the organization's core capabilities are more valuable as direct products or as platform services that enable an ecosystem of partners and developers.", metrics: "Ecosystem partner count | Platform-enabled revenue | Time to new partnership | Developer adoption metrics | Competitive platform positioning", framework: "Evaluate which capabilities could become platform services. Identify 'killer APIs' that would attract ecosystem partners. Build API governance that enables innovation while protecting core IP." },
    { projectSlug: "api-first-platform", role: "CIO", title: "API Architecture & Developer Experience", desc: "The CIO must build an API platform that serves both internal and external developers with enterprise-grade security, performance, and developer experience. Poor API design becomes permanent — APIs are contracts that external partners depend on.", metrics: "API response latency p99 | Developer portal NPS | API documentation coverage | API versioning compliance | Security incident rate on API surface", framework: "Adopt API-first design principles before writing code. Build API gateway with rate limiting, authentication, and analytics. Create internal developer portal as the single source of truth. Implement API versioning strategy from day one." },

    { projectSlug: "mainframe-migration", role: "CFO", title: "Legacy Cost Escalation & Migration Economics", desc: "Mainframe costs are a ticking time bomb — 5-8% annual increases with diminishing talent supply drives labor costs up 10-15% per year. The CFO must model the crossover point where migration cost is less than continued mainframe operation, factoring in risk-adjusted scenarios.", metrics: "Current mainframe TCO (MIPS + talent + maintenance) | Annual cost escalation rate | Migration investment vs. 5-year savings | Risk-adjusted NPV of migration | Parallel run costs", framework: "Build scenario models: (A) do nothing 5-year cost, (B) phased migration, (C) big-bang migration. Include talent risk premium — COBOL developer costs are rising 10-15% annually. Set migration investment as % of avoided future costs." },
    { projectSlug: "mainframe-migration", role: "CEO", title: "Strategic Risk of Legacy Dependency", desc: "Mainframe dependency is a strategic risk, not just a technology problem. It constrains the speed of digital transformation, limits partnership and acquisition integration, and creates existential risk as the COBOL talent pool approaches retirement. Every quarter of delay increases the risk and cost.", metrics: "% of revenue processed on mainframe | Digital initiative blockers from mainframe | COBOL developer age demographics | Competitor modernization status | Integration capability gaps", framework: "Frame mainframe migration as risk management, not cost optimization. Quantify the strategic opportunity cost — what products, partnerships, and markets are inaccessible due to mainframe constraints. Set board-level timeline with quarterly milestones." },
    { projectSlug: "mainframe-migration", role: "CIO", title: "Migration Execution & Business Continuity", desc: "Mainframe migration is the highest-risk, highest-stakes program in the CIO's portfolio. A single data integrity issue can create regulatory, financial, and reputational catastrophe. The CIO must balance speed with absolute reliability through parallel runs, incremental cutover, and comprehensive testing.", metrics: "Data migration accuracy (target: 100%) | Transaction reconciliation variance | Cutover downtime hours | Defect escape rate | Parallel run duration & cost", framework: "Never attempt big-bang migration. Use strangler pattern with workload-by-workload migration. Establish 'zero tolerance' data integrity standards. Build automated regression testing before migration begins. Plan for 3-6 month parallel run per major workload." },

    { projectSlug: "data-platform-modernization", role: "CFO", title: "Data as a Financial Asset", desc: "Data is either a cost or an asset — the CFO determines which. A modern data platform turns data from a storage cost into a revenue driver through better pricing, risk selection, customer retention, and operational optimization. The key is measuring data's financial contribution.", metrics: "Revenue attributed to data-driven decisions | Data platform TCO vs. value generated | Self-service adoption savings | Data quality cost of poor quality | Time-to-insight financial impact", framework: "Assign financial value to key data products (customer 360, risk models, etc.). Measure data platform ROI as improved decision quality × decision volume. Compare data platform investment against the cost of wrong decisions made without data." },
    { projectSlug: "data-platform-modernization", role: "CEO", title: "Data-Driven Culture & Decision Making", desc: "The CEO sets the tone for whether the organization makes decisions based on data or intuition. A modern data platform is necessary but not sufficient — it must be paired with a cultural shift where every executive is expected to ground decisions in data and every team has access to the insights they need.", metrics: "Data-informed decision rate | Executive dashboard adoption | Experimentation culture metrics | Data literacy scores across organization | Speed of insight-to-action", framework: "Make data literacy a leadership competency. Require data-backed proposals for all major decisions. Celebrate data-driven wins publicly. Fund data democratization — not just data infrastructure." },
    { projectSlug: "data-platform-modernization", role: "CIO", title: "Data Architecture & Governance at Scale", desc: "The CIO must build a data platform that scales from current needs to AI/ML workloads while maintaining data quality, security, and compliance. The biggest risk isn't technology choice — it's data governance debt that makes the platform untrustworthy.", metrics: "Data pipeline reliability | Data freshness SLAs | Data quality scores by domain | Self-service analytics adoption | Data governance compliance rate", framework: "Adopt data mesh principles — domain ownership with federated governance. Build data contracts before building pipelines. Implement data quality monitoring as a first-class concern. Choose lakehouse architecture for flexibility across analytics and ML workloads." },
  ];

  for (const ins of insightsData) {
    await db.insert(projectExecutiveInsightsTable).values({
      projectId: projectMap[ins.projectSlug],
      role: ins.role,
      agendaTitle: ins.title,
      agendaDescription: ins.desc,
      keyMetrics: ins.metrics,
      decisionFramework: ins.framework,
    });
  }

  console.log(`Seeded ${insightsData.length} executive insights`);

  const risksData: Array<{ projectSlug: string; category: string; severity: string; desc: string; consequence: string; mitigation: string }> = [
    { projectSlug: "enterprise-ai-platform", category: "Competitive", severity: "critical", desc: "Competitors with mature AI capabilities are already achieving 15-25% advantages in pricing accuracy, fraud detection, and customer personalization.", consequence: "Without AI, pricing becomes a guessing game against data-driven competitors. Market share erodes 2-5% annually as AI-enabled competitors offer better prices to good risks and identify fraud faster.", mitigation: "Begin with 2-3 high-impact AI use cases that directly affect P&L. Partner with AI specialists for fast initial deployment while building internal capability." },
    { projectSlug: "enterprise-ai-platform", category: "Talent", severity: "high", desc: "AI/ML talent is scarce and expensive. Organizations without an AI platform lose candidates to companies that offer modern tooling and interesting problems.", consequence: "Inability to attract AI talent creates a vicious cycle — no platform means no talent, no talent means no AI capability, no AI capability means competitive decline.", mitigation: "Invest in AI platform infrastructure before hiring data scientists. Modern tooling is the #1 factor AI talent evaluates when choosing employers." },
    { projectSlug: "enterprise-ai-platform", category: "Regulatory", severity: "high", desc: "AI regulations (EU AI Act, state-level algorithmic fairness laws) are accelerating. Organizations without AI governance frameworks face compliance risk.", consequence: "Ungovern AI deployments risk regulatory fines, reputational damage, and forced shutdown of AI-dependent processes. Retroactive governance is 5-10x more expensive.", mitigation: "Build AI governance (bias testing, explainability, audit trails) into the platform from day one. Treat governance as a feature, not an afterthought." },

    { projectSlug: "intelligent-process-automation", category: "Operational", severity: "high", desc: "Manual processes create bottlenecks during volume spikes, leading to service degradation, compliance delays, and customer dissatisfaction.", consequence: "Organizations relying on manual processes face 3-5x higher cost during volume spikes and cannot scale operations without proportional headcount increases.", mitigation: "Identify top 5 highest-volume, most-variable processes. Implement IPA for these first to create elastic capacity without headcount dependency." },
    { projectSlug: "intelligent-process-automation", category: "Competitive", severity: "medium", desc: "Competitors automating customer-facing processes deliver faster turnaround times, setting new customer expectations for the entire industry.", consequence: "Customer expectations reset around automated competitors' speed. Manual processes that once seemed acceptable become competitive liabilities within 12-18 months.", mitigation: "Prioritize automation of customer-facing processes first. Even partial automation (auto-triage, auto-acknowledge) can dramatically improve perceived speed." },
    { projectSlug: "intelligent-process-automation", category: "Quality", severity: "medium", desc: "Manual processes have inherent error rates of 2-5%, creating compliance risk, rework costs, and customer complaints.", consequence: "Processing errors compound — each error triggers investigation, correction, and potential regulatory reporting. Error costs often exceed the labor cost of the original process.", mitigation: "Implement automation with built-in validation and exception handling. Use process mining to identify highest-error processes for priority automation." },

    { projectSlug: "cloud-native-modernization", category: "Agility", severity: "critical", desc: "Monolithic applications take weeks-to-months for changes, while competitors on cloud-native architecture deploy daily. This creates an insurmountable speed gap.", consequence: "Inability to respond to market changes in real-time. New product launches take 6-12 months while cloud-native competitors launch in weeks. Every delayed feature is lost revenue.", mitigation: "Don't try to modernize everything at once. Start with customer-facing applications with the highest business impact. Use strangler pattern for incremental migration." },
    { projectSlug: "cloud-native-modernization", category: "Resilience", severity: "high", desc: "Monolithic applications create single points of failure. An outage in one component takes down the entire application, affecting all customers.", consequence: "Average downtime cost for financial services: $5,600 per minute. Monolithic outages last 4-8 hours on average. A single major outage can cost $1-5M in direct costs and immeasurable brand damage.", mitigation: "Implement circuit breakers and bulkheads as interim measures. Prioritize decomposition of the most failure-prone and highest-impact components first." },
    { projectSlug: "cloud-native-modernization", category: "Cost", severity: "high", desc: "Legacy infrastructure costs grow 5-10% annually while cloud-native alternatives offer 30-50% lower TCO with elastic scaling.", consequence: "Infrastructure costs consume an increasing share of IT budget, crowding out innovation investment. The longer the delay, the larger the migration cost when it eventually becomes unavoidable.", mitigation: "Build a FinOps practice early. Use cloud-native for all new workloads immediately while planning legacy migration. Track and report infrastructure cost per transaction as a leadership metric." },

    { projectSlug: "api-first-platform", category: "Revenue", severity: "high", desc: "API-enabled competitors create new revenue channels through partnerships, embedded products, and ecosystem monetization that are impossible without an API platform.", consequence: "Missing the platform economy window. Once competitors establish API ecosystems with partner networks, switching costs make it extremely difficult to attract the same partners.", mitigation: "Start with 3-5 'anchor APIs' that would be most valuable to partners. Build API platform incrementally — perfection is the enemy of ecosystem momentum." },
    { projectSlug: "api-first-platform", category: "Integration", severity: "medium", desc: "Point-to-point integrations create exponential complexity. Each new partner or channel requires custom development, taking months instead of days.", consequence: "Integration backlog grows faster than delivery capacity. Partners and customers choose competitors who can integrate in days via APIs instead of months via custom projects.", mitigation: "Adopt API-first design for all new integrations immediately. Retroactively expose existing capabilities as APIs starting with highest-demand partner use cases." },
    { projectSlug: "api-first-platform", category: "Innovation", severity: "high", desc: "Without API infrastructure, innovation is bottlenecked by monolithic release cycles and tightly-coupled systems.", consequence: "Innovation velocity drops to the speed of the slowest integrated system. Internal teams spend 60-80% of time on integration rather than building new capabilities.", mitigation: "Decouple systems through APIs to enable independent innovation. Create API sandbox environments where internal teams can prototype without affecting production." },

    { projectSlug: "mainframe-migration", category: "Talent", severity: "critical", desc: "The average COBOL developer is over 55 years old. 75% of mainframe-skilled workforce will retire within 10 years. Replacement talent is nearly non-existent.", consequence: "COBOL developer costs increasing 10-15% annually. Within 5-7 years, organizations face existential risk — critical systems that no available workforce can maintain, modify, or troubleshoot.", mitigation: "Begin knowledge extraction and documentation immediately. Implement automated testing for mainframe applications before migration. Start recruiting modern developers for migration team now." },
    { projectSlug: "mainframe-migration", category: "Strategic", severity: "critical", desc: "Mainframe systems cannot participate in modern digital ecosystems — no APIs, no real-time data, no cloud integration. Every digital initiative is constrained.", consequence: "Every strategic initiative requires a 'mainframe workaround' adding 3-6 months and 40-60% cost premium. Digital transformation becomes impossible without addressing the mainframe foundation.", mitigation: "Map all digital initiatives blocked by mainframe constraints. Quantify the opportunity cost for the board. Establish migration as a multi-year strategic program with dedicated funding." },
    { projectSlug: "mainframe-migration", category: "Financial", severity: "high", desc: "Mainframe licensing, maintenance, and talent costs are increasing 5-8% annually with no path to reduction without migration.", consequence: "Mainframe costs compound to consume 20-40% of total IT budget within 5 years, starving investment in growth capabilities. The cost delta between mainframe and modern alternatives widens every quarter.", mitigation: "Build a 10-year total cost model showing mainframe vs. modern platform. Present to the board as a financial imperative, not a technology decision. Fund migration from projected cost avoidance." },

    { projectSlug: "data-platform-modernization", category: "Decision Quality", severity: "critical", desc: "Legacy data infrastructure delivers insights days or weeks late, based on incomplete data. Decisions are made on intuition rather than evidence.", consequence: "Poor decisions compound across the organization. A 10% improvement in decision quality translates to millions in better pricing, risk selection, and customer retention. Without modern data, this value is permanently lost.", mitigation: "Start with real-time data pipelines for the 3-5 highest-impact decision points. Build data quality monitoring before adding new data sources." },
    { projectSlug: "data-platform-modernization", category: "AI Readiness", severity: "high", desc: "AI/ML initiatives fail without a modern data foundation. 80% of AI project time is spent on data preparation when data infrastructure is inadequate.", consequence: "AI investments underperform by 3-5x without proper data infrastructure. Models trained on stale, incomplete data produce worse predictions than simple heuristics.", mitigation: "Treat data platform modernization as a prerequisite for AI strategy. Build data quality and feature engineering capabilities before investing in model development." },
    { projectSlug: "data-platform-modernization", category: "Compliance", severity: "high", desc: "Fragmented data systems make regulatory compliance reporting manual, error-prone, and expensive. New regulations (GDPR, CCPA, industry-specific) require data lineage and governance.", consequence: "Compliance reporting takes weeks instead of hours. Data lineage gaps create regulatory risk. Each new regulation multiplies manual effort across fragmented systems.", mitigation: "Implement data catalog and lineage tracking as part of platform modernization. Automate compliance reporting from the unified data platform. Build privacy controls into the architecture." },
  ];

  for (const risk of risksData) {
    await db.insert(projectRisksTable).values({
      projectId: projectMap[risk.projectSlug],
      riskCategory: risk.category,
      severity: risk.severity,
      description: risk.desc,
      consequence: risk.consequence,
      mitigationPath: risk.mitigation,
    });
  }

  console.log(`Seeded ${risksData.length} project risks`);
  console.log("Project seeding complete!");
}

export { seedProjects };
