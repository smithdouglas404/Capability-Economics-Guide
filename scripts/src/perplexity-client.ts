interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PerplexityResponse {
  choices: Array<{ message: { content: string } }>;
  citations: string[];
}

export interface ResearchResult {
  content: string;
  citations: string[];
}

export async function queryPerplexity(
  messages: PerplexityMessage[],
  model = "sonar-pro",
): Promise<ResearchResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");

  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!resp.ok) {
    throw new Error(`Perplexity API error: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as PerplexityResponse;
  return {
    content: data.choices[0]?.message?.content ?? "",
    citations: data.citations ?? [],
  };
}

export async function researchIndustryBenchmarks(
  industryName: string,
  capabilities: string[],
): Promise<ResearchResult> {
  const capList = capabilities
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  return queryPerplexity([
    {
      role: "system",
      content: `You are an industry research analyst. Return ONLY valid JSON with no markdown, no code fences, no explanation. The JSON must match this exact structure:
{
  "industryMaturity": { "score": <number 0-100>, "framework": "<name>", "description": "<1-2 sentences>" },
  "capabilities": [
    {
      "name": "<capability name>",
      "benchmarkScore": <number 0-100>,
      "metrics": [
        { "name": "<metric name>", "value": <number>, "unit": "<unit>", "context": "<1 sentence explaining this number>" }
      ],
      "thresholds": { "greenMin": <number>, "yellowMin": <number> },
      "source_context": "<1-2 sentences citing what report/data this is based on>"
    }
  ],
  "leaders": [
    {
      "company": "<name>",
      "maturityScore": <number 0-100>,
      "topCapability": "<name>",
      "topScore": <number>,
      "weakestCapability": "<name>",
      "weakestScore": <number>,
      "investmentLevel": "high"|"medium"|"low",
      "trend": "improving"|"stable"|"declining"
    }
  ]
}
Base ALL numbers on real industry reports from Gartner, McKinsey, Forrester, Deloitte, Accenture, BCG, or other major analysts (2023-2026). Where exact scores aren't published, derive reasonable estimates from the data points those reports DO provide (e.g., adoption rates, maturity stage distributions, performance benchmarks). Note the source in source_context.`,
    },
    {
      role: "user",
      content: `Research real benchmark data for the ${industryName} industry across these capabilities:\n${capList}\n\nFor each capability, provide:\n- A maturity benchmark score (0-100) based on real industry data\n- 2 key operational metrics with real benchmark values\n- Green/yellow thresholds based on industry maturity frameworks\n- Source context explaining what data this is derived from\n\nAlso provide the top 3 companies/organizations in this industry ranked by digital/capability maturity, plus an "Industry Average" entry.\n\nReturn ONLY the JSON object, no other text.`,
    },
  ]);
}

export async function researchWhitePapers(
  industryName: string,
): Promise<ResearchResult> {
  return queryPerplexity([
    {
      role: "system",
      content: `You are an academic research analyst. Return ONLY valid JSON with no markdown, no code fences. The JSON must be an array of objects:
[
  {
    "title": "<real report/paper title>",
    "author": "<real author name>",
    "organization": "<real publisher/org>",
    "abstract": "<real or accurate summary of the paper's content, 2-3 sentences>",
    "category": "Research"|"Industry Report"|"Framework"|"Academic Paper"|"Strategy Brief",
    "url": "<real URL if available, or null>",
    "publishedYear": <year>,
    "tags": "<pipe-separated tags>"
  }
]
Only include REAL published reports and papers that actually exist. Do not fabricate titles, authors, or organizations.`,
    },
    {
      role: "user",
      content: `Find 3-4 real, published reports, white papers, or research papers about digital capability maturity, digital transformation, or capability economics in the ${industryName} industry. Published 2022-2026. From major consultancies (McKinsey, Deloitte, BCG, Accenture, Gartner, Forrester) or academic institutions. Only include papers that actually exist with real authors and titles. Return ONLY the JSON array.`,
    },
  ]);
}

export function extractJson<T>(text: string): T {
  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonStart = cleaned.indexOf("{") !== -1 && cleaned.indexOf("[") !== -1
    ? Math.min(cleaned.indexOf("{"), cleaned.indexOf("["))
    : cleaned.indexOf("{") !== -1
      ? cleaned.indexOf("{")
      : cleaned.indexOf("[");
  const jsonEnd = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`No JSON found in response: ${text.substring(0, 200)}`);
  }

  return JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1)) as T;
}
