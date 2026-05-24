/**
 * Capability Disruption Index — narrative generator + candidate disruptor
 * matcher. Sits next to disruption-index.ts (the math) and is called by
 * the agent + admin recompute paths after a fresh DI score lands.
 *
 * Produces:
 *   1. A 3-paragraph narrative grounded in the top sub-scores + cited evidence
 *   2. A short list of candidate disruptor companies (from the `companies`
 *      table) whose fingerprinted capabilities overlap with the target +
 *      whose funding stage suggests they're in the disruption window
 */
import { db, companiesTable, companyCapabilityFingerprintTable, capabilitiesTable, type DisruptionPlaybookArchetype } from "@workspace/db";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { chatWithFallback } from "./llm-fallback";
import { logger } from "../lib/logger";
import type { DisruptionScoreResult, SubscoreEvidence } from "./disruption-index";

const SONNET = "anthropic/claude-sonnet-4.6";
const HAIKU = "anthropic/claude-haiku-4.5";

/**
 * Compose the 3-paragraph disruption hypothesis for a capability. Uses the
 * top 2 sub-scores + the top playbook archetype + the named enabling techs
 * + cap industry name as substitution context. Returns the markdown string
 * stored in capability_disruption_index.narrative.
 *
 * Paragraph structure (this is what the prompt enforces):
 *   1. WHY THIS IS DISRUPTABLE — names the 2 highest sub-scores + the
 *      specific evidence behind them, citing source labels.
 *   2. THE LIKELY PLAYBOOK — names the top archetype match + how the
 *      playbook would play out for THIS specific capability, with company
 *      names translated to the cap's industry.
 *   3. WHO'S LIKELY TO WIN — names candidate disruptors from the companies
 *      table + emerging signals (recent macro events, VC funding patterns)
 *      that point to specific players in the disruption window.
 */
export async function composeDisruptionNarrative(
  score: DisruptionScoreResult,
  capabilityName: string,
  industryName: string,
  topPlaybook: DisruptionPlaybookArchetype | null,
  candidateDisruptors: Array<{ companyId: number; name: string; reason: string }>,
): Promise<string> {
  if (!topPlaybook) {
    return `Disruption Index for ${capabilityName}: composite ${score.compositeDi.toFixed(0)}. Playbook archetype not yet loaded — re-run after seeding /api/admin/seed/disruption-archetypes.`;
  }

  // Pick the 2 highest sub-scores by value as the "lead with" pair.
  const sub = score.subscores;
  const subscoreList: Array<[keyof typeof sub, number, SubscoreEvidence]> = [
    ["assetFriction", sub.assetFriction, score.rationale.assetFriction],
    ["jtbdAbstractability", sub.jtbdAbstractability, score.rationale.jtbdAbstractability],
    ["enablingTechStrength", sub.enablingTechStrength, score.rationale.enablingTechStrength],
    ["trustReplaceability", sub.trustReplaceability, score.rationale.trustReplaceability],
    ["latentSupplyMultiplier", sub.latentSupplyMultiplier, score.rationale.latentSupplyMultiplier],
    ["marginAsymmetry", sub.marginAsymmetry, score.rationale.marginAsymmetry],
  ];
  subscoreList.sort(([, a], [, b]) => b - a);
  const top2 = subscoreList.slice(0, 2);

  const topTechBlock = score.topEnablingTech.length > 0
    ? score.topEnablingTech.map((t) => `  - ${t.name} (weight ${t.weight})`).join("\n")
    : "  (none picked)";

  const candidatesBlock = candidateDisruptors.length > 0
    ? candidateDisruptors.map((c) => `  - ${c.name} — ${c.reason}`).join("\n")
    : "  (no fingerprinted candidates yet — the companies table needs more coverage in this industry)";

  const system = `You are an Inflexcvi disruption analyst. Compose a 3-paragraph "disruption hypothesis" markdown narrative for the capability below. Use ONLY the data provided — don't invent companies, scores, or rationales not in the brief.

Paragraph rules:
  1. WHY THIS IS DISRUPTABLE — lead with the 2 highest sub-scores by name, restate their rationale, weave them into one analytical paragraph.
  2. THE LIKELY PLAYBOOK — name the top archetype, summarize its canonical actions, and explain how they'd play out for THIS specific capability in THIS industry. Use the archetype's narrative_template as a base but adapt.
  3. WHO'S LIKELY TO WIN — name the candidate disruptors with a short why. If empty, say so honestly + suggest the type of company to watch for.

No headings, no bullets in the output. Three paragraphs separated by blank lines.`;

  const user = `## Capability
**Name:** ${capabilityName}
**Industry:** ${industryName}
**Composite Disruption Index:** ${score.compositeDi.toFixed(0)} / 100

## Top 2 sub-scores driving the score
${top2.map(([k, v, ev]) => `- **${k}** = ${v} — ${ev.rationale}`).join("\n")}

## Top playbook match
- **${topPlaybook.name}** (similarity ${(score.topPlaybookSimilarity * 100).toFixed(0)}%)
- Summary: ${topPlaybook.summary}
- Canonical actions:
${topPlaybook.canonicalActions.map((a) => `  - ${a}`).join("\n")}
- Reference companies: ${topPlaybook.exampleCompanies.join(", ")}
- Narrative template: ${topPlaybook.narrativeTemplate}

## Top enabling technologies
${topTechBlock}

## Candidate disruptor companies (from our companies table)
${candidatesBlock}

Now write the 3 paragraphs.`;

  const result = await chatWithFallback({
    models: [SONNET, HAIKU],
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 900,
    endpoint: "disruption_index:narrative",
  });

  return result.text.trim();
}

/**
 * Find candidate disruptors for a capability. Joins:
 *   - companies → company_capability_fingerprint to find companies that
 *     reference this capability or its industry
 *   - heuristic: limit to companies whose capabilities overlap by ≥ 1
 *   - sorts by recency of fingerprint update so freshly-tagged disruptors
 *     surface first
 *
 * Returns up to `limit` rows. The `reason` string is composed inline
 * (no LLM) — keeps this cheap to call per cap.
 */
export async function findCandidateDisruptors(
  capabilityId: number,
  industryId: number,
  limit = 5,
): Promise<Array<{ companyId: number; name: string; reason: string }>> {
  try {
    // Strategy 1: direct fingerprint match — companies whose fingerprint
    // references THIS exact capability.
    const directHits = await db
      .select({
        companyId: companiesTable.id,
        name: companiesTable.name,
        ownership: companiesTable.ownership,
        weight: companyCapabilityFingerprintTable.weight,
        createdAt: companyCapabilityFingerprintTable.createdAt,
      })
      .from(companyCapabilityFingerprintTable)
      .innerJoin(companiesTable, eq(companiesTable.id, companyCapabilityFingerprintTable.companyId))
      .where(eq(companyCapabilityFingerprintTable.capabilityId, capabilityId))
      .orderBy(desc(companyCapabilityFingerprintTable.createdAt))
      .limit(limit);

    if (directHits.length >= 2) {
      return directHits.slice(0, limit).map((c) => ({
        companyId: c.companyId,
        name: c.name,
        reason: `Fingerprinted on this capability (weight ${c.weight?.toFixed(2) ?? "?"})${c.ownership ? `, ${c.ownership}` : ""}`,
      }));
    }

    // Strategy 2: industry siblings — companies fingerprinted on any cap
    // in the same industry (broader net when direct hits are sparse).
    const siblingCapIds = await db
      .select({ id: capabilitiesTable.id })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.industryId, industryId));
    if (siblingCapIds.length === 0) return directHits.map((c) => ({
      companyId: c.companyId,
      name: c.name,
      reason: `Fingerprinted on this capability${c.ownership ? ` (${c.ownership})` : ""}`,
    }));

    const siblings = await db
      .select({
        companyId: companiesTable.id,
        name: companiesTable.name,
        ownership: companiesTable.ownership,
        capId: companyCapabilityFingerprintTable.capabilityId,
        weight: companyCapabilityFingerprintTable.weight,
      })
      .from(companyCapabilityFingerprintTable)
      .innerJoin(companiesTable, eq(companiesTable.id, companyCapabilityFingerprintTable.companyId))
      .where(inArray(companyCapabilityFingerprintTable.capabilityId, siblingCapIds.map((c) => c.id)))
      .orderBy(desc(companyCapabilityFingerprintTable.weight))
      .limit(limit * 3);

    // Dedupe by company id, keep highest-weight row.
    const seen = new Map<number, { companyId: number; name: string; reason: string; weight: number }>();
    for (const row of siblings) {
      if (seen.has(row.companyId)) continue;
      const directMatch = directHits.find((d) => d.companyId === row.companyId);
      const reason = directMatch
        ? `Fingerprinted on this capability${row.ownership ? ` (${row.ownership})` : ""}`
        : `Fingerprinted on a sibling capability in the same industry${row.ownership ? ` (${row.ownership})` : ""}`;
      seen.set(row.companyId, { companyId: row.companyId, name: row.name, reason, weight: row.weight ?? 0 });
    }
    const merged = Array.from(seen.values()).sort((a, b) => b.weight - a.weight).slice(0, limit);
    return merged.map(({ companyId, name, reason }) => ({ companyId, name, reason }));
  } catch (err) {
    logger.warn({ err, capabilityId }, "[disruption-narrative] findCandidateDisruptors failed");
    return [];
  }
}
