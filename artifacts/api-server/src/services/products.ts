import { db } from "@workspace/db";
import {
  companyProductsTable,
  productCapabilitiesTable,
  companiesTable,
  capabilitiesTable,
} from "@workspace/db/schema";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { perplexityChat } from "./perplexity";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/**
 * List products for a company with their capability mappings.
 * Returns products grouped by their primary capability so the
 * Company X-Ray view can render "products under each capability".
 */
export async function listProductsByCompany(companyId: number) {
  const products = await db.select().from(companyProductsTable)
    .where(eq(companyProductsTable.companyId, companyId))
    .orderBy(companyProductsTable.name);
  if (!products.length) return [];

  const productIds = products.map(p => p.id);
  const mappings = await db.select({
    pc: productCapabilitiesTable,
    cap: capabilitiesTable,
  }).from(productCapabilitiesTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, productCapabilitiesTable.capabilityId))
    .where(inArray(productCapabilitiesTable.productId, productIds));

  const byProduct = new Map<number, Array<{ capabilityId: number; capabilityName: string; weight: number; evidenceNote: string | null }>>();
  for (const m of mappings) {
    const list = byProduct.get(m.pc.productId) ?? [];
    list.push({
      capabilityId: m.cap.id,
      capabilityName: m.cap.name,
      weight: m.pc.weight,
      evidenceNote: m.pc.evidenceNote,
    });
    byProduct.set(m.pc.productId, list);
  }

  return products.map(p => ({
    ...p,
    capabilities: (byProduct.get(p.id) ?? []).sort((a, b) => b.weight - a.weight),
  }));
}

/**
 * List products that contribute to a given capability, ordered by
 * weight descending. Used on the capability detail page to surface
 * "real-world products implementing this capability".
 */
export async function listProductsByCapability(capabilityId: number) {
  const rows = await db.select({
    pc: productCapabilitiesTable,
    product: companyProductsTable,
    company: companiesTable,
  }).from(productCapabilitiesTable)
    .innerJoin(companyProductsTable, eq(companyProductsTable.id, productCapabilitiesTable.productId))
    .innerJoin(companiesTable, eq(companiesTable.id, companyProductsTable.companyId))
    .where(eq(productCapabilitiesTable.capabilityId, capabilityId))
    .orderBy(desc(productCapabilitiesTable.weight));

  return rows.map(r => ({
    productId: r.product.id,
    productName: r.product.name,
    productStatus: r.product.status,
    productCategory: r.product.category,
    websiteUrl: r.product.websiteUrl,
    launchDate: r.product.launchDate,
    weight: r.pc.weight,
    evidenceNote: r.pc.evidenceNote,
    companyId: r.company.id,
    companyName: r.company.name,
    publicTicker: r.company.publicTicker,
  }));
}

export interface UpsertProductInput {
  companyId: number;
  name: string;
  description?: string;
  category?: string | null;
  launchDate?: string | null;
  status?: "active" | "preview" | "deprecated" | "discontinued";
  websiteUrl?: string | null;
  source?: string;
  capabilities: Array<{ capabilityId: number; weight: number; evidenceNote?: string | null }>;
}

export async function upsertProduct(input: UpsertProductInput, productId?: number): Promise<number> {
  const slug = slugify(input.name);
  let id: number;
  if (productId) {
    const r = await db.update(companyProductsTable).set({
      name: input.name,
      slug,
      description: input.description ?? "",
      category: input.category ?? null,
      launchDate: input.launchDate ?? null,
      status: input.status ?? "active",
      websiteUrl: input.websiteUrl ?? null,
      source: input.source ?? "manual",
      updatedAt: new Date(),
    }).where(eq(companyProductsTable.id, productId)).returning({ id: companyProductsTable.id });
    id = r[0].id;
  } else {
    const existing = await db.select().from(companyProductsTable)
      .where(and(eq(companyProductsTable.companyId, input.companyId), eq(companyProductsTable.slug, slug))).limit(1);
    if (existing.length) {
      id = existing[0].id;
      await db.update(companyProductsTable).set({
        name: input.name,
        description: input.description ?? existing[0].description,
        category: input.category ?? existing[0].category,
        launchDate: input.launchDate ?? existing[0].launchDate,
        status: input.status ?? existing[0].status,
        websiteUrl: input.websiteUrl ?? existing[0].websiteUrl,
        source: input.source ?? existing[0].source,
        updatedAt: new Date(),
      }).where(eq(companyProductsTable.id, id));
    } else {
      const r = await db.insert(companyProductsTable).values({
        companyId: input.companyId,
        slug,
        name: input.name,
        description: input.description ?? "",
        category: input.category ?? null,
        launchDate: input.launchDate ?? null,
        status: input.status ?? "active",
        websiteUrl: input.websiteUrl ?? null,
        source: input.source ?? "manual",
      }).returning({ id: companyProductsTable.id });
      id = r[0].id;
    }
  }

  // Replace mappings.
  await db.delete(productCapabilitiesTable).where(eq(productCapabilitiesTable.productId, id));
  for (const m of input.capabilities) {
    await db.insert(productCapabilitiesTable).values({
      productId: id,
      capabilityId: m.capabilityId,
      weight: Math.max(0, Math.min(1, m.weight || 0.5)),
      evidenceNote: m.evidenceNote ?? null,
    }).onConflictDoNothing();
  }
  return id;
}

export async function deleteProduct(productId: number): Promise<void> {
  await db.delete(companyProductsTable).where(eq(companyProductsTable.id, productId));
}

/**
 * Use Perplexity to suggest known products for a capability across the
 * existing companies in its industry. Returns suggestions only — the
 * admin must confirm before persisting via upsertProduct.
 */
export async function researchProductsForCapability(capabilityId: number): Promise<{
  suggestions: Array<{ companyName: string; companyId: number | null; productName: string; description: string; weight: number; evidence: string }>;
  citations: string[];
}> {
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId)).limit(1);
  if (!cap) return { suggestions: [], citations: [] };

  const companies = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable).where(eq(companiesTable.industryId, cap.industryId));
  if (!companies.length) return { suggestions: [], citations: [] };
  const nameToId = new Map(companies.map(c => [c.name.toLowerCase(), c.id]));

  const sysPrompt = "You are a product analyst. Return ONLY a JSON array — no prose, no code fences. Cite real, named products that exist on the public web today.";
  const userPrompt = `For the capability "${cap.name}", list specific named products or SKUs offered by companies in this list:
${companies.slice(0, 30).map(c => `- ${c.name}`).join("\n")}

Return up to 12 entries:
[
  {"company": "<exact name from list>", "product": "<product name>", "description": "<one sentence>", "weight": <0..1 share of product effort tied to this capability>, "evidence": "<why>"}
]
Skip companies you can't tie to a real product for this capability. Do not invent products.`;

  const resp = await perplexityChat({
    model: "sonar",
    messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
    endpoint: "products.research",
    context: { capabilityId, capabilityName: cap.name },
  });
  const content = resp.choices[0]?.message?.content ?? "";
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return { suggestions: [], citations: resp.citations ?? [] };

  let parsed: Array<{ company?: string; product?: string; description?: string; weight?: number; evidence?: string }>;
  try {
    parsed = JSON.parse(cleaned.substring(start, end + 1));
  } catch {
    return { suggestions: [], citations: resp.citations ?? [] };
  }
  const suggestions = parsed
    .filter(s => s.company && s.product)
    .map(s => ({
      companyName: s.company!,
      companyId: nameToId.get(s.company!.toLowerCase()) ?? null,
      productName: s.product!,
      description: s.description ?? "",
      weight: typeof s.weight === "number" ? Math.max(0, Math.min(1, s.weight)) : 0.5,
      evidence: s.evidence ?? "",
    }));
  return { suggestions, citations: resp.citations ?? [] };
}

/**
 * One-shot seed of well-known products across the existing companies.
 * Idempotent (uses unique (companyId, slug)). Skips companies that
 * are not present in the database.
 */
export async function seedKnownProducts(): Promise<{ inserted: number; skipped: number; mappings: number }> {
  // Curated list of well-known products keyed on company name and the
  // capability slugs they primarily contribute to. Covers AI, cloud,
  // CRM, analytics, finance, healthcare, retail, and supply chain.
  const SEED: Array<{ company: string; product: string; description: string; capabilitySlugs: string[]; category?: string; status?: "active" | "preview"; launchDate?: string; websiteUrl?: string }> = [
    // Hyperscalers / GenAI
    { company: "Amazon Web Services", product: "AWS Bedrock", description: "Managed foundation-model API across Anthropic, Meta, Mistral, AI21.", capabilitySlugs: ["generative-ai", "ai-platform", "platform-engineering"], category: "GenAI Platform", launchDate: "2023-09-28", websiteUrl: "https://aws.amazon.com/bedrock" },
    { company: "Amazon Web Services", product: "Amazon SageMaker", description: "End-to-end ML platform for training, tuning, and serving models.", capabilitySlugs: ["ai-platform", "data-analytics", "platform-engineering"], category: "ML Platform", launchDate: "2017-11-29", websiteUrl: "https://aws.amazon.com/sagemaker" },
    { company: "Microsoft", product: "Azure OpenAI Service", description: "Enterprise GPT-4/Sora API with Azure data residency and tenant isolation.", capabilitySlugs: ["generative-ai", "ai-platform"], category: "GenAI Platform", launchDate: "2023-01-16", websiteUrl: "https://azure.microsoft.com/products/ai-services/openai-service" },
    { company: "Microsoft", product: "Microsoft Copilot for Microsoft 365", description: "Productivity copilot embedded in Word, Excel, Outlook, Teams.", capabilitySlugs: ["generative-ai", "developer-experience", "agent-enablement"], category: "Productivity AI", launchDate: "2023-11-01", websiteUrl: "https://www.microsoft.com/microsoft-365/copilot" },
    { company: "Google", product: "Google Cloud Vertex AI", description: "Unified platform for building, deploying, and scaling ML models.", capabilitySlugs: ["ai-platform", "generative-ai"], category: "ML Platform", launchDate: "2021-05-18", websiteUrl: "https://cloud.google.com/vertex-ai" },
    { company: "Google", product: "Gemini API", description: "Multi-modal foundation-model API powering Bard / Gemini Advanced.", capabilitySlugs: ["generative-ai"], category: "GenAI API", launchDate: "2023-12-13", websiteUrl: "https://ai.google.dev/" },
    { company: "OpenAI", product: "GPT-4o API", description: "Frontier multimodal foundation-model API for text/audio/vision.", capabilitySlugs: ["generative-ai"], category: "Foundation Model", launchDate: "2024-05-13", websiteUrl: "https://platform.openai.com" },
    { company: "OpenAI", product: "ChatGPT Enterprise", description: "Enterprise tier of ChatGPT with SSO, encryption, audit log.", capabilitySlugs: ["generative-ai", "agent-enablement"], category: "GenAI Workspace", launchDate: "2023-08-28", websiteUrl: "https://openai.com/enterprise" },
    { company: "Anthropic", product: "Claude API", description: "Constitutional-AI foundation-model API (Sonnet, Opus, Haiku).", capabilitySlugs: ["generative-ai"], category: "Foundation Model", launchDate: "2023-07-11", websiteUrl: "https://www.anthropic.com/api" },
    { company: "NVIDIA", product: "NVIDIA NIM", description: "Containerized inference microservices for foundation models.", capabilitySlugs: ["ai-platform", "generative-ai"], category: "Inference Stack", launchDate: "2024-03-18", websiteUrl: "https://www.nvidia.com/en-us/ai/nim/" },

    // CRM / Salesforce ecosystem
    { company: "Salesforce", product: "Agentforce", description: "Autonomous-agent platform built into the Salesforce Customer 360.", capabilitySlugs: ["agent-enablement", "customer-success", "customer-retention"], category: "Autonomous Agent Platform", launchDate: "2024-09-17", websiteUrl: "https://www.salesforce.com/agentforce" },
    { company: "Salesforce", product: "Sales Cloud", description: "Flagship CRM for sales pipelines and forecasting.", capabilitySlugs: ["customer-retention", "customer-success"], category: "CRM", launchDate: "2000-02-07", websiteUrl: "https://www.salesforce.com/sales" },
    { company: "Salesforce", product: "Data Cloud", description: "Real-time CDP unifying customer profiles across systems.", capabilitySlugs: ["data-analytics", "customer-data", "customer-analytics"], category: "CDP", launchDate: "2022-09-20", websiteUrl: "https://www.salesforce.com/data" },
    { company: "HubSpot", product: "HubSpot Marketing Hub", description: "All-in-one inbound marketing automation for SMB.", capabilitySlugs: ["customer-retention", "customer-success"], category: "Marketing Automation", launchDate: "2010-06-01", websiteUrl: "https://www.hubspot.com/products/marketing" },

    // Data / Analytics
    { company: "Snowflake", product: "Snowflake Cortex", description: "Serverless LLM and ML inference inside the Snowflake warehouse.", capabilitySlugs: ["data-analytics", "generative-ai", "ai-platform"], category: "Warehouse-native AI", launchDate: "2024-03-13", websiteUrl: "https://www.snowflake.com/cortex" },
    { company: "Snowflake", product: "Snowflake Data Cloud", description: "Cloud data warehouse with cross-region data sharing.", capabilitySlugs: ["data-analytics", "customer-data"], category: "Data Warehouse", launchDate: "2014-10-01", websiteUrl: "https://www.snowflake.com" },
    { company: "Databricks", product: "Databricks Lakehouse Platform", description: "Lakehouse architecture unifying data engineering, ML, and BI.", capabilitySlugs: ["data-analytics", "ai-platform"], category: "Lakehouse", launchDate: "2020-05-01", websiteUrl: "https://www.databricks.com" },
    { company: "Databricks", product: "Mosaic AI", description: "Foundation-model training and serving on the lakehouse.", capabilitySlugs: ["ai-platform", "generative-ai"], category: "ML Platform", launchDate: "2023-06-26", websiteUrl: "https://www.databricks.com/product/machine-learning" },
    { company: "Palantir", product: "Palantir AIP", description: "Operational AI platform binding LLMs to enterprise ontology.", capabilitySlugs: ["ai-platform", "generative-ai", "data-analytics"], category: "AI Operations", launchDate: "2023-04-25", websiteUrl: "https://www.palantir.com/platforms/aip" },
    { company: "Palantir", product: "Palantir Foundry", description: "Operational data platform for industrial enterprises.", capabilitySlugs: ["data-analytics", "supply-chain"], category: "Operational Data Platform", launchDate: "2016-04-01", websiteUrl: "https://www.palantir.com/platforms/foundry" },

    // Cybersecurity
    { company: "CrowdStrike", product: "CrowdStrike Falcon Platform", description: "Cloud-native endpoint detection & response with managed threat hunting.", capabilitySlugs: ["fraud", "risk-management", "regulatory"], category: "EDR / XDR", launchDate: "2013-05-01", websiteUrl: "https://www.crowdstrike.com/products" },
    { company: "Palo Alto Networks", product: "Cortex XSIAM", description: "AI-driven SecOps platform consolidating SIEM, SOAR, and XDR.", capabilitySlugs: ["fraud", "risk-management"], category: "SecOps Platform", launchDate: "2022-10-04", websiteUrl: "https://www.paloaltonetworks.com/cortex/cortex-xsiam" },

    // Fintech / Payments
    { company: "Stripe", product: "Stripe Payments", description: "Online payments API with global card-network coverage.", capabilitySlugs: ["digital", "ecommerce"], category: "Payments API", launchDate: "2011-09-29", websiteUrl: "https://stripe.com/payments" },
    { company: "Stripe", product: "Stripe Radar", description: "Machine-learning fraud detection layered on Stripe Payments.", capabilitySlugs: ["fraud", "risk-management"], category: "Fraud / Risk", launchDate: "2016-10-19", websiteUrl: "https://stripe.com/radar" },
    { company: "Plaid", product: "Plaid Auth & Identity", description: "Bank-account verification and identity for fintech onboarding.", capabilitySlugs: ["aml", "regulatory", "compliance"], category: "Identity / Open Banking", launchDate: "2014-02-01", websiteUrl: "https://plaid.com/products/auth" },
    { company: "Block", product: "Square Point of Sale", description: "Point-of-sale and payments stack for SMB merchants.", capabilitySlugs: ["digital", "ecommerce", "omnichannel"], category: "POS", launchDate: "2009-12-01", websiteUrl: "https://squareup.com/us/en/point-of-sale" },

    // Retail / Commerce
    { company: "Shopify", product: "Shopify Plus", description: "Enterprise commerce platform with B2B, headless, and custom checkout.", capabilitySlugs: ["ecommerce", "digital", "omnichannel"], category: "Commerce Platform", launchDate: "2014-02-25", websiteUrl: "https://www.shopify.com/plus" },
    { company: "Shopify", product: "Shop Pay", description: "Accelerated checkout wallet across the Shopify network.", capabilitySlugs: ["ecommerce", "digital"], category: "Checkout / Wallet", launchDate: "2017-04-19", websiteUrl: "https://shop.app" },
    { company: "Amazon", product: "Amazon Marketplace", description: "Third-party seller platform powering >60% of Amazon retail GMV.", capabilitySlugs: ["ecommerce", "supply-chain"], category: "Marketplace", launchDate: "2000-11-01", websiteUrl: "https://sell.amazon.com" },

    // Healthcare
    { company: "Epic Systems", product: "Epic Hyperspace / Hyperdrive", description: "Flagship EHR clinical workspace used at >250M patient records.", capabilitySlugs: ["clinical-workforce", "patient-experience", "telehealth"], category: "EHR", launchDate: "1979-01-01", websiteUrl: "https://www.epic.com" },
    { company: "Epic Systems", product: "MyChart", description: "Patient portal for appointments, messaging, and records.", capabilitySlugs: ["patient-experience", "telehealth"], category: "Patient Portal", launchDate: "2000-01-01", websiteUrl: "https://www.mychart.com" },
    { company: "Veeva Systems", product: "Veeva Vault", description: "Cloud content + data platform for life-sciences regulated content.", capabilitySlugs: ["regulatory", "compliance", "quality-management"], category: "Regulated Content", launchDate: "2011-09-01", websiteUrl: "https://www.veeva.com/products/vault-platform" },
    { company: "Tempus", product: "Tempus One", description: "Generative-AI clinical assistant for oncologists.", capabilitySlugs: ["generative-ai", "clinical-workforce"], category: "Clinical AI Assistant", launchDate: "2024-01-08", websiteUrl: "https://www.tempus.com/tempus-one" },

    // Supply chain / Manufacturing
    { company: "Manhattan Associates", product: "Manhattan Active Warehouse Management", description: "Cloud-native WMS for omnichannel fulfillment.", capabilitySlugs: ["supply-chain", "inventory", "smart-factory"], category: "WMS", launchDate: "2020-01-01", websiteUrl: "https://www.manh.com/products/manhattan-active-warehouse-management" },
    { company: "Siemens", product: "Siemens Xcelerator", description: "Open digital business platform for industrial software & IoT.", capabilitySlugs: ["smart-factory", "digital", "platform-engineering"], category: "Industrial IoT Platform", launchDate: "2022-06-29", websiteUrl: "https://www.siemens.com/xcelerator" },

    // Insurance
    { company: "Lemonade", product: "Lemonade Insurance App", description: "AI-first renters/home/auto policy issuance and claims.", capabilitySlugs: ["digital", "fraud", "risk-management"], category: "Direct-to-Consumer Insurance", launchDate: "2016-09-21", websiteUrl: "https://www.lemonade.com" },

    // Productivity / Collaboration
    { company: "Atlassian", product: "Jira Software", description: "Issue tracking and agile project management for software teams.", capabilitySlugs: ["developer-experience", "platform-engineering"], category: "Project Management", launchDate: "2002-04-01", websiteUrl: "https://www.atlassian.com/software/jira" },
    { company: "GitHub", product: "GitHub Copilot Enterprise", description: "AI pair-programmer with org-wide context and chat.", capabilitySlugs: ["developer-experience", "generative-ai"], category: "AI Dev Tool", launchDate: "2024-02-27", websiteUrl: "https://github.com/features/copilot/copilot-business" },
    { company: "ServiceNow", product: "Now Assist", description: "Generative-AI assistant embedded across the Now Platform.", capabilitySlugs: ["agent-enablement", "generative-ai", "customer-success"], category: "Workflow AI", launchDate: "2023-09-20", websiteUrl: "https://www.servicenow.com/now-platform/now-assist.html" },
    { company: "Workday", product: "Workday HCM", description: "Cloud HR + finance suite for >65% of Fortune 500.", capabilitySlugs: ["workforce", "agent-enablement"], category: "HCM", launchDate: "2006-06-01", websiteUrl: "https://www.workday.com/en-us/products/human-capital-management" },
  ];

  // Index every existing company by lowercase name.
  const allCompanies = await db.select({ id: companiesTable.id, name: companiesTable.name, industryId: companiesTable.industryId }).from(companiesTable);
  const companyByName = new Map<string, { id: number; industryId: number }>();
  for (const c of allCompanies) companyByName.set(c.name.toLowerCase(), { id: c.id, industryId: c.industryId });

  // Pre-load capabilities by industry for slug → id mapping.
  const allCaps = await db.select({ id: capabilitiesTable.id, slug: capabilitiesTable.slug, industryId: capabilitiesTable.industryId }).from(capabilitiesTable);
  const capByIndustrySlug = new Map<string, number>();
  for (const c of allCaps) capByIndustrySlug.set(`${c.industryId}::${c.slug}`, c.id);

  let inserted = 0, skipped = 0, mappings = 0;
  for (const item of SEED) {
    const co = companyByName.get(item.company.toLowerCase());
    if (!co) { skipped++; continue; }

    // Resolve capability ids by slug-substring match within this company's industry.
    const capIds: number[] = [];
    for (const want of item.capabilitySlugs) {
      const exact = capByIndustrySlug.get(`${co.industryId}::${want}`);
      if (exact) { capIds.push(exact); continue; }
      const fuzzy = allCaps.find(c => c.industryId === co.industryId && c.slug.includes(want));
      if (fuzzy) capIds.push(fuzzy.id);
    }
    if (!capIds.length) { skipped++; continue; }

    const evenWeight = Math.round((1 / capIds.length) * 100) / 100;
    const id = await upsertProduct({
      companyId: co.id,
      name: item.product,
      description: item.description,
      category: item.category ?? null,
      launchDate: item.launchDate ?? null,
      status: item.status ?? "active",
      websiteUrl: item.websiteUrl ?? null,
      source: "seed",
      capabilities: capIds.map(cid => ({ capabilityId: cid, weight: evenWeight })),
    });
    if (id) inserted++;
    mappings += capIds.length;
  }
  return { inserted, skipped, mappings };
}
