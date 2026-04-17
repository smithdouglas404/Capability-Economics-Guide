import { db } from "@workspace/db";
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

  const systemPrompt = `You are a macro analyst tracking real-world events that disrupt enterprise capabilities.
Identify ONLY major events (severity >= 5) from the past 24 hours. Examples: wars, regulatory rulings, central bank decisions, major outages, paradigm shifts (e.g. new AI model launch), trade restrictions.
Return ONLY a valid JSON array, no markdown. Empty array [] if nothing material.`;

  const userPrompt = `What major macro events in the past 24 hours could disrupt the ${industryName} industry?
Return JSON array (max 5 entries):
[{
  "title": "<short headline>",
  "type": "war|regulation|tech_shift|economic|disaster|other",
  "severity": <0-10 integer>,
  "sentiment_direction": "positive|negative|neutral",
  "decay_days": <expected days the impact persists, 1-90>,
  "rationale": "<1-2 sentence why this disrupts ${industryName}>"
}]`;

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
    if (!resp.ok) throw new Error(`Perplexity ${resp.status}`);
    const data = await resp.json() as { choices: Array<{ message: { content: string } }>; citations?: string[] };
    const content = data.choices[0]?.message?.content ?? "";
    const citations = data.citations ?? [];
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) return { inserted: 0, events: [], errors: ["No JSON array in response"] };
    const parsed = JSON.parse(cleaned.substring(start, end + 1)) as ScannedEvent[];

    const inserted: MacroEvent[] = [];
    for (const ev of parsed) {
      if (!ev?.title || ev.severity < 5) continue;
      const created = await createMacroEvent({
        eventType: ev.type,
        severity: ev.severity,
        title: ev.title,
        description: ev.rationale ?? "",
        affectedIndustryIds: [industryId],
        sentimentDirection: ev.sentiment_direction ?? "negative",
        decayDays: Math.max(1, Math.min(90, ev.decay_days ?? 14)),
        source: "world_scan",
        citations,
        createdBy: "world_scan",
      });
      inserted.push(created);
    }
    return { inserted: inserted.length, events: inserted, errors: [] };
  } catch (err) {
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
