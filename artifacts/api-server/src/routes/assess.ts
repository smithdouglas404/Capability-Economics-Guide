import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { capabilityAssessmentsTable, CREDIT_COSTS } from "@workspace/db";
import { deductCredits } from "../middlewares/deductCredits";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { randomUUID } from "crypto";

type AnthropicClient = Awaited<typeof import("@workspace/integrations-anthropic-ai")>["anthropic"];
let anthropicClient: AnthropicClient | null = null;
let _resolveModel: ((name: string) => string) | null = null;
async function getAnthropic(): Promise<AnthropicClient> {
  if (!anthropicClient) {
    const mod = await import("@workspace/integrations-anthropic-ai");
    anthropicClient = mod.anthropic;
    _resolveModel = mod.resolveModel;
  }
  return anthropicClient;
}
function rm(name: string): string {
  return _resolveModel ? _resolveModel(name) : name;
}

async function getLetta() {
  try {
    const mod = await import("../services/agent/letta.js");
    return mod;
  } catch {
    return null;
  }
}

const router: IRouter = Router();

async function lookupSecEdgar(sessionId: string, companyName: string, knownCik?: string): Promise<Record<string, unknown>> {
  if (!companyName?.trim()) return { status: "not_found" };
  try {
    let cik = knownCik?.trim() || "";
    let entityName = companyName;
    let fileDate = "";
    let period = "";

    if (!cik) {
      const query = encodeURIComponent(`"${companyName}"`);
      const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=${query}&forms=10-K&dateRange=custom&startdt=2023-01-01`;
      const resp = await fetch(searchUrl, {
        headers: { "User-Agent": "CapabilityEconomics research@capabilityeconomics.ai" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return { status: "not_found" };
      const data = await resp.json() as { hits?: { hits?: Array<{ _id: string; _source: Record<string, unknown> }> } };
      const hits = data?.hits?.hits;
      if (!hits?.length) return { status: "not_found" };
      const hit = hits[0];
      const src = hit._source;
      entityName = (src.entity_name as string) || companyName;
      fileDate = src.file_date as string;
      period = src.period_of_report as string;
      cik = (src.ciks as string[] | undefined)?.[0] ?? "";
    }

    let financialSummary: string | null = null;
    let riskFactors: string | null = null;

    if (cik) {
      try {
        const padded = cik.replace(/^0+/, "").padStart(10, "0");
        const subUrl = `https://data.sec.gov/submissions/CIK${padded}.json`;
        const subResp = await fetch(subUrl, {
          headers: { "User-Agent": "CapabilityEconomics research@capabilityeconomics.ai" },
          signal: AbortSignal.timeout(8000),
        });
        if (subResp.ok) {
          const sub = await subResp.json() as Record<string, unknown>;
          const recentFilings = sub.filings as Record<string, unknown>;
          const recent = recentFilings?.recent as Record<string, unknown>;
          const forms = recent?.form as string[];
          const filingDates = recent?.filingDate as string[];
          const accessions = recent?.accessionNumber as string[];
          if (forms && accessions) {
            const idx = forms.findIndex((f) => f === "10-K");
            if (idx !== -1 && !fileDate) fileDate = filingDates?.[idx] ?? "";
            if (idx !== -1) {
              const accession = accessions[idx].replace(/-/g, "");
              const cleanCik = cik.replace(/^0+/, "");
              const docUrl = `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${accession}/`;
              try {
                const idxResp = await fetch(`${docUrl}${accessions[idx]}-index.htm`, {
                  headers: { "User-Agent": "CapabilityEconomics research@capabilityeconomics.ai" },
                  signal: AbortSignal.timeout(8000),
                });
                if (idxResp.ok) {
                  const html = await idxResp.text();
                  const docMatch = html.match(/href="([^"]+\.htm)"/i);
                  if (docMatch) {
                    const fullDocUrl = `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${accession}/${docMatch[1]}`;
                    const docResp = await fetch(fullDocUrl, {
                      headers: { "User-Agent": "CapabilityEconomics research@capabilityeconomics.ai" },
                      signal: AbortSignal.timeout(12000),
                    });
                    if (docResp.ok) {
                      const text = await docResp.text();
                      const stripped = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
                      financialSummary = stripped.slice(0, 8000);
                      const riskIdx = stripped.toLowerCase().indexOf("risk factor");
                      if (riskIdx !== -1) riskFactors = stripped.slice(riskIdx, riskIdx + 4000);
                    }
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}
    }

    return { status: "found", entityName, fileDate, period, cik, financialSummary, riskFactors };
  } catch {
    return { status: "error" };
  }
}

async function runPrimarySecLookup(sessionId: string, companyName: string, knownCik?: string) {
  const result = await lookupSecEdgar(sessionId, companyName, knownCik);
  await db.update(capabilityAssessmentsTable)
    .set({ secData: result })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));
}

async function runCompetitorSecLookups(sessionId: string, competitors: Array<{ name: string; cik?: string }>) {
  const results: Record<string, unknown> = {};
  await Promise.all(
    competitors.map(async (c) => {
      if (!c.name?.trim()) return;
      const data = await lookupSecEdgar(sessionId, c.name, c.cik);
      results[c.name] = data;
    })
  );
  await db.update(capabilityAssessmentsTable)
    .set({ competitorSecData: results })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));
}

router.post("/assess/start", async (req: Request, res: Response) => {
  const {
    companyName, companyCik, industry, opportunity,
    voiceTranscript, documentText, jobPostingText,
    competitors, sessionId: existingId, quickAssess,
    organizationSessionToken,
  } = req.body as {
    companyName?: string; companyCik?: string; industry?: string; opportunity?: string;
    voiceTranscript?: string; documentText?: string; jobPostingText?: string;
    competitors?: Array<{ name: string; cik?: string }>;
    sessionId?: string; quickAssess?: boolean;
    organizationSessionToken?: string;
  };

  const sessionId: string = existingId || randomUUID();

  await db.insert(capabilityAssessmentsTable)
    .values({
      sessionId,
      organizationSessionToken: organizationSessionToken || null,
      companyName: companyName || null,
      industry: industry || null,
      opportunity: opportunity || null,
      voiceTranscript: voiceTranscript || null,
      documentText: documentText || null,
      jobPostingText: jobPostingText || null,
      competitors: competitors?.filter(c => c.name?.trim()) || null,
      status: "clarifying",
    })
    .onConflictDoUpdate({
      target: capabilityAssessmentsTable.sessionId,
      set: {
        organizationSessionToken: organizationSessionToken || null,
        companyName: companyName || null,
        industry: industry || null,
        opportunity: opportunity || null,
        voiceTranscript: voiceTranscript || null,
        documentText: documentText || null,
        jobPostingText: jobPostingText || null,
        competitors: competitors?.filter(c => c.name?.trim()) || null,
        status: "clarifying",
      },
    });

  if (companyName?.trim()) {
    runPrimarySecLookup(sessionId, companyName, companyCik || undefined).catch(console.error);
  }

  const validCompetitors = (competitors || []).filter(c => c.name?.trim());
  if (validCompetitors.length > 0) {
    runCompetitorSecLookups(sessionId, validCompetitors).catch(console.error);
  }

  if (quickAssess) {
    res.json({ sessionId, questions: [], quickAssess: true });
    return;
  }

  const anthropic = await getAnthropic();

  const contextParts: string[] = [];
  if (companyName) contextParts.push(`Company: ${companyName}`);
  if (industry) contextParts.push(`Industry: ${industry}`);
  if (opportunity) contextParts.push(`Business opportunity/challenge: ${opportunity}`);
  if (voiceTranscript) contextParts.push(`Voice briefing transcript:\n${voiceTranscript}`);
  if (documentText) contextParts.push(`Supporting document excerpt:\n${documentText.slice(0, 2500)}`);
  if (jobPostingText) contextParts.push(`Job posting provided:\n${jobPostingText.slice(0, 1000)}`);
  if (validCompetitors.length > 0) contextParts.push(`Competitors to benchmark against: ${validCompetitors.map(c => c.name).join(", ")}`);

  const prompt = `You are a senior Capability Economics advisor. A client has shared the following context:

${contextParts.join("\n\n")}

Your goal is to generate exactly 2 to 3 targeted clarifying questions that will sharpen the capability assessment with HIGH CONFIDENCE and STRONG DIRECTIONAL SIGNALS.

Requirements for your questions:
- Each question must be specific to what the client shared — not generic
- Questions should force the client to reveal: current capability gaps, budget/ownership constraints, competitive pressure points, or digital transformation maturity
- Avoid questions that produce wishy-washy middle-ground answers
- Frame questions so answers either confirm strong capability OR reveal a clear gap
- Do NOT ask about things already covered in their input

Return ONLY valid JSON in this format, no commentary:
{
  "questions": [
    "First question here",
    "Second question here",
    "Third question here (optional — only include if genuinely needed)"
  ]
}`;

  // GLM 5.1 — strategic interrogation, challenges assumptions, produces sharp gap-revealing questions
  const glmQResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://capabilityeconomics.com",
      "X-Title": "Capability Economics",
    },
    body: JSON.stringify({ model: "anthropic/claude-sonnet-4.6", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });
  const glmQData = await glmQResp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
  if (glmQData.error) throw new Error(`Synthesis error: ${glmQData.error.message}`);
  const response = { content: [{ type: "text" as const, text: glmQData.choices?.[0]?.message?.content ?? "" }] };

  let questions: string[] = [];
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { questions?: string[] };
      questions = parsed.questions ?? [];
    } catch {
      questions = ["What are the top 2 capabilities that differentiate you from your closest competitors today?"];
    }
  }

  await db.update(capabilityAssessmentsTable)
    .set({ clarifyingQuestions: questions })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));

  res.json({ sessionId, questions });
});

router.post("/assess/analyze", deductCredits(CREDIT_COSTS.ASSESSMENT), async (req: Request, res: Response) => {
  const { sessionId, answers } = req.body as { sessionId: string; answers: string[] };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId required" });
    return;
  }

  const rows = await db.select()
    .from(capabilityAssessmentsTable)
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId))
    .limit(1);

  if (!rows.length) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const session = rows[0];

  await db.update(capabilityAssessmentsTable)
    .set({ clarifyingAnswers: answers, status: "analyzing" })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));

  const anthropic = await getAnthropic();

  const secData = session.secData as Record<string, unknown> | null;
  const questions = (session.clarifyingQuestions as string[]) || [];
  const competitors = (session.competitors as Array<{ name: string; cik?: string }>) || [];
  const competitorSecData = (session.competitorSecData as Record<string, Record<string, unknown>>) || {};

  const qaBlock = questions.length
    ? questions.map((q, i) => `Q: ${q}\nA: ${answers[i] ?? "(not answered)"}`).join("\n\n")
    : "";

  const secBlock = secData?.status === "found"
    ? `\nSEC 10-K FILING DATA (${secData.entityName} | Filed: ${secData.fileDate} | Period: ${secData.period}):
${secData.financialSummary ? `Business Overview:\n${(secData.financialSummary as string).slice(0, 3500)}` : ""}
${secData.riskFactors ? `Risk Factors:\n${(secData.riskFactors as string).slice(0, 1500)}` : ""}`
    : "";

  const competitorBlock = competitors.length > 0
    ? `\nCOMPETITOR INTELLIGENCE:\n${competitors.map(c => {
        const cd = competitorSecData[c.name] as Record<string, unknown> | undefined;
        if (cd?.status === "found") {
          return `${c.name} (SEC 10-K data available | Filed: ${cd.fileDate} | Period: ${cd.period}):\n${cd.financialSummary ? String(cd.financialSummary).slice(0, 1500) : "No detail"}`;
        }
        return `${c.name}: No public filing data — benchmark from industry knowledge`;
      }).join("\n\n")}`
    : "";

  const jobPostingBlock = session.jobPostingText
    ? `\nJOB POSTING (parse for capability signal):\n${session.jobPostingText.slice(0, 1200)}`
    : "";

  const prompt = `You are a world-class Capability Economics advisor and strategic analyst, deeply versed in:
- World Economic Forum Global Competitiveness Index 4.0 (12 pillars across 4 domains: Enabling Environment, Human Capital, Markets, Innovation Ecosystem)
- WEF Future of Jobs Report capability clusters
- WEF Human Capital Index categories
- Gartner Strategic Technology Trends
- McKinsey Global Institute capability benchmarking

CLIENT CONTEXT:
Company: ${session.companyName || "Undisclosed"}
Industry: ${session.industry || "Undisclosed"}
Business Opportunity: ${session.opportunity || "General capability assessment"}
${session.voiceTranscript ? `Voice Briefing:\n${session.voiceTranscript}` : ""}
${session.documentText ? `Uploaded Document:\n${session.documentText.slice(0, 3000)}` : ""}

CLARIFYING Q&A:
${qaBlock}
${secBlock}
${competitorBlock}
${jobPostingBlock}

Produce a comprehensive, OPINIONATED Capability Economics assessment. Be directional — avoid middle-of-the-road scores. If a capability is strong, say so. If it's a gap, say so clearly. Base your assessment on real industry benchmarks, WEF data, and what you know about this industry and business model.

Return ONLY valid JSON with this exact structure:
{
  "executiveSummary": "2-3 sentence sharp executive summary of the capability situation",
  "capabilityMap": [
    {
      "capability": "Name of specific capability",
      "category": "Technology | Human Capital | Operations | Innovation | Customer | Financial | Risk",
      "wefAlignment": "WEF framework reference (e.g. 'GCI 4.0 Pillar 12: Innovation capability')",
      "wefSubIndicators": ["Specific sub-indicator 1", "Specific sub-indicator 2"],
      "currentMaturity": 3,
      "strategicImportance": 5,
      "action": "INVEST",
      "timeHorizon": "NOW",
      "gap": true,
      "gapSeverity": "CRITICAL",
      "peerBenchmark": 65
    }
  ],
  "gaps": [
    {
      "capability": "Capability name",
      "exposure": "Specific business risk if this gap is not addressed — quantify where possible",
      "recommendation": "Concrete near-term action with expected outcome",
      "urgency": "IMMEDIATE",
      "competitorAdvantage": "How a named competitor has an edge here (or null)"
    }
  ],
  "radarData": [
    { "axis": "ICT Adoption", "invest": 80, "hold": 45, "divest": 15, "emerging": 60, "peerAverage": 55 },
    { "axis": "Talent & Skills", "invest": 70, "hold": 50, "divest": 20, "emerging": 40, "peerAverage": 60 },
    { "axis": "Business Dynamism", "invest": 55, "hold": 65, "divest": 30, "emerging": 35, "peerAverage": 50 },
    { "axis": "Innovation Capability", "invest": 75, "hold": 40, "divest": 10, "emerging": 80, "peerAverage": 65 },
    { "axis": "Market Agility", "invest": 65, "hold": 55, "divest": 25, "emerging": 50, "peerAverage": 55 },
    { "axis": "Financial System", "invest": 60, "hold": 70, "divest": 35, "emerging": 30, "peerAverage": 60 },
    { "axis": "Institutional Resilience", "invest": 50, "hold": 60, "divest": 20, "emerging": 45, "peerAverage": 52 }
  ],
  "competitorRadarData": ${competitors.length > 0 ? JSON.stringify(competitors.map(c => ({
    name: c.name,
    radarData: [
      { "axis": "ICT Adoption", "score": 60 },
      { "axis": "Talent & Skills", "score": 55 },
      { "axis": "Business Dynamism", "score": 65 },
      { "axis": "Innovation Capability", "score": 50 },
      { "axis": "Market Agility", "score": 60 },
      { "axis": "Financial System", "score": 55 },
      { "axis": "Institutional Resilience", "score": 58 }
    ]
  }))) + " /* fill actual scores from competitor intelligence */" : "null"},
  "topRecommendations": [
    {
      "title": "Action title",
      "rationale": "Why this matters now — reference WEF data or industry benchmarks",
      "impact": "Expected business impact if executed",
      "wefReference": "Specific WEF report, index, or finding"
    }
  ],
  "roadmap": {
    "horizon": "12 months",
    "phases": [
      {
        "label": "Phase 1: Foundation",
        "months": "0-3",
        "theme": "Short theme",
        "initiatives": [
          {
            "title": "Initiative name",
            "description": "What to do and expected outcome",
            "capability": "Related capability from capabilityMap",
            "effort": "LOW | MEDIUM | HIGH",
            "impact": "LOW | MEDIUM | HIGH",
            "owner": "Suggested owner role",
            "wefLink": "WEF framework reference"
          }
        ]
      },
      {
        "label": "Phase 2: Scale",
        "months": "3-6",
        "theme": "Short theme",
        "initiatives": []
      },
      {
        "label": "Phase 3: Lead",
        "months": "6-12",
        "theme": "Short theme",
        "initiatives": []
      }
    ]
  },
  "secInsights": ${secData?.status === "found" ? `{
    "summary": "2-3 sentence interpretation of 10-K through a capability economics lens",
    "capabilityImplications": ["Implication 1", "Implication 2", "Implication 3"],
    "rdSpendSignal": "Interpretation of R&D spend as capability signal",
    "riskCapabilityLinks": ["Risk 1 maps to capability gap X", "Risk 2 maps to capability gap Y"]
  }` : "null"},
  "jobPostingInsights": ${session.jobPostingText ? `{
    "capabilitySignals": ["Capability implied by hiring pattern 1", "Capability implied by hiring pattern 2"],
    "gapIndicators": ["Hiring for X suggests gap in Y"],
    "strategicIntent": "What the hiring pattern reveals about strategic direction"
  }` : "null"},
  "confidenceScore": 72,
  "confidenceFactors": {
    "inputRichness": 65,
    "industryDataQuality": 80,
    "secDataAvailable": ${secData?.status === "found"},
    "competitorDataAvailable": ${Object.keys(competitorSecData).length > 0},
    "voiceProvided": ${!!session.voiceTranscript},
    "documentProvided": ${!!session.documentText},
    "jobPostingProvided": ${!!session.jobPostingText}
  }
}

Rules:
- Include 6-10 capabilities in capabilityMap with wefSubIndicators (2-3 specific sub-indicators per capability)
- Include 3-5 gaps — add competitorAdvantage field (string or null)
- Include 3-5 top recommendations
- radarData MUST have exactly 7 entries with peerAverage (industry benchmark 0-100) for each axis
- competitorRadarData: if competitors provided, score each on all 7 axes based on available intelligence
- roadmap MUST have exactly 3 phases with 2-4 initiatives each — be SPECIFIC and ACTIONABLE
- Confidence score 40-60 for minimal input, 65-80 for good Q&A, 80-95 for SEC data + detailed context
- Be specific to this company/industry — not generic platitudes`;

  // GLM 5.1 — deep reasoning for gap identification, roadmap planning, competitor scoring, SEC interpretation
  const glmAResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://capabilityeconomics.com",
      "X-Title": "Capability Economics",
    },
    body: JSON.stringify({ model: "anthropic/claude-sonnet-4.6", max_tokens: 8192, messages: [{ role: "user", content: prompt }] }),
  });
  const glmAData = await glmAResp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
  if (glmAData.error) throw new Error(`Synthesis error: ${glmAData.error.message}`);

  const rawText = glmAData.choices?.[0]?.message?.content ?? "{}";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);

  let analysis: Record<string, unknown> = {};
  if (jsonMatch) {
    try {
      analysis = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      analysis = { error: "Failed to parse analysis", executiveSummary: "Analysis could not be structured. Please try again." };
    }
  }

  const confidenceScore = (analysis.confidenceScore as number) || 0;
  const roadmap = analysis.roadmap as Record<string, unknown> | null;

  await db.update(capabilityAssessmentsTable)
    .set({ analysisResult: analysis, roadmap: roadmap || null, confidenceScore, status: "complete" })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));

  const lettaMod = await getLetta();
  if (lettaMod) {
    const status = lettaMod.getLettaStatus?.();
    if (status?.connected) {
      const memoryText = [
        `Company: ${session.companyName || "Unknown"} | Industry: ${session.industry || "Unknown"}`,
        `Executive Summary: ${analysis.executiveSummary as string || ""}`,
        `Confidence: ${confidenceScore}/100`,
        `Top gaps: ${((analysis.gaps as Array<{ capability: string }>) || []).slice(0, 3).map((g) => g.capability).join(", ")}`,
        `Top recommendations: ${((analysis.topRecommendations as Array<{ title: string }>) || []).slice(0, 3).map((r) => r.title).join(", ")}`,
      ].join("\n");

      lettaMod.lettaSendMessage(
        `New capability assessment completed. Store for future reference:\n\n${memoryText}`
      ).catch((e: unknown) => console.warn("[Letta] Memory write failed:", e));
    }
  }

  res.json({ analysis, roadmap });
});

function singleParam(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

router.get("/assess/:sessionId", async (req: Request, res: Response) => {
  const sessionId = singleParam(req.params.sessionId);
  const rows = await db.select()
    .from(capabilityAssessmentsTable)
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId))
    .limit(1);

  if (!rows.length) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(rows[0]);
});

router.post("/assess/share", async (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) {
    res.status(400).json({ error: "sessionId required" });
    return;
  }

  const existing = await db.select({ shareToken: capabilityAssessmentsTable.shareToken })
    .from(capabilityAssessmentsTable)
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId))
    .limit(1);

  if (!existing.length) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (existing[0].shareToken) {
    res.json({ shareToken: existing[0].shareToken });
    return;
  }

  const shareToken = randomUUID().replace(/-/g, "").slice(0, 16);
  await db.update(capabilityAssessmentsTable)
    .set({ shareToken })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));

  res.json({ shareToken });
});

router.get("/assess/share/:token", async (req: Request, res: Response) => {
  const token = singleParam(req.params.token);
  const rows = await db.select()
    .from(capabilityAssessmentsTable)
    .where(eq(capabilityAssessmentsTable.shareToken, token))
    .limit(1);

  if (!rows.length) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  res.json(rows[0]);
});

router.get("/assess", async (req: Request, res: Response) => {
  const orgToken = (req.query.orgToken as string)?.trim();

  if (!orgToken) {
    res.json([]);
    return;
  }

  const rows = await db.select({
    sessionId: capabilityAssessmentsTable.sessionId,
    shareToken: capabilityAssessmentsTable.shareToken,
    companyName: capabilityAssessmentsTable.companyName,
    industry: capabilityAssessmentsTable.industry,
    opportunity: capabilityAssessmentsTable.opportunity,
    confidenceScore: capabilityAssessmentsTable.confidenceScore,
    status: capabilityAssessmentsTable.status,
    createdAt: capabilityAssessmentsTable.createdAt,
  })
    .from(capabilityAssessmentsTable)
    .where(eq(capabilityAssessmentsTable.organizationSessionToken, orgToken))
    .orderBy(desc(capabilityAssessmentsTable.createdAt))
    .limit(20);

  res.json(rows);
});

router.patch("/assess/:sessionId", async (req: Request, res: Response) => {
  const sessionId = singleParam(req.params.sessionId);
  const {
    companyName, companyCik, industry, opportunity,
    voiceTranscript, documentText, jobPostingText, competitors,
  } = req.body as {
    companyName?: string; companyCik?: string; industry?: string; opportunity?: string;
    voiceTranscript?: string; documentText?: string; jobPostingText?: string;
    competitors?: Array<{ name: string; cik?: string }>;
  };

  const existing = await db.select({ sessionId: capabilityAssessmentsTable.sessionId, organizationSessionToken: capabilityAssessmentsTable.organizationSessionToken })
    .from(capabilityAssessmentsTable)
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId))
    .limit(1);

  if (!existing.length) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }

  await db.update(capabilityAssessmentsTable)
    .set({
      companyName: companyName || null,
      industry: industry || null,
      opportunity: opportunity || null,
      voiceTranscript: voiceTranscript || null,
      documentText: documentText || null,
      jobPostingText: jobPostingText || null,
      competitors: competitors?.filter(c => c.name?.trim()) || null,
      clarifyingQuestions: null,
      clarifyingAnswers: null,
      analysisResult: null,
      roadmap: null,
      peerBenchmark: null,
      secData: null,
      competitorSecData: null,
      confidenceScore: null,
      status: "pending",
      updatedAt: new Date(),
    })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));

  if (companyName?.trim()) {
    runPrimarySecLookup(sessionId, companyName, companyCik || undefined).catch(console.error);
  }

  res.json({ sessionId, status: "pending" });
});

export default router;
