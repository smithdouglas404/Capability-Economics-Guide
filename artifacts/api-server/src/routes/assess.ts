import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { capabilityAssessmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

type AnthropicClient = Awaited<typeof import("@workspace/integrations-anthropic-ai")>["anthropic"];
let anthropicClient: AnthropicClient | null = null;
async function getAnthropic(): Promise<AnthropicClient | null> {
  if (!anthropicClient) {
    try {
      const mod = await import("@workspace/integrations-anthropic-ai");
      anthropicClient = mod.anthropic;
    } catch (e) {
      console.warn("Anthropic integration not available:", (e as Error).message);
      return null;
    }
  }
  return anthropicClient;
}

const router: IRouter = Router();

async function lookupSecEdgar(sessionId: string, companyName: string, knownCik?: string) {
  if (!companyName?.trim()) return;
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
      if (!resp.ok) {
        await db.update(capabilityAssessmentsTable)
          .set({ secData: { status: "not_found" } })
          .where(eq(capabilityAssessmentsTable.sessionId, sessionId));
        return;
      }
      const data = await resp.json() as { hits?: { hits?: Array<{ _id: string; _source: Record<string, unknown> }> } };
      const hits = data?.hits?.hits;
      if (!hits?.length) {
        await db.update(capabilityAssessmentsTable)
          .set({ secData: { status: "not_found" } })
          .where(eq(capabilityAssessmentsTable.sessionId, sessionId));
        return;
      }
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
                      if (riskIdx !== -1) {
                        riskFactors = stripped.slice(riskIdx, riskIdx + 4000);
                      }
                    }
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}
    }

    await db.update(capabilityAssessmentsTable)
      .set({
        secData: {
          status: "found",
          entityName,
          fileDate,
          period,
          cik,
          financialSummary,
          riskFactors,
        },
      })
      .where(eq(capabilityAssessmentsTable.sessionId, sessionId));
  } catch (err) {
    console.error("SEC lookup error:", err);
    await db.update(capabilityAssessmentsTable)
      .set({ secData: { status: "error" } })
      .where(eq(capabilityAssessmentsTable.sessionId, sessionId));
  }
}

router.post("/assess/start", async (req, res) => {
  const { companyName, companyCik, industry, opportunity, voiceTranscript, documentText, sessionId: existingId } = req.body;
  const sessionId: string = existingId || randomUUID();

  await db.insert(capabilityAssessmentsTable)
    .values({
      sessionId,
      companyName: companyName || null,
      industry: industry || null,
      opportunity: opportunity || null,
      voiceTranscript: voiceTranscript || null,
      documentText: documentText || null,
      status: "clarifying",
    })
    .onConflictDoUpdate({
      target: capabilityAssessmentsTable.sessionId,
      set: {
        companyName: companyName || null,
        industry: industry || null,
        opportunity: opportunity || null,
        voiceTranscript: voiceTranscript || null,
        documentText: documentText || null,
        status: "clarifying",
      },
    });

  if (companyName?.trim()) {
    lookupSecEdgar(sessionId, companyName, companyCik || undefined).catch(console.error);
  }

  const anthropic = await getAnthropic();
  if (!anthropic) {
    res.status(500).json({ error: "AI service unavailable" });
    return;
  }

  const contextParts: string[] = [];
  if (companyName) contextParts.push(`Company: ${companyName}`);
  if (industry) contextParts.push(`Industry: ${industry}`);
  if (opportunity) contextParts.push(`Business opportunity/challenge: ${opportunity}`);
  if (voiceTranscript) contextParts.push(`Voice briefing transcript:\n${voiceTranscript}`);
  if (documentText) contextParts.push(`Supporting document excerpt:\n${documentText.slice(0, 2500)}`);

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

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

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

router.post("/assess/analyze", async (req, res) => {
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
  if (!anthropic) {
    res.status(500).json({ error: "AI service unavailable" });
    return;
  }

  const secData = session.secData as Record<string, unknown> | null;
  const questions = (session.clarifyingQuestions as string[]) || [];

  const qaBlock = questions.length
    ? questions.map((q, i) => `Q: ${q}\nA: ${answers[i] ?? "(not answered)"}`).join("\n\n")
    : "";

  const secBlock = secData?.status === "found"
    ? `\nSEC 10-K FILING DATA (${secData.entityName} | Filed: ${secData.fileDate} | Period: ${secData.period}):
${secData.financialSummary ? `Business Overview:\n${(secData.financialSummary as string).slice(0, 4000)}` : ""}
${secData.riskFactors ? `Risk Factors:\n${(secData.riskFactors as string).slice(0, 2000)}` : ""}
`
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

Produce a comprehensive, OPINIONATED Capability Economics assessment. Be directional — avoid middle-of-the-road scores. If a capability is strong, say so. If it's a gap, say so clearly. Base your assessment on real industry benchmarks, WEF data, and what you know about this industry and business model.

Return ONLY valid JSON with this exact structure:
{
  "executiveSummary": "2-3 sentence sharp executive summary of the capability situation",
  "capabilityMap": [
    {
      "capability": "Name of specific capability",
      "category": "Technology | Human Capital | Operations | Innovation | Customer | Financial | Risk",
      "wefAlignment": "WEF framework reference (e.g. 'GCI 4.0 Pillar 12: Innovation capability' or 'Future of Jobs: Technology skills cluster')",
      "currentMaturity": 3,
      "strategicImportance": 5,
      "action": "INVEST",
      "timeHorizon": "NOW",
      "gap": true,
      "gapSeverity": "CRITICAL"
    }
  ],
  "gaps": [
    {
      "capability": "Capability name",
      "exposure": "Specific business risk if this gap is not addressed — quantify where possible",
      "recommendation": "Concrete near-term action with expected outcome",
      "urgency": "IMMEDIATE"
    }
  ],
  "radarData": [
    {
      "axis": "Technology & AI",
      "invest": 80,
      "hold": 45,
      "divest": 15,
      "emerging": 60
    },
    {
      "axis": "Human Capital",
      "invest": 70,
      "hold": 50,
      "divest": 20,
      "emerging": 40
    },
    {
      "axis": "Operations",
      "invest": 55,
      "hold": 65,
      "divest": 30,
      "emerging": 35
    },
    {
      "axis": "Innovation",
      "invest": 75,
      "hold": 40,
      "divest": 10,
      "emerging": 80
    },
    {
      "axis": "Customer",
      "invest": 65,
      "hold": 55,
      "divest": 25,
      "emerging": 50
    },
    {
      "axis": "Financial",
      "invest": 60,
      "hold": 70,
      "divest": 35,
      "emerging": 30
    },
    {
      "axis": "Risk & Resilience",
      "invest": 50,
      "hold": 60,
      "divest": 20,
      "emerging": 45
    }
  ],
  "topRecommendations": [
    {
      "title": "Action title",
      "rationale": "Why this matters now — reference WEF data or industry benchmarks",
      "impact": "Expected business impact if executed",
      "wefReference": "Specific WEF report, index, or finding"
    }
  ],
  "secInsights": ${secData?.status === "found" ? `{
    "summary": "2-3 sentence interpretation of 10-K through a capability economics lens",
    "capabilityImplications": ["Implication 1", "Implication 2", "Implication 3"]
  }` : "null"},
  "confidenceScore": 72,
  "confidenceFactors": {
    "inputRichness": 65,
    "industryDataQuality": 80,
    "secDataAvailable": ${secData?.status === "found"},
    "voiceProvided": ${!!session.voiceTranscript},
    "documentProvided": ${!!session.documentText}
  }
}

Rules:
- Include 6-10 capabilities in capabilityMap
- Include 3-5 gaps (only real ones — don't fabricate if there are fewer)
- Include 3-5 top recommendations
- radarData MUST have exactly 7 entries with the axis names shown above
- Confidence score 40-60 for minimal input, 65-80 for good Q&A, 80-95 for SEC data + detailed context
- Be specific to this company/industry — not generic platitudes`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "{}";
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

  await db.update(capabilityAssessmentsTable)
    .set({ analysisResult: analysis, confidenceScore, status: "complete" })
    .where(eq(capabilityAssessmentsTable.sessionId, sessionId));

  res.json({ analysis });
});

router.get("/assess/:sessionId", async (req, res) => {
  const rows = await db.select()
    .from(capabilityAssessmentsTable)
    .where(eq(capabilityAssessmentsTable.sessionId, req.params.sessionId))
    .limit(1);

  if (!rows.length) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(rows[0]);
});

export default router;
