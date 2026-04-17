import { db } from "@workspace/db";
import { logLlmCall } from "./llm-usage";
import { macroEventsTable, industriesTable, capabilitiesTable, type MacroEvent } from "@workspace/db";
import { desc } from "drizzle-orm";

export type EventType = "war" | "regulation" | "tech_shift" | "economic" | "disaster" | "other";
export type SentimentDirection = "positive" | "negative" | "neutral";

const SENTIMENT_SHOCK_PER_SEVERITY = 0.5;
const VOLATILITY_BOOST_PER_SEVERITY = 0.005;

export interface MacroShock {
  sentimentShock: number;
  volatilityBoost: number;
  contributingEvents: Array<{ id: number; title: string; severity: number; decayFactor: number; direction: SentimentDirection }>;
}

function decayFactor(event: Pick<MacroEvent, "startedAt" | "decayDays">): number {
  const elapsedDays = (Date.now() - new Date(event.startedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - elapsedDays / Math.max(0.1, event.decayDays));
}

function directionSign(d: string): number {
  if (d === "positive") return 1;
  if (d === "negative") return -1;
  return 0;
}

export async function listActiveEvents(): Promise<MacroEvent[]> {
  const all = await db.select().from(macroEventsTable).orderBy(desc(macroEventsTable.startedAt));
  return all.filter(e => decayFactor(e) > 0);
}

export async function getActiveEventsForIndustry(industryId: number): Promise<MacroEvent[]> {
  const active = await listActiveEvents();
  return active.filter(e => {
    const ids = (e.affectedIndustryIds ?? []) as number[];
    return ids.length === 0 || ids.includes(industryId);
  });
}

/**
 * Bidirectional capability scope: when a macro event names a parent capability,
 * its children are also affected (and vice-versa — a child shock signals the parent).
 * Returns the union of explicitly-named cap IDs + any parents/children connected to them.
 */
export async function expandAffectedCapabilityIds(ids: number[]): Promise<number[]> {
  if (!ids?.length) return [];
  const all = await db.select().from(capabilitiesTable);
  const byId = new Map(all.map(c => [c.id, c]));
  const out = new Set<number>(ids);
  for (const id of ids) {
    const cap = byId.get(id);
    if (!cap) continue;
    // Down: include all children if this is a parent.
    for (const c of all) if (c.parentCapabilityId === id) out.add(c.id);
    // Up: include the parent if this is a child.
    if (cap.parentCapabilityId) out.add(cap.parentCapabilityId);
  }
  return [...out];
}

/**
 * Get all capability IDs (parents+children) currently subject to active macro events.
 * Used by the engine to apply event-driven shocks correctly across the parent/child tree.
 */
export async function getAffectedCapabilityIdsFromActiveEvents(): Promise<Set<number>> {
  const active = await listActiveEvents();
  const explicit: number[] = [];
  for (const e of active) {
    const ids = (e.affectedCapabilityIds ?? []) as number[];
    explicit.push(...ids);
  }
  if (!explicit.length) return new Set();
  const expanded = await expandAffectedCapabilityIds(explicit);
  return new Set(expanded);
}

/**
 * Per-capability listing of active macro events impacting each cap (explicit + expanded
 * via parent↔child propagation), with severity/direction/decay so the UI can render
 * a "why" tooltip next to the affected capability.
 */
export interface AffectedCapEvent {
  eventId: number;
  title: string;
  description: string;
  severity: number;
  sentimentDirection: SentimentDirection;
  decayFactor: number;
  source: string;
  via: "explicit" | "parent" | "child";
}
export async function getCapabilityImpactExplanations(): Promise<Record<number, AffectedCapEvent[]>> {
  const active = await listActiveEvents();
  if (!active.length) return {};
  const all = await db.select({ id: capabilitiesTable.id, parentCapabilityId: capabilitiesTable.parentCapabilityId }).from(capabilitiesTable);
  const childrenByParent = new Map<number, number[]>();
  const parentByChild = new Map<number, number>();
  for (const c of all) {
    if (c.parentCapabilityId) {
      parentByChild.set(c.id, c.parentCapabilityId);
      const arr = childrenByParent.get(c.parentCapabilityId) ?? [];
      arr.push(c.id);
      childrenByParent.set(c.parentCapabilityId, arr);
    }
  }
  const result: Record<number, AffectedCapEvent[]> = {};
  for (const e of active) {
    const explicit = (e.affectedCapabilityIds ?? []) as number[];
    if (!explicit.length) continue;
    const df = decayFactor(e);
    if (df <= 0) continue;
    const baseEntry = (via: AffectedCapEvent["via"]): AffectedCapEvent => ({
      eventId: e.id,
      title: e.title,
      description: e.description ?? "",
      severity: e.severity,
      sentimentDirection: e.sentimentDirection as SentimentDirection,
      decayFactor: Math.round(df * 100) / 100,
      source: e.source,
      via,
    });
    const seen = new Map<number, AffectedCapEvent["via"]>();
    for (const id of explicit) seen.set(id, "explicit");
    for (const id of explicit) {
      // Up: include parent of an explicit child
      const parent = parentByChild.get(id);
      if (parent && !seen.has(parent)) seen.set(parent, "child");
      // Down: include children of an explicit parent
      const kids = childrenByParent.get(id) ?? [];
      for (const k of kids) if (!seen.has(k)) seen.set(k, "parent");
    }
    for (const [capId, via] of seen) {
      if (!result[capId]) result[capId] = [];
      result[capId].push(baseEntry(via));
    }
  }
  return result;
}

export async function computeMacroShockForIndustry(industryId: number): Promise<MacroShock> {
  const events = await getActiveEventsForIndustry(industryId);
  return aggregateShocks(events);
}

export async function computeGlobalMacroShock(): Promise<MacroShock> {
  const events = await listActiveEvents();
  return aggregateShocks(events);
}

function aggregateShocks(events: MacroEvent[]): MacroShock {
  let sentimentShock = 0;
  let volatilityBoost = 0;
  const contributingEvents: MacroShock["contributingEvents"] = [];
  for (const e of events) {
    const df = decayFactor(e);
    if (df <= 0) continue;
    const dir = e.sentimentDirection as SentimentDirection;
    const sign = directionSign(dir);
    sentimentShock += e.severity * sign * SENTIMENT_SHOCK_PER_SEVERITY * df;
    volatilityBoost += e.severity * VOLATILITY_BOOST_PER_SEVERITY * df;
    contributingEvents.push({ id: e.id, title: e.title, severity: e.severity, decayFactor: Math.round(df * 100) / 100, direction: dir });
  }
  return {
    sentimentShock: Math.round(sentimentShock * 10) / 10,
    volatilityBoost: Math.round(volatilityBoost * 1000) / 1000,
    contributingEvents,
  };
}

export interface CreateEventInput {
  eventType: EventType;
  severity: number;
  title: string;
  description: string;
  affectedIndustryIds?: number[];
  affectedCapabilityIds?: number[];
  sentimentDirection?: SentimentDirection;
  decayDays?: number;
  source?: "admin" | "world_scan" | "manual";
  citations?: string[];
  createdBy?: string;
  startedAt?: Date;
}

export async function createMacroEvent(input: CreateEventInput): Promise<MacroEvent> {
  const severity = Math.max(0, Math.min(10, input.severity));
  const [row] = await db.insert(macroEventsTable).values({
    eventType: input.eventType,
    severity,
    title: input.title.slice(0, 200),
    description: input.description.slice(0, 2000),
    affectedIndustryIds: input.affectedIndustryIds ?? [],
    affectedCapabilityIds: input.affectedCapabilityIds ?? [],
    sentimentDirection: input.sentimentDirection ?? "negative",
    decayDays: input.decayDays ?? 14,
    source: input.source ?? "admin",
    citations: input.citations ?? [],
    createdBy: input.createdBy ?? "admin",
    startedAt: input.startedAt ?? new Date(),
  }).returning();
  return row;
}

export async function deleteMacroEvent(id: number): Promise<boolean> {
  const result = await db.delete(macroEventsTable).where(eqId(id)).returning();
  return result.length > 0;
}

import { eq } from "drizzle-orm";
function eqId(id: number) { return eq(macroEventsTable.id, id); }

export async function listAllEvents(limit = 100): Promise<MacroEvent[]> {
  return db.select().from(macroEventsTable).orderBy(desc(macroEventsTable.startedAt)).limit(limit);
}

export interface ScannedEvent {
  title: string;
  type: EventType;
  severity: number;
  sentiment_direction: SentimentDirection;
  decay_days: number;
  rationale: string;
}

export async function runWorldScanForIndustry(industryName: string, industryId: number): Promise<{ inserted: number; events: MacroEvent[]; errors: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { inserted: 0, events: [], errors: ["PERPLEXITY_API_KEY not set"] };

  // Pull the actual capability menu for this industry so the LLM can name-tag events to specific caps.
  const industryCaps = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name })
    .from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
  const capNameById = new Map(industryCaps.map(c => [c.id, c.name]));
  const capMenu = industryCaps.map(c => `- ${c.name}`).join("\n");

  const systemPrompt = `You are a macro analyst tracking real-world events that disrupt enterprise capabilities.
Identify ONLY major events (severity >= 5) from the past 24 hours. Examples: wars, regulatory rulings, central bank decisions, major outages, paradigm shifts (e.g. new AI model launch), trade restrictions.
You MUST tag each event with the specific capabilities it touches, chosen verbatim from the provided capability menu.
Return ONLY a valid JSON array, no markdown. Empty array [] if nothing material.`;

  const userPrompt = `What major macro events in the past 24 hours could disrupt the ${industryName} industry?

Capability menu for ${industryName} (use EXACT names from this list in affected_capabilities):
${capMenu}

Return JSON array (max 5 entries):
[{
  "title": "<short headline>",
  "type": "war|regulation|tech_shift|economic|disaster|other",
  "severity": <0-10 integer>,
  "sentiment_direction": "positive|negative|neutral",
  "decay_days": <expected days the impact persists, 1-90>,
  "rationale": "<1-2 sentence why this disrupts ${industryName}>",
  "affected_capabilities": ["<exact name from menu>", "..."]
}]
Tag 1-4 capabilities per event. Skip the field only if no capability in the menu is materially affected.`;

  const _meStart = Date.now();
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "macro-events.scan", startedAt: _meStart, httpStatus: resp.status, errorMessage: `HTTP ${resp.status}` });
      throw new Error(`Perplexity ${resp.status}`);
    }
    const data = await resp.json() as { choices: Array<{ message: { content: string } }>; citations?: string[] };
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "macro-events.scan", startedAt: _meStart, httpStatus: resp.status, responseJson: data });
    const content = data.choices[0]?.message?.content ?? "";
    const citations = data.citations ?? [];
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) return { inserted: 0, events: [], errors: ["No JSON array in response"] };
    const parsed = JSON.parse(cleaned.substring(start, end + 1)) as ScannedEvent[];

    const inserted: MacroEvent[] = [];
    // Build a lower-case index of the industry's capability names for fuzzy resolution
    // when the LLM uses near-matches instead of verbatim menu entries.
    const capByLower = new Map(industryCaps.map(c => [c.name.toLowerCase(), c.id]));
    for (const ev of parsed) {
      if (!ev?.title || ev.severity < 5) continue;
      const tagged: number[] = [];
      const named = Array.isArray((ev as ScannedEvent & { affected_capabilities?: unknown }).affected_capabilities)
        ? ((ev as ScannedEvent & { affected_capabilities: unknown[] }).affected_capabilities as unknown[])
        : [];
      for (const n of named) {
        if (typeof n !== "string") continue;
        const id = capByLower.get(n.toLowerCase());
        if (id) tagged.push(id);
      }
      // Fallback fuzzy match against event title + rationale for caps not explicitly tagged.
      if (tagged.length === 0) {
        const hay = (`${ev.title} ${ev.rationale ?? ""}`).toLowerCase();
        for (const cap of industryCaps) {
          const tokens = cap.name.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
          if (tokens.length && tokens.every(t => hay.includes(t))) tagged.push(cap.id);
        }
      }
      const dedupedCapIds = Array.from(new Set(tagged));
      const created = await createMacroEvent({
        eventType: ev.type,
        severity: ev.severity,
        title: ev.title,
        description: ev.rationale ?? "",
        affectedIndustryIds: [industryId],
        affectedCapabilityIds: dedupedCapIds,
        sentimentDirection: ev.sentiment_direction ?? "negative",
        decayDays: Math.max(1, Math.min(90, ev.decay_days ?? 14)),
        source: "world_scan",
        citations,
        createdBy: "world_scan",
      });
      inserted.push(created);
      if (dedupedCapIds.length) {
        console.log(`[world-scan] tagged "${ev.title.substring(0, 60)}" → ${dedupedCapIds.length} caps: ${dedupedCapIds.map(id => capNameById.get(id)).join(", ")}`);
      } else {
        console.log(`[world-scan] no cap match for "${ev.title.substring(0, 60)}" (industry-only shock)`);
      }
    }
    return { inserted: inserted.length, events: inserted, errors: [] };
  } catch (err) {
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "macro-events.scan", startedAt: _meStart, errorMessage: err instanceof Error ? err.message : String(err) });
    return { inserted: 0, events: [], errors: [err instanceof Error ? err.message : String(err)] };
  }
}

export async function runWorldScanAllIndustries(): Promise<{ totalInserted: number; perIndustry: Array<{ industryId: number; industryName: string; inserted: number; errors: string[] }> }> {
  const industries = await db.select().from(industriesTable);
  let totalInserted = 0;
  const perIndustry: Array<{ industryId: number; industryName: string; inserted: number; errors: string[] }> = [];
  for (const ind of industries) {
    const result = await runWorldScanForIndustry(ind.name, ind.id);
    totalInserted += result.inserted;
    perIndustry.push({ industryId: ind.id, industryName: ind.name, inserted: result.inserted, errors: result.errors });
    await new Promise(r => setTimeout(r, 1500));
  }
  return { totalInserted, perIndustry };
}
