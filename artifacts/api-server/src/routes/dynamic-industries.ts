import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  capabilityThresholdsTable,
  technologyProjectsTable,
  projectCapabilityImpactsTable,
  dataSourcesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { runEnrichmentGraph } from "../services/enrichment/graph";
import { requireAdmin } from "../middlewares/requireAdmin";
import { runIndustryBootstrap } from "../services/workflows";
import { generateObject } from "ai";
import { sonnet } from "../services/workflows/models";

const CapabilitySchema = z.object({
  name: z.string().min(2).max(40),
  slug: z.string().min(2).max(60),
  description: z.string(),
  traditionalView: z.string(),
  economicView: z.string(),
  benchmarkScore: z.number().int().min(30).max(85),
  greenMin: z.number().int().min(0).max(100),
  yellowMin: z.number().int().min(0).max(100),
  redMax: z.number().int().min(0).max(100),
});
const CapabilitiesSchema = z.object({ capabilities: z.array(CapabilitySchema).min(6).max(8) });

const ProjectSchema = z.object({
  name: z.string(),
  slug: z.string(),
  category: z.enum(["Modernization", "AI", "Data", "Customer", "Risk", "Operations"]),
  description: z.string(),
  businessCase: z.string(),
  typicalTimeline: z.string(),
  investmentRange: z.string(),
  complexityLevel: z.enum(["low", "medium", "high"]),
  icon: z.string(),
  capabilityImpacts: z.array(z.object({
    capabilityId: z.number().int(),
    maturityUplift: z.number().int().min(5).max(30),
    timeToImpactMonths: z.number().int().min(3).max(24),
    impactDescription: z.string(),
  })).min(2).max(4),
});
const ProjectsSchema = z.object({ projects: z.array(ProjectSchema) });

const router: IRouter = Router();

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// `callGlm` helper retired 2026-05-18 — replaced by `generateObject` from
// the AI SDK at both call sites in this file.

async function callPerplexity(query: string): Promise<{ content: string; citations: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY missing");
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        { role: "system", content: "You are an industry capability research analyst. Provide specific, sourced facts." },
        { role: "user", content: query },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Perplexity ${resp.status}`);
  const data = (await resp.json()) as { choices: Array<{ message: { content: string } }>; citations?: string[] };
  return {
    content: data.choices[0]?.message?.content ?? "",
    citations: data.citations ?? [],
  };
}

// `extractJson` helper retired 2026-05-18 — generateObject validates output
// against the Zod schema directly.

const CreateIndustryBody = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(500).optional(),
  icon: z.string().max(40).optional(),
});

router.post("/industries", requireAdmin, async (req, res) => {
  const parsed = CreateIndustryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, description, icon } = parsed.data;
  const slug = slugify(name);
  if (!slug) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }

  const existing = await db.select().from(industriesTable).where(eq(industriesTable.slug, slug));
  if (existing.length > 0) {
    res.status(409).json({ error: "Industry already exists", industry: existing[0] });
    return;
  }

  // Delegate Perplexity+Sonnet to the industry-bootstrap workflow.
  // Returns a structured payload directly (the workflow's callback writes to
  // research_artifacts AND emits the payload as a workflow output, so we get
  // a synchronous shape we can shove into the existing insert path).
  let research: { content: string; citations: string[] };
  const bootstrapResult = await runIndustryBootstrap({ industryName: name }).catch(() => null);
  if (bootstrapResult?.payload && (bootstrapResult.payload as { capabilities?: unknown }).capabilities) {
    const p = bootstrapResult.payload as { capabilities: Array<Record<string, unknown>>; citations?: Array<{ url: string; title?: string }> };
    research = {
      content: JSON.stringify(p.capabilities),
      citations: (p.citations ?? []).map(c => c.url).filter(Boolean),
    };
  } else {
    try {
      research = await callPerplexity(
        `What are the 6-8 most economically critical capabilities for the ${name} industry in 2025-2026? For each capability, give: a short name (2-4 words), a one-sentence description, the typical maturity benchmark on a 0-100 scale (cite analyst sources), and the traditional vs economic view. Reply with sources.`,
      );
    } catch (err) {
      res.status(502).json({ error: "Research call failed", details: String(err) });
      return;
    }
  }

  const prompt = `Based on the research below, produce a JSON array of 6-8 capabilities for the ${name} industry.

RESEARCH:
${research.content}

Each capability MUST have these fields:
{
  "name": "<2-4 words>",
  "slug": "<lowercase-hyphen>",
  "description": "<1 sentence>",
  "traditionalView": "<1 sentence: how legacy thinking treats it>",
  "economicView": "<1 sentence: how Inflexcvi treats it>",
  "benchmarkScore": <integer 30-85>,
  "greenMin": <integer, threshold for green/healthy, typically benchmarkScore + 10>,
  "yellowMin": <integer, threshold for yellow/warning, typically benchmarkScore - 5>,
  "redMax": <integer, threshold for red/critical, typically yellowMin - 1>
}

Output ONLY the JSON array. No markdown, no commentary.`;

  let caps: z.infer<typeof CapabilitySchema>[];
  try {
    const { object } = await generateObject({
      model: sonnet,
      schema: CapabilitiesSchema,
      system: `You design industry-specific capability sets. Each capability has a benchmarkScore (30-85). greenMin typically benchmarkScore + 10; yellowMin benchmarkScore - 5; redMax yellowMin - 1. Slugs are kebab-case.`,
      prompt: `Industry: ${name}\n\nResearch:\n${research.content}\n\nProduce 6-8 capabilities for this industry.`,
      temperature: 0.2,
      maxTokens: 6000,
    });
    caps = object.capabilities;
  } catch (err) {
    res.status(502).json({ error: "LLM synthesis failed", details: String(err) });
    return;
  }

  const [industry] = await db
    .insert(industriesTable)
    .values({
      name,
      slug,
      description: description ?? `${name} industry capability profile.`,
      icon: icon ?? "Building2",
    })
    .returning();

  const sourceIds: number[] = [];
  for (const c of research.citations) {
    try {
      const u = new URL(c);
      const [src] = await db
        .insert(dataSourcesTable)
        .values({
          title: `Industry research: ${name}`,
          url: c,
          publisher: u.hostname,
          accessedDate: new Date(),
          sourceType: "article",
        })
        .onConflictDoNothing({ target: dataSourcesTable.url })
        .returning();
      if (src) sourceIds.push(src.id);
    } catch {
      /* skip */
    }
  }

  let capabilityCount = 0;
  for (const c of caps) {
    try {
      const [cap] = await db
        .insert(capabilitiesTable)
        .values({
          industryId: industry.id,
          name: c.name,
          slug: slugify(c.slug || c.name),
          description: c.description,
          traditionalView: c.traditionalView,
          economicView: c.economicView,
          benchmarkScore: Math.max(0, Math.min(100, c.benchmarkScore)),
          sourceIds,
          reviewStatus: "pending_review",
          submittedBy: "discovery_agent",
        })
        .returning();
      // Fire-and-forget — enrichment agent runs the full classify → value-chain
      // → companies → alpha → detail flow for this single new cap. Industry
      // creation HTTP returns immediately; agent finishes ~5–7 min later.
      void runEnrichmentGraph({
        trigger: "rerun",
        targetCapabilityIds: [cap.id],
        targetIndustryIds: [industry.id],
      }).catch(err => console.error("[dynamic-industries] enrichment agent failed", err));
      // Mirror into Neo4j capability graph (dual-write).
      import("../services/agent/capabilityGraphSync").then((m) =>
        m.mirrorCapability({
          pgId: cap.id,
          slug: cap.slug,
          name: cap.name,
          industryId: cap.industryId,
          parentCapabilityId: cap.parentCapabilityId,
          isLeaf: cap.isLeaf,
          reviewStatus: cap.reviewStatus,
          benchmarkScore: cap.benchmarkScore,
        })
      ).catch(() => {});
      // Fire-and-forget bot event so persona bots can evaluate the new cap.
      import("../services/bots/workflows/triggers").then((m) =>
        m.dispatchBotEvent("capability.added", { capabilityId: cap.id, industrySlug: industry.slug })
      ).catch(() => { /* bots are not critical path */ });
      await db.insert(capabilityThresholdsTable).values({
        capabilityId: cap.id,
        greenMin: Math.max(0, Math.min(100, c.greenMin)),
        yellowMin: Math.max(0, Math.min(100, c.yellowMin)),
        redMax: Math.max(0, Math.min(100, c.redMax)),
        description: `${c.name} maturity thresholds`,
        sourceIds,
      });
      capabilityCount++;
    } catch (err) {
      console.error("Capability insert failed", err);
    }
  }

  res.status(201).json({ industry, capabilityCount, sourcesCount: sourceIds.length });
});

const GenerateProjectsBody = z.object({
  industrySlug: z.string().min(2).max(80),
  count: z.number().int().min(2).max(8).optional(),
});

router.post("/projects/generate", requireAdmin, async (req, res) => {
  const parsed = GenerateProjectsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { industrySlug, count = 4 } = parsed.data;

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.slug, industrySlug));
  if (!industry) {
    res.status(404).json({ error: "Industry not found" });
    return;
  }

  const capabilities = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industry.id));
  if (capabilities.length === 0) {
    res.status(400).json({ error: "Industry has no capabilities — add capabilities first" });
    return;
  }

  const capList = capabilities.map(c => `- id=${c.id} name="${c.name}" benchmark=${c.benchmarkScore}`).join("\n");

  let research: { content: string; citations: string[] };
  try {
    research = await callPerplexity(
      `What are the ${count} most economically impactful technology investment programs for ${industry.name} firms in 2025-2026? For each, describe the business case, typical timeline, investment range, and which operational capabilities it most lifts.`,
    );
  } catch (err) {
    res.status(502).json({ error: "Research call failed", details: String(err) });
    return;
  }

  const prompt = `Based on the research below, produce a JSON array of exactly ${count} technology investment projects for the ${industry.name} industry.

INDUSTRY CAPABILITIES (use these IDs in capabilityImpacts):
${capList}

RESEARCH:
${research.content}

Each project MUST have these fields:
{
  "name": "<3-6 words>",
  "slug": "<lowercase-hyphen>",
  "category": "<one of: Modernization, AI, Data, Customer, Risk, Operations>",
  "description": "<1-2 sentences>",
  "businessCase": "<2-3 sentences with concrete economic rationale>",
  "typicalTimeline": "<e.g. 12-18 months>",
  "investmentRange": "<e.g. $5M-$25M>",
  "complexityLevel": "<low|medium|high>",
  "icon": "<lucide icon name e.g. Zap, Database, Shield>",
  "capabilityImpacts": [
    { "capabilityId": <id from list above>, "maturityUplift": <integer 5-30>, "timeToImpactMonths": <integer 3-24>, "impactDescription": "<1 sentence>" }
  ]
}

Each project MUST impact 2-4 capabilities from the list above.
Output ONLY the JSON array. No markdown, no commentary.`;

  let projects: z.infer<typeof ProjectSchema>[];
  try {
    const { object } = await generateObject({
      model: sonnet,
      schema: ProjectsSchema,
      system: `You produce technology investment projects for an industry. Each project impacts 2-4 capabilities from the supplied list; capabilityImpacts.capabilityId must come from that list. Icon is a lucide icon name (Zap, Database, Shield, etc.).`,
      prompt: `Industry: ${industry.name}\n\nINDUSTRY CAPABILITIES (use these IDs in capabilityImpacts):\n${capList}\n\nRESEARCH:\n${research.content}\n\nProduce exactly ${count} projects.`,
      temperature: 0.2,
      maxTokens: 8000,
    });
    projects = object.projects;
    if (projects.length === 0) throw new Error("Empty project list");
  } catch (err) {
    res.status(502).json({ error: "LLM synthesis failed", details: String(err) });
    return;
  }

  const validCapIds = new Set(capabilities.map(c => c.id));
  const created: Array<{ id: number; name: string; impacts: number }> = [];
  for (const p of projects) {
    try {
      const [proj] = await db
        .insert(technologyProjectsTable)
        .values({
          name: p.name,
          slug: slugify(p.slug || p.name),
          category: p.category,
          description: p.description,
          businessCase: p.businessCase,
          typicalTimeline: p.typicalTimeline,
          investmentRange: p.investmentRange,
          complexityLevel: p.complexityLevel,
          icon: p.icon,
        })
        .returning();
      let impactCount = 0;
      for (const i of p.capabilityImpacts) {
        if (!validCapIds.has(i.capabilityId)) continue;
        await db.insert(projectCapabilityImpactsTable).values({
          projectId: proj.id,
          capabilityId: i.capabilityId,
          maturityUplift: Math.max(0, Math.min(40, i.maturityUplift)),
          timeToImpactMonths: Math.max(1, Math.min(36, i.timeToImpactMonths)),
          impactDescription: i.impactDescription,
        });
        impactCount++;
      }
      created.push({ id: proj.id, name: proj.name, impacts: impactCount });
    } catch (err) {
      console.error("Project insert failed", err);
    }
  }

  res.status(201).json({ industry: industry.slug, created });
});

export default router;
