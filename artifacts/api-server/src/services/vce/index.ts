import { db } from "@workspace/db";
import {
  vceAssessmentsTable,
  vceQuestionsTable,
  vceResearchItemsTable,
  industriesTable,
} from "@workspace/db";
import { eq, asc, and } from "drizzle-orm";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

async function callGLM(prompt: string, maxTokens = 4096, timeoutMs = 180_000): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "z-ai/glm-5.1",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`GLM ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

async function perplexityResearch(query: string): Promise<{ content: string; sources: { url: string; title: string }[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { content: "", sources: [] };
  try {
    const resp = await fetch(PERPLEXITY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "You are a senior management consulting research analyst. Provide concise, factual research with specific numbers, benchmarks, dates and named real-world examples from 2023-2026 data. Cite sources." },
          { role: "user", content: query },
        ],
      }),
    });
    if (!resp.ok) return { content: "", sources: [] };
    const data = await resp.json() as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
      search_results?: Array<{ url: string; title?: string }>;
    };
    const content = data.choices[0]?.message?.content ?? "";
    const sources = (data.search_results ?? []).map(s => ({ url: s.url, title: s.title ?? s.url }));
    if (sources.length === 0 && data.citations) {
      sources.push(...data.citations.slice(0, 8).map(u => ({ url: u, title: u })));
    }
    return { content, sources };
  } catch {
    return { content: "", sources: [] };
  }
}

function extractJSON<T>(raw: string): T | null {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf("{");
  const startA = candidate.indexOf("[");
  let s = -1;
  if (start === -1) s = startA;
  else if (startA === -1) s = start;
  else s = Math.min(start, startA);
  if (s === -1) return null;
  const open = candidate[s];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end === -1 || end < s) return null;
  try {
    return JSON.parse(candidate.slice(s, end + 1)) as T;
  } catch {
    return null;
  }
}

export async function generateIntakeQuestions(assessmentId: number): Promise<number> {
  const [assessment] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, assessmentId));
  if (!assessment) throw new Error("Assessment not found");

  let industryName = "general";
  if (assessment.industryId) {
    const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, assessment.industryId));
    if (ind) industryName = ind.name;
  }

  const prompt = `You are a Virtual Capability Engineer interviewing a client. Their value case is below. Generate 5 to 7 sharp clarifying questions that a senior strategy consultant would ask before going off to research and build a Capability Economics assessment.

Client: ${assessment.clientName}
Industry: ${industryName}

Value Case:
"""
${assessment.valueCase}
"""

Each question should:
- Probe ONE specific dimension (current capability state, target outcome, time horizon, risk tolerance, budget, competitive context, team readiness, success metric, etc.)
- Be answerable in 1-3 sentences
- Avoid yes/no questions
- Include a one-line rationale explaining why it matters

Return ONLY valid JSON with this shape:
{ "questions": [ { "question": "...", "rationale": "..." }, ... ] }`;

  const raw = await callGLM(prompt, 2048);
  const parsed = extractJSON<{ questions: { question: string; rationale: string }[] }>(raw);
  if (!parsed?.questions || !Array.isArray(parsed.questions)) {
    throw new Error("GLM did not return valid questions JSON");
  }

  const rows = parsed.questions.slice(0, 7).map((q, i) => ({
    assessmentId,
    question: q.question,
    rationale: q.rationale ?? null,
    displayOrder: i,
  }));
  if (rows.length === 0) throw new Error("No questions generated");
  await db.insert(vceQuestionsTable).values(rows);
  await db.update(vceAssessmentsTable).set({ status: "intake", updatedAt: new Date() }).where(eq(vceAssessmentsTable.id, assessmentId));
  return rows.length;
}

export async function runResearch(assessmentId: number): Promise<{ itemsCreated: number; areas: string[] }> {
  const [assessment] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, assessmentId));
  if (!assessment) throw new Error("Assessment not found");

  let industryName = "general";
  if (assessment.industryId) {
    const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, assessment.industryId));
    if (ind) industryName = ind.name;
  }

  const questions = await db.select().from(vceQuestionsTable)
    .where(eq(vceQuestionsTable.assessmentId, assessmentId))
    .orderBy(asc(vceQuestionsTable.displayOrder));
  const qa = questions.map(q => `Q: ${q.question}\nA: ${q.answer ?? "(no answer)"}`).join("\n\n");

  await db.update(vceAssessmentsTable).set({ status: "researching", updatedAt: new Date() }).where(eq(vceAssessmentsTable.id, assessmentId));

  // Step 1 — GLM 5.1 plans the research areas
  const planPrompt = `You are a Virtual Capability Engineer. Based on the client value case and Q&A below, identify 5-6 research areas to investigate using web research. Each area should map to one of these kinds: capability_gap, opportunity, recommendation, risk, insight, benchmark.

Client: ${assessment.clientName} (${industryName})

Value Case:
"""
${assessment.valueCase}
"""

Q&A from intake:
${qa}

Return ONLY valid JSON:
{ "areas": [ { "kind": "capability_gap|opportunity|recommendation|risk|insight|benchmark", "title": "short title", "researchQuery": "specific query to run on Perplexity that will return real 2024-2026 data with numbers and named examples" }, ... ] }`;

  const planRaw = await callGLM(planPrompt, 2048);
  const plan = extractJSON<{ areas: { kind: string; title: string; researchQuery: string }[] }>(planRaw);
  if (!plan?.areas || !Array.isArray(plan.areas) || plan.areas.length === 0) {
    throw new Error("GLM did not return valid research plan");
  }

  // Step 2 — for each area: Perplexity research → GLM synthesis → store as pending item
  let created = 0;
  const errors: string[] = [];
  for (const area of plan.areas.slice(0, 6)) {
    try {
      const research = await perplexityResearch(area.researchQuery);
      if (!research.content || research.content.length < 80) {
        errors.push(`${area.title}: empty research`);
        continue;
      }
      const synthPrompt = `Synthesize the research below into a single executive-grade finding for a Capability Economics assessment. Be specific, cite numbers, name companies/benchmarks where relevant. Output ONLY valid JSON.

Client context: ${assessment.clientName} (${industryName})
Value case (1-line): ${assessment.valueCase.slice(0, 280)}

Finding kind: ${area.kind}
Title: ${area.title}

Research:
"""
${research.content.slice(0, 5000)}
"""

Return:
{
  "summary": "1-2 sentence executive takeaway",
  "body": "3-5 paragraph narrative with specifics, numbers, named examples and implications for the client",
  "confidenceScore": 0.55-0.95
}`;
      const synthRaw = await callGLM(synthPrompt, 2048);
      const synth = extractJSON<{ summary: string; body: string; confidenceScore?: number }>(synthRaw);
      if (!synth?.summary || !synth?.body) {
        errors.push(`${area.title}: synthesis parse failed`);
        continue;
      }
      await db.insert(vceResearchItemsTable).values({
        assessmentId,
        kind: area.kind,
        title: area.title,
        summary: synth.summary,
        body: synth.body,
        sources: research.sources,
        confidenceScore: Math.max(0, Math.min(1, synth.confidenceScore ?? 0.7)),
        status: "pending",
        includeInReport: true,
      });
      created++;
    } catch (e) {
      errors.push(`${area.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await db.update(vceAssessmentsTable).set({
    status: created > 0 ? "review" : "intake",
    updatedAt: new Date(),
  }).where(eq(vceAssessmentsTable.id, assessmentId));

  if (created === 0) {
    throw new Error(`Research produced no items. Errors: ${errors.join("; ")}`);
  }

  return { itemsCreated: created, areas: plan.areas.map(a => a.title) };
}

export async function finalizeAssessment(assessmentId: number) {
  const [assessment] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, assessmentId));
  if (!assessment) throw new Error("Assessment not found");

  const approved = await db.select().from(vceResearchItemsTable).where(
    and(
      eq(vceResearchItemsTable.assessmentId, assessmentId),
      eq(vceResearchItemsTable.status, "approved"),
      eq(vceResearchItemsTable.includeInReport, true),
    )
  );
  if (approved.length === 0) throw new Error("No approved research items to finalize. Approve at least one item first.");

  let industryName = "general";
  if (assessment.industryId) {
    const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, assessment.industryId));
    if (ind) industryName = ind.name;
  }

  const findingsBlock = approved.map(a => `[${a.kind.toUpperCase()}] ${a.title}\nSummary: ${a.summary}\nDetail: ${a.body}\n`).join("\n---\n");

  const prompt = `You are the Virtual Capability Engineer assembling a final Capability Economics assessment report. Use ONLY the approved findings below — do not invent new data.

Client: ${assessment.clientName} (${industryName})
Value case: """${assessment.valueCase}"""

Approved findings:
${findingsBlock}

Produce a single executive-grade report. Return ONLY valid JSON:
{
  "executiveSummary": "3-4 sentence partner-level summary tying findings to the client's value case",
  "capabilityGaps": [ { "name": "capability name", "gap": "what is missing", "impact": "consequence if unaddressed" } ],
  "recommendations": [ { "title": "...", "rationale": "...", "impact": "expected outcome", "horizon": "0-6mo|6-18mo|18-36mo" } ],
  "quadrantInsights": { "hot": ["..."], "emerging": ["..."], "cooling": ["..."], "tableStakes": ["..."] },
  "risks": ["..."],
  "nextSteps": ["concrete action 1", "concrete action 2", ...]
}`;

  const raw = await callGLM(prompt, 6144);
  const report = extractJSON<{
    executiveSummary: string;
    capabilityGaps: { name: string; gap: string; impact: string }[];
    recommendations: { title: string; rationale: string; impact: string; horizon: string }[];
    quadrantInsights: { hot: string[]; emerging: string[]; cooling: string[]; tableStakes: string[] };
    risks: string[];
    nextSteps: string[];
  }>(raw);
  if (!report?.executiveSummary) throw new Error("Final report synthesis failed");

  await db.update(vceAssessmentsTable).set({
    status: "finalized",
    executiveSummary: report.executiveSummary,
    finalReport: report,
    updatedAt: new Date(),
  }).where(eq(vceAssessmentsTable.id, assessmentId));

  return report;
}
