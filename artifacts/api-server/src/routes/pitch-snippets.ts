import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  industriesTable,
  ceiComponentsTable,
  capabilityEconomicsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

type AnthropicClient = Awaited<typeof import("@workspace/integrations-anthropic-ai")>["anthropic"];
let anthropicClient: AnthropicClient | null = null;

async function getAnthropic(): Promise<AnthropicClient | null> {
  if (anthropicClient) return anthropicClient;
  if (!process.env.OPENROUTER_API_KEY) return null;
  try {
    const mod = await import("@workspace/integrations-anthropic-ai");
    anthropicClient = mod.anthropic;
    return anthropicClient;
  } catch {
    return null;
  }
}

const router: IRouter = Router();

function templatePitch(opts: {
  capabilityName: string;
  industryName: string | null;
  description: string;
  benchmarkScore: number;
  consensusScore: number | null;
  velocity: number | null;
  tamUsdMm: number | null;
}): string {
  const { capabilityName, industryName, description, benchmarkScore, consensusScore, velocity, tamUsdMm } = opts;
  const tamLine = tamUsdMm ? `~$${(tamUsdMm / 1000).toFixed(1)}B addressable` : `multi-billion dollar addressable market`;
  const velocityLine = velocity != null && velocity > 0
    ? `accelerating at +${(velocity * 100).toFixed(1)}% velocity`
    : `still early in its adoption curve`;
  const consensusLine = consensusScore != null && consensusScore < 60
    ? `Street consensus undervalues this capability (score ${consensusScore.toFixed(0)}), creating an arbitrage window for early movers.`
    : `Even with consensus catching up (score ${(consensusScore ?? 50).toFixed(0)}), execution gaps remain wide enough to differentiate.`;

  return `## ${capabilityName}${industryName ? ` — ${industryName}` : ""}

**Problem.** Today, organizations attempting ${capabilityName.toLowerCase()} face fragmented tooling, slow time-to-value, and unproven economics. ${description}

**Market.** ${tamLine}, ${velocityLine}. Benchmark capability score across the industry sits at ${benchmarkScore.toFixed(0)} — meaning leaders pull meaningful margin from laggards.

**Why this capability matters.** ${capabilityName} is the highest-leverage gap in the value chain right now. Capability Economics modeling shows it sits at the intersection of high disruption potential and low current saturation — the textbook white-space pattern. ${consensusLine}

**Why now.** Three forces converge: (1) Regulatory and economic tailwinds are forcing incumbents to revisit the stack, (2) AI primitives have matured to the point where a small team can deliver what required dozens of engineers two years ago, and (3) the half-life of the current solution set is collapsing — creating a 12–18 month window where a focused entrant can capture defensible market share before the next reset.

**The ask.** A seed-to-Series-A round to ship the first vertical wedge, prove unit economics on 5 design partners, and establish the data flywheel that makes this category winner-take-most.`;
}

async function aiPitch(prompt: string): Promise<string | null> {
  const anthropic = await getAnthropic();
  if (!anthropic) return null;
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content[0]?.text;
    return typeof text === "string" && text.trim().length > 0 ? text : null;
  } catch {
    return null;
  }
}

router.post("/pitch-snippets/generate", async (req, res) => {
  try {
    const capabilityId = Number(req.body?.capabilityId);
    if (!Number.isFinite(capabilityId)) {
      res.status(400).json({ error: "capabilityId required" });
      return;
    }

    const [row] = await db
      .select({
        capability: capabilitiesTable,
        industryName: industriesTable.name,
        consensusScore: ceiComponentsTable.consensusScore,
        velocity: ceiComponentsTable.velocity,
        tamUsdMm: capabilityEconomicsTable.tamUsdMm,
      })
      .from(capabilitiesTable)
      .leftJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
      .leftJoin(ceiComponentsTable, eq(ceiComponentsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
      .where(eq(capabilitiesTable.id, capabilityId));

    if (!row) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }

    const opts = {
      capabilityName: row.capability.name,
      industryName: row.industryName,
      description: row.capability.description,
      benchmarkScore: row.capability.benchmarkScore,
      consensusScore: row.consensusScore,
      velocity: row.velocity,
      tamUsdMm: row.tamUsdMm,
    };

    const prompt = `You are a pitch-deck consultant for venture-backed founders. Write a tight ~200 word investor pitch snippet in markdown for a startup building "${opts.capabilityName}" in the ${opts.industryName ?? "target"} industry.

Capability description: ${opts.description}
Industry benchmark capability score (0-100): ${opts.benchmarkScore.toFixed(0)}
Street consensus score (0-100): ${opts.consensusScore != null ? opts.consensusScore.toFixed(0) : "n/a"}
Capability velocity (positive = accelerating): ${opts.velocity != null ? opts.velocity.toFixed(3) : "n/a"}
TAM (USD millions): ${opts.tamUsdMm != null ? opts.tamUsdMm.toFixed(0) : "n/a"}

Structure with bold section headers:
**Problem.** <2 sentences naming the pain>
**Market.** <2 sentences with TAM + growth>
**Why this capability matters.** <2 sentences linking the capability to defensible value>
**Why now.** <2-3 sentences on timing — regulatory, AI, or capital cycle catalysts>
**The ask.** <1 sentence on round size and use of funds>

Be sharp, concrete, and avoid corporate buzzwords. No preamble, just the markdown.`;

    const ai = await aiPitch(prompt);
    const snippet = ai ?? templatePitch(opts);
    res.json({ snippet, source: ai ? "ai" : "template" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
