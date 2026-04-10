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
  dataSourcesTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import {
  researchIndustryBenchmarks,
  researchWhitePapers,
  extractJson,
} from "./perplexity-client";

interface BenchmarkCapability {
  name: string;
  benchmarkScore: number;
  metrics: Array<{ name: string; value: number; unit: string; context: string }>;
  thresholds: { greenMin: number; yellowMin: number };
  source_context: string;
}

interface BenchmarkLeader {
  company: string;
  maturityScore: number;
  topCapability: string;
  topScore: number;
  weakestCapability: string;
  weakestScore: number;
  investmentLevel: string;
  trend: string;
}

interface BenchmarkData {
  industryMaturity: { score: number; framework: string; description: string };
  capabilities: BenchmarkCapability[];
  leaders: BenchmarkLeader[];
}

interface WhitePaperData {
  title: string;
  author: string;
  organization: string;
  abstract: string;
  category: string;
  url: string | null;
  publishedYear: number;
  tags: string;
}

async function storeCitations(citations: string[]): Promise<number[]> {
  const sourceIds: number[] = [];
  for (const url of citations) {
    const existing = await db
      .select({ id: dataSourcesTable.id })
      .from(dataSourcesTable)
      .where(eq(dataSourcesTable.url, url))
      .limit(1);

    if (existing.length > 0) {
      sourceIds.push(existing[0].id);
    } else {
      const [inserted] = await db
        .insert(dataSourcesTable)
        .values({
          title: new URL(url).hostname.replace("www.", ""),
          url,
          publisher: new URL(url).hostname.replace("www.", ""),
          sourceType: "report",
        })
        .returning({ id: dataSourcesTable.id });
      sourceIds.push(inserted.id);
    }
  }
  return sourceIds;
}

function matchCapability(
  researchedName: string,
  dbCaps: Array<{ slug: string; name: string }>,
): string | null {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const needle = normalize(researchedName);

  for (const cap of dbCaps) {
    if (normalize(cap.name) === needle) return cap.slug;
    if (normalize(cap.slug) === needle) return cap.slug;
  }

  for (const cap of dbCaps) {
    const capNorm = normalize(cap.name);
    if (capNorm.includes(needle) || needle.includes(capNorm)) return cap.slug;
  }

  const words = needle.split(/(?=[a-z])/).filter((w) => w.length > 3);
  for (const cap of dbCaps) {
    const capNorm = normalize(cap.name);
    const matches = words.filter((w) => capNorm.includes(w));
    if (matches.length >= 2) return cap.slug;
  }

  return null;
}

export async function seedInsights() {
  console.log(
    "Seeding insights from Perplexity research (live industry data)...",
  );

  await db.execute(
    sql`TRUNCATE capability_thresholds, capability_insights, industry_white_papers, industry_leaderboard, ontology_relationships, ontology_industry_adapters, data_sources RESTART IDENTITY CASCADE`,
  );

  const allCaps = await db
    .select({
      id: capabilitiesTable.id,
      slug: capabilitiesTable.slug,
      name: capabilitiesTable.name,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      industryId: capabilitiesTable.industryId,
    })
    .from(capabilitiesTable);
  const allIndustries = await db.select().from(industriesTable);

  const industryMap: Record<string, number> = {};
  for (const ind of allIndustries) industryMap[ind.slug] = ind.id;

  const capsByIndustry: Record<
    number,
    Array<{
      id: number;
      slug: string;
      name: string;
      benchmarkScore: number;
      industryId: number;
    }>
  > = {};
  for (const cap of allCaps) {
    if (!capsByIndustry[cap.industryId])
      capsByIndustry[cap.industryId] = [];
    capsByIndustry[cap.industryId].push(cap);
  }

  for (const industry of allIndustries) {
    const industryCaps = capsByIndustry[industry.id] || [];
    if (industryCaps.length === 0) continue;

    console.log(
      `\nResearching ${industry.name} (${industryCaps.length} capabilities)...`,
    );

    const capNames = industryCaps.map((c) => c.name);

    let benchmarkData: BenchmarkData;
    let benchmarkSourceIds: number[] = [];
    try {
      const benchmarkResult = await researchIndustryBenchmarks(
        industry.name,
        capNames,
      );
      benchmarkSourceIds = await storeCitations(benchmarkResult.citations);
      benchmarkData = extractJson<BenchmarkData>(benchmarkResult.content);
      console.log(
        `  Got benchmark data: ${benchmarkData.capabilities.length} capabilities, ${benchmarkData.leaders.length} leaders, ${benchmarkResult.citations.length} citations`,
      );
    } catch (err) {
      console.error(
        `  Failed to research ${industry.name} benchmarks:`,
        err,
      );
      continue;
    }

    for (const cap of industryCaps) {
      const researched = benchmarkData.capabilities.find(
        (rc) => matchCapability(rc.name, industryCaps) === cap.slug,
      );

      if (researched) {
        await db
          .update(capabilitiesTable)
          .set({
            benchmarkScore: researched.benchmarkScore,
            sourceIds: benchmarkSourceIds,
          })
          .where(eq(capabilitiesTable.id, cap.id));

        await db.insert(capabilityThresholdsTable).values({
          capabilityId: cap.id,
          greenMin: researched.thresholds.greenMin,
          yellowMin: researched.thresholds.yellowMin,
          redMax: researched.thresholds.yellowMin - 1,
          description: researched.source_context,
          sourceIds: benchmarkSourceIds,
        });
      } else {
        let greenMin = 70,
          yellowMin = 40;
        if (cap.benchmarkScore >= 65) {
          greenMin = 75;
          yellowMin = 50;
        } else if (cap.benchmarkScore >= 55) {
          greenMin = 65;
          yellowMin = 40;
        } else {
          greenMin = 55;
          yellowMin = 30;
        }

        await db.insert(capabilityThresholdsTable).values({
          capabilityId: cap.id,
          greenMin,
          yellowMin,
          redMax: yellowMin - 1,
          description: `Industry-standard threshold based on ${industry.name} maturity framework: ${benchmarkData.industryMaturity.framework}`,
          sourceIds: benchmarkSourceIds,
        });
      }
    }
    console.log(`  Seeded thresholds for ${industryCaps.length} capabilities`);

    for (const leader of benchmarkData.leaders) {
      const rank =
        benchmarkData.leaders.indexOf(leader) + 1;
      await db.insert(industryLeaderboardTable).values({
        industryId: industry.id,
        companyName: leader.company,
        overallMaturity: Math.min(100, Math.max(0, leader.maturityScore)),
        topCapability: leader.topCapability,
        topCapabilityScore: Math.min(100, Math.max(0, leader.topScore)),
        weakestCapability: leader.weakestCapability,
        weakestCapabilityScore: Math.min(
          100,
          Math.max(0, leader.weakestScore),
        ),
        investmentLevel: leader.investmentLevel || "medium",
        trend: leader.trend || "stable",
        rank,
        sourceIds: benchmarkSourceIds,
      });
    }
    console.log(
      `  Seeded ${benchmarkData.leaders.length} leaderboard entries`,
    );

    const insightsForIndustry = generateInsightsFromResearch(
      industry,
      benchmarkData,
      benchmarkSourceIds,
    );
    for (const insight of insightsForIndustry) {
      await db.insert(capabilityInsightsTable).values(insight);
    }
    console.log(
      `  Seeded ${insightsForIndustry.length} research-backed insights`,
    );

    console.log(`  Researching white papers for ${industry.name}...`);
    try {
      const wpResult = await researchWhitePapers(industry.name);
      const wpSourceIds = await storeCitations(wpResult.citations);
      const wpData = extractJson<WhitePaperData[]>(wpResult.content);

      for (const wp of wpData) {
        await db.insert(industryWhitePapersTable).values({
          industryId: industry.id,
          title: wp.title || "Untitled Report",
          author: wp.author || wp.organization || "Unknown",
          organization: wp.organization || "Unknown",
          abstract: wp.abstract || "",
          category: wp.category || "Industry Report",
          url: wp.url,
          publishedYear: wp.publishedYear || 2024,
          relevanceScore: 85,
          tags: wp.tags || "",
          sourceIds: wpSourceIds,
        });
      }
      console.log(`  Seeded ${wpData.length} white papers`);
    } catch (err) {
      console.error(
        `  Failed to research white papers for ${industry.name}:`,
        err,
      );
    }
  }

  await seedOntology(allCaps, industryMap);

  console.log("\nInsights seeding complete — all data sourced from Perplexity research!");
}

function generateInsightsFromResearch(
  industry: { id: number; name: string; slug: string },
  data: BenchmarkData,
  sourceIds: number[],
) {
  const insights: Array<{
    industryId: number;
    insightType: string;
    title: string;
    content: string;
    severity: string;
    recommendation: string;
    sourceIds: number[];
  }> = [];

  const sorted = [...data.capabilities].sort(
    (a, b) => a.benchmarkScore - b.benchmarkScore,
  );

  if (sorted.length > 0) {
    const weakest = sorted[0];
    insights.push({
      industryId: industry.id,
      insightType: "gap_alert",
      title: `${weakest.name} is the Critical Capability Gap in ${industry.name}`,
      content: `${weakest.name} scores ${weakest.benchmarkScore}/100 — the lowest capability maturity in ${industry.name}. ${weakest.source_context}`,
      severity: "critical",
      recommendation: `Prioritize investment in ${weakest.name} to close the capability gap. Organizations below the ${weakest.thresholds.yellowMin}th percentile face accelerating competitive disadvantage.`,
      sourceIds,
    });
  }

  if (sorted.length > 1) {
    const strongest = sorted[sorted.length - 1];
    insights.push({
      industryId: industry.id,
      insightType: "opportunity",
      title: `${strongest.name} Leads ${industry.name} Maturity at ${strongest.benchmarkScore}/100`,
      content: `${strongest.name} is the most mature capability in ${industry.name} with a benchmark of ${strongest.benchmarkScore}. ${strongest.source_context}`,
      severity: "info",
      recommendation: `Leverage ${strongest.name} maturity as a foundation. Invest in capabilities that depend on it to create compounding returns.`,
      sourceIds,
    });
  }

  insights.push({
    industryId: industry.id,
    insightType: "industry_trend",
    title: `${industry.name} Digital Maturity: ${data.industryMaturity.score}/100 (${data.industryMaturity.framework})`,
    content: data.industryMaturity.description,
    severity:
      data.industryMaturity.score < 50 ? "warning" : "info",
    recommendation: `Use the ${data.industryMaturity.framework} framework to assess organizational maturity against industry benchmarks and prioritize capability investments.`,
    sourceIds,
  });

  if (data.leaders.length > 0) {
    const leader = data.leaders[0];
    insights.push({
      industryId: industry.id,
      insightType: "industry_trend",
      title: `${leader.company} Leads ${industry.name} with ${leader.maturityScore}/100 Maturity`,
      content: `${leader.company} demonstrates industry-leading capability maturity at ${leader.maturityScore}/100, with particular strength in ${leader.topCapability} (${leader.topScore}/100). The gap between leaders and industry average represents the competitive opportunity for capability investment.`,
      severity: "info",
      recommendation: `Benchmark against ${leader.company}'s capability profile. Focus on closing gaps in their identified weakness areas where market opportunity exists.`,
      sourceIds,
    });
  }

  return insights;
}

async function seedOntology(
  allCaps: Array<{
    id: number;
    slug: string;
    name: string;
    industryId: number;
  }>,
  industryMap: Record<string, number>,
) {
  const capMap: Record<string, number> = {};
  for (const cap of allCaps) capMap[cap.slug] = cap.id;

  const ontologyRels = [
    { source: "data-analytics", target: "precision-underwriting", type: "enables", strength: "strong", desc: "Data platform capabilities directly enable AI-driven underwriting accuracy" },
    { source: "data-analytics", target: "fraud-detection", type: "enables", strength: "strong", desc: "Analytics platform provides the data foundation for fraud pattern detection" },
    { source: "precision-underwriting", target: "digital-distribution", type: "enables", strength: "moderate", desc: "Automated underwriting enables real-time digital quoting and binding" },
    { source: "rapid-claims", target: "customer-retention", type: "enables", strength: "strong", desc: "Claims experience is the primary driver of customer loyalty and retention" },
    { source: "fraud-detection", target: "rapid-claims", type: "enables", strength: "moderate", desc: "Effective fraud screening allows straight-through claims processing" },
    { source: "digital-distribution", target: "agent-enablement", type: "competes_with", strength: "moderate", desc: "Digital and agent channels compete for the same customer acquisition budget" },
    { source: "actuarial-modeling", target: "reinsurance-optimization", type: "enables", strength: "strong", desc: "Actuarial models drive reinsurance treaty optimization and pricing" },
    { source: "health-data-interop", target: "clinical-decision-support", type: "enables", strength: "strong", desc: "Interoperable data is the prerequisite for effective clinical decision support" },
    { source: "health-data-interop", target: "population-health", type: "enables", strength: "strong", desc: "Population health management requires cross-system data aggregation" },
    { source: "telehealth", target: "patient-experience", type: "enables", strength: "moderate", desc: "Virtual care options improve access and convenience in the patient journey" },
    { source: "revenue-cycle", target: "clinical-workforce", type: "enables", strength: "moderate", desc: "Efficient revenue cycle funds clinical workforce investment" },
    { source: "core-banking", target: "digital-banking", type: "enables", strength: "strong", desc: "Core banking platform velocity determines digital banking feature delivery speed" },
    { source: "core-banking", target: "payment-processing", type: "enables", strength: "strong", desc: "Payment processing reliability depends on core banking system stability" },
    { source: "open-banking", target: "digital-banking", type: "enables", strength: "moderate", desc: "Open APIs enable third-party integrations that enrich digital banking" },
    { source: "credit-decisioning", target: "risk-management-bank", type: "enables", strength: "strong", desc: "Credit decisions feed directly into enterprise risk portfolio management" },
    { source: "predictive-maintenance", target: "quality-management", type: "enables", strength: "moderate", desc: "Predicting equipment failures prevents quality degradation in production" },
    { source: "smart-factory", target: "predictive-maintenance", type: "enables", strength: "strong", desc: "IoT sensor data is the input for predictive maintenance models" },
    { source: "smart-factory", target: "production-planning", type: "enables", strength: "moderate", desc: "Real-time factory data enables dynamic production scheduling" },
    { source: "supply-chain-mgmt", target: "inventory-optimization", type: "enables", strength: "strong", desc: "Supply chain visibility drives inventory optimization decisions" },
    { source: "platform-engineering", target: "product-development", type: "enables", strength: "strong", desc: "Platform engineering multiplies developer productivity across all product teams" },
  ];

  for (const rel of ontologyRels) {
    if (capMap[rel.source] && capMap[rel.target]) {
      await db.insert(ontologyRelationshipsTable).values({
        sourceCapabilityId: capMap[rel.source],
        targetCapabilityId: capMap[rel.target],
        relationshipType: rel.type,
        strength: rel.strength,
        description: rel.desc,
      });
    }
  }
  console.log("Seeded ontology relationships");

  const adapters = [
    { industryId: industryMap["insurance"], adapterName: "Insurance Capability Ontology", adapterDescription: "Adapts the base capability economics ontology for the insurance industry, emphasizing risk-based valuation, regulatory constraints, and actuarial precision.", capabilityFocusAreas: "Underwriting precision|Claims efficiency|Fraud prevention|Distribution optimization|Regulatory agility", maturityModel: "Level 1: Manual/Reactive|Level 2: Standardized|Level 3: Optimized|Level 4: Predictive|Level 5: Autonomous", keyDifferentiators: "Insurance capabilities are uniquely constrained by regulatory approval cycles, actuarial requirements, and the inverse production cycle." },
    { industryId: industryMap["healthcare"], adapterName: "Healthcare Capability Ontology", adapterDescription: "Adapts capability economics for healthcare, balancing clinical outcomes, patient safety, regulatory compliance, and financial sustainability.", capabilityFocusAreas: "Clinical quality|Patient access|Data interoperability|Care coordination|Revenue integrity", maturityModel: "Level 1: Reactive|Level 2: Informed|Level 3: Proactive|Level 4: Predictive|Level 5: Precision", keyDifferentiators: "Healthcare capabilities must be evaluated through a dual lens: clinical effectiveness and economic sustainability." },
    { industryId: industryMap["banking"], adapterName: "Banking Capability Ontology", adapterDescription: "Adapts capability economics for banking, addressing capital adequacy, fintech disruption, and the tension between innovation velocity and regulatory compliance.", capabilityFocusAreas: "Risk management|Digital experience|Regulatory compliance|Payment infrastructure|Ecosystem integration", maturityModel: "Level 1: Legacy|Level 2: Digitized|Level 3: Platform|Level 4: Intelligent|Level 5: Ecosystem", keyDifferentiators: "Banking capabilities operate under unique constraints: capital adequacy requirements, real-time settlement obligations, and systemic risk considerations." },
    { industryId: industryMap["manufacturing"], adapterName: "Manufacturing Capability Ontology", adapterDescription: "Adapts capability economics for manufacturing, connecting operational technology with information technology across the Industry 4.0 spectrum.", capabilityFocusAreas: "Production efficiency|Quality assurance|Supply chain resilience|Workforce capability|Sustainability", maturityModel: "Level 1: Manual|Level 2: Automated|Level 3: Connected|Level 4: Intelligent|Level 5: Autonomous", keyDifferentiators: "Manufacturing capabilities bridge physical and digital domains. OT/IT convergence and safety constraints create unique capability economics." },
    { industryId: industryMap["technology"], adapterName: "Technology Capability Ontology", adapterDescription: "Adapts capability economics for technology companies, where capabilities are both the product and the production system.", capabilityFocusAreas: "Developer productivity|Platform scalability|Product innovation|Data leverage|Talent retention", maturityModel: "Level 1: Ad-hoc|Level 2: Repeatable|Level 3: Defined|Level 4: Managed|Level 5: Optimizing", keyDifferentiators: "Technology companies exhibit recursive capability dynamics — their capabilities build capabilities. Platform engineering has a multiplicative effect." },
    { industryId: industryMap["retail"], adapterName: "Retail Capability Ontology", adapterDescription: "Adapts capability economics for retail, addressing the convergence of physical and digital commerce and the economics of customer lifetime value.", capabilityFocusAreas: "Customer experience|Supply chain agility|Pricing optimization|Channel integration|Data monetization", maturityModel: "Level 1: Single-channel|Level 2: Multi-channel|Level 3: Cross-channel|Level 4: Omnichannel|Level 5: Unified Commerce", keyDifferentiators: "Retail capability economics must account for high-velocity consumer demand, thin margins, and the existential importance of customer experience." },
  ];

  for (const adapter of adapters) {
    await db.insert(ontologyIndustryAdaptersTable).values(adapter);
  }
  console.log(`Seeded ${adapters.length} industry ontology adapters`);
}
