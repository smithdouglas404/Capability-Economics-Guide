/**
 * Auto-VCR trigger evaluator.
 *
 * Scans three signal sources on a 4-hour cadence and kicks off a VCR
 * campaign whenever a "something changed enough to warrant focused
 * research" event is detected:
 *
 *   1. capability_drop — a capability that's watched (via regulation_watches
 *      OR watchlist_items OR portfolio fingerprint) has dropped ≥ 8 CVI
 *      points in the trailing 30 days.
 *   2. regulation_overdue — a watched regulation has passed its effective
 *      date AND the watcher's compliance is < 80%.
 *   3. portfolio_company_dip — a portfolio company's average capability CVI
 *      has dropped ≥ 5 points in the trailing 30 days (averaged across the
 *      company's capability fingerprint).
 *
 * For each detected trigger we:
 *   - Insert an `auto_vcr_triggers` ledger row (idempotency over 14 days).
 *   - Create a 1-day / 1-cycle VCR campaign via `createCampaign` with an
 *     auto-generated value-case question.
 *   - Generate intake questions via `generateIntakeQuestions` (no human
 *     loop — the LLM auto-fills both questions and objective).
 *   - Immediately fire `runNextCycle` so the LangGraph research cycle
 *     runs end-to-end inside this tick.
 *   - Post a `member_notification` summarizing the cycle's executive
 *     output back to the owning user's inbox.
 *
 * Idempotent: re-running this evaluator while the same signal is still
 * present is a no-op until 14 days have elapsed since the previous fire
 * for that (signalSource, signalKey) pair.
 *
 * Wired into scheduler.ts on a 4-hour cadence, same shape as
 * regulations-watch-notifier.
 */
import { db } from "@workspace/db";
import {
  autoVcrTriggersTable,
  regulationWatchesTable,
  regulationsTable,
  regulationCapabilityRequirementsTable,
  watchlistItemsTable,
  watchlistsTable,
  portfolioCompaniesTable,
  companiesTable,
  companyCapabilityFingerprintTable,
  organizationsTable,
  organizationCapabilitiesTable,
  cviComponentsTable,
  cviCapabilityHistoryTable,
  capabilitiesTable,
  memberNotificationsTable,
  vcrAssessmentsTable,
  vcrResearchItemsTable,
} from "@workspace/db";
import { eq, inArray, and, gte, desc } from "drizzle-orm";
import {
  createCampaign,
  generateIntakeQuestions,
  runNextCycle,
} from "./vcr/index";

const TRIGGER_DEDUPE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const CAPABILITY_DROP_THRESHOLD_POINTS = 8;
const PORTFOLIO_COMPANY_DROP_THRESHOLD_POINTS = 5;
const REGULATION_COMPLIANCE_FLOOR_PCT = 80;
const HISTORY_LOOKBACK_DAYS = 30;
const MAX_TRIGGERS_PER_TICK = 5; // cost-control — VCR cycles use Perplexity + LLM

export interface AutoVcrTriggerStats {
  walked: number;
  fired: number;
  skippedRecent: number;
  skippedCap: number;
  errors: number;
}

interface PendingTrigger {
  signalSource: "capability_drop" | "regulation_overdue" | "portfolio_company_dip";
  signalKey: string;
  userId: string;
  targetId: number | null;
  industryId: number | null;
  clientLabel: string;
  reason: string;
  valueCase: string;
}

/**
 * Pulls the oldest CVI snapshot inside the lookback window AND the most
 * recent snapshot per capability. Returns map: capabilityId -> { start, end, dropPoints }.
 *
 * `dropPoints` is positive when the score has fallen (start - end), so a
 * 12-point drop reads as `dropPoints: 12`.
 */
async function computeCapabilityDrops(
  capabilityIds: number[],
): Promise<Map<number, { start: number; end: number; dropPoints: number }>> {
  const result = new Map<number, { start: number; end: number; dropPoints: number }>();
  if (capabilityIds.length === 0) return result;

  const cutoff = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const history = await db
    .select()
    .from(cviCapabilityHistoryTable)
    .where(
      and(
        inArray(cviCapabilityHistoryTable.capabilityId, capabilityIds),
        gte(cviCapabilityHistoryTable.snapshotAt, cutoff),
      ),
    )
    .orderBy(cviCapabilityHistoryTable.snapshotAt);

  // Bucket by capability — first row in cutoff window is "start", last is "end".
  for (const row of history) {
    const prev = result.get(row.capabilityId);
    if (!prev) {
      result.set(row.capabilityId, { start: row.consensusScore, end: row.consensusScore, dropPoints: 0 });
    } else {
      prev.end = row.consensusScore;
      prev.dropPoints = prev.start - prev.end;
    }
  }
  return result;
}

/**
 * Resolves a sessionToken to the most-recently-updated `clerkUserId` so
 * triggers fired from a session-token-only context still find an inbox
 * owner. Returns null when the session never claimed a user identity.
 */
async function resolveUserIdsBySessionToken(sessionTokens: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (sessionTokens.length === 0) return result;
  const orgs = await db
    .select()
    .from(organizationsTable)
    .where(inArray(organizationsTable.sessionToken, sessionTokens));
  for (const o of orgs) {
    if (o.clerkUserId && !result.has(o.sessionToken)) result.set(o.sessionToken, o.clerkUserId);
  }
  return result;
}

/**
 * Returns the set of (signalSource, signalKey) pairs that have fired
 * within the dedupe window. Used as an in-memory filter when scanning
 * candidates so we don't bother computing for already-fired keys.
 */
async function loadRecentTriggerKeys(): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - TRIGGER_DEDUPE_WINDOW_MS);
  const rows = await db
    .select({ signalSource: autoVcrTriggersTable.signalSource, signalKey: autoVcrTriggersTable.signalKey })
    .from(autoVcrTriggersTable)
    .where(gte(autoVcrTriggersTable.firedAt, cutoff));
  return new Set(rows.map((r) => `${r.signalSource}::${r.signalKey}`));
}

function makeKey(source: string, key: string): string {
  return `${source}::${key}`;
}

/**
 * Sign #1: watched capability drop. Walks both regulation_watches AND
 * watchlist_items, computes 30d drop from cvi_capability_history, and
 * flags caps with drop >= 8 pts.
 */
async function collectCapabilityDropTriggers(
  recent: Set<string>,
): Promise<PendingTrigger[]> {
  // Build (capabilityId, userId) pairs from both regulation watches and watchlist items.
  type WatcherPair = { userId: string; capabilityId: number };
  const pairs: WatcherPair[] = [];

  // From regulation_watches — capabilities required by the watched regulations.
  const regWatches = await db.select().from(regulationWatchesTable);
  if (regWatches.length > 0) {
    const regIds = Array.from(new Set(regWatches.map((w) => w.regulationId)));
    const reqs = await db
      .select()
      .from(regulationCapabilityRequirementsTable)
      .where(inArray(regulationCapabilityRequirementsTable.regulationId, regIds));
    const reqsByReg = new Map<number, number[]>();
    for (const r of reqs) {
      const arr = reqsByReg.get(r.regulationId) ?? [];
      arr.push(r.capabilityId);
      reqsByReg.set(r.regulationId, arr);
    }
    for (const w of regWatches) {
      for (const capId of reqsByReg.get(w.regulationId) ?? []) {
        pairs.push({ userId: w.userId, capabilityId: capId });
      }
    }
  }

  // From watchlist_items — direct capability watch via session_token → user.
  const watchlistItems = await db.select().from(watchlistItemsTable);
  if (watchlistItems.length > 0) {
    const wlIds = Array.from(new Set(watchlistItems.map((i) => i.watchlistId)));
    const wls = await db.select().from(watchlistsTable).where(inArray(watchlistsTable.id, wlIds));
    const sessionTokens = Array.from(new Set(wls.map((w) => w.sessionToken).filter((t): t is string => !!t)));
    const userByToken = await resolveUserIdsBySessionToken(sessionTokens);
    const wlByIdToken = new Map(wls.map((w) => [w.id, w.sessionToken]));
    for (const i of watchlistItems) {
      const token = wlByIdToken.get(i.watchlistId);
      if (!token) continue;
      const userId = userByToken.get(token);
      if (!userId) continue;
      pairs.push({ userId, capabilityId: i.capabilityId });
    }
  }

  if (pairs.length === 0) return [];

  const capIds = Array.from(new Set(pairs.map((p) => p.capabilityId)));
  const drops = await computeCapabilityDrops(capIds);
  const capRows = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds));
  const capById = new Map(capRows.map((c) => [c.id, c]));

  const out: PendingTrigger[] = [];
  // Dedupe (userId, capabilityId) — a cap may be watched twice (reg + watchlist).
  const seen = new Set<string>();
  for (const { userId, capabilityId } of pairs) {
    const dedupeKey = `${userId}:${capabilityId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const d = drops.get(capabilityId);
    if (!d || d.dropPoints < CAPABILITY_DROP_THRESHOLD_POINTS) continue;

    const signalKey = `cap:${capabilityId}:user:${userId}`;
    if (recent.has(makeKey("capability_drop", signalKey))) continue;

    const cap = capById.get(capabilityId);
    const capName = cap?.name ?? `Capability #${capabilityId}`;
    const dropFmt = d.dropPoints.toFixed(1);
    const reason = `${capName} dropped ${dropFmt} CVI pts in the trailing ${HISTORY_LOOKBACK_DAYS} days (from ${d.start.toFixed(1)} to ${d.end.toFixed(1)})`;
    const valueCase = `A watched capability — ${capName} — has dropped ${dropFmt} consensus CVI points in the last ${HISTORY_LOOKBACK_DAYS} days (from ${d.start.toFixed(1)} to ${d.end.toFixed(1)}). Investigate the root cause: which macro events, peer movements, regulatory shifts, or technology disruptions contributed? Identify what the holder of this watch should do next (defend, divest, retrain, double down) and over what time horizon.`;
    out.push({
      signalSource: "capability_drop",
      signalKey,
      userId,
      targetId: capabilityId,
      industryId: cap?.industryId ?? null,
      clientLabel: `Auto-VCR: ${capName.slice(0, 80)}`,
      reason,
      valueCase,
    });
  }
  return out;
}

/**
 * Sign #2: watched regulation passed effective date with compliance < 80%.
 * Mirrors the compute in regulations-watch-notifier.ts but with a tighter
 * VCR threshold (80% not 100%) and a 14-day dedupe rather than 24h.
 */
async function collectRegulationOverdueTriggers(
  recent: Set<string>,
): Promise<PendingTrigger[]> {
  const watches = await db.select().from(regulationWatchesTable);
  if (watches.length === 0) return [];

  const regIds = Array.from(new Set(watches.map((w) => w.regulationId)));
  const regs = await db.select().from(regulationsTable).where(inArray(regulationsTable.id, regIds));
  const regById = new Map(regs.map((r) => [r.id, r]));

  const reqs = await db
    .select()
    .from(regulationCapabilityRequirementsTable)
    .where(inArray(regulationCapabilityRequirementsTable.regulationId, regIds));
  const reqsByReg = new Map<number, typeof reqs>();
  for (const r of reqs) {
    const arr = reqsByReg.get(r.regulationId) ?? [];
    arr.push(r);
    reqsByReg.set(r.regulationId, arr);
  }

  // Group by user so each user's org is looked up once.
  const byUser = new Map<string, typeof watches>();
  for (const w of watches) {
    const arr = byUser.get(w.userId) ?? [];
    arr.push(w);
    byUser.set(w.userId, arr);
  }

  const now = Date.now();
  const out: PendingTrigger[] = [];

  for (const [userId, userWatches] of byUser) {
    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.clerkUserId, userId))
      .orderBy(desc(organizationsTable.updatedAt))
      .limit(1);
    if (!org) continue;

    const caps = await db
      .select()
      .from(organizationCapabilitiesTable)
      .where(eq(organizationCapabilitiesTable.organizationId, org.id));
    const scoreByCap = new Map(caps.map((c) => [c.capabilityId, c.maturityScore]));

    for (const w of userWatches) {
      const reg = regById.get(w.regulationId);
      if (!reg) continue;
      const effective = reg.effectiveDate ? new Date(reg.effectiveDate).getTime() : null;
      if (effective == null || effective >= now) continue; // not yet past effective date

      const regReqs = reqsByReg.get(w.regulationId) ?? [];
      let assessed = 0;
      let compliant = 0;
      for (const r of regReqs) {
        const s = scoreByCap.get(r.capabilityId);
        if (s == null) continue;
        assessed++;
        if (s >= r.requiredMaturity) compliant++;
      }
      if (assessed === 0) continue;
      const compliancePct = Math.round((compliant / assessed) * 100);
      if (compliancePct >= REGULATION_COMPLIANCE_FLOOR_PCT) continue;

      const signalKey = `reg:${w.regulationId}:user:${userId}`;
      if (recent.has(makeKey("regulation_overdue", signalKey))) continue;

      const reason = `${reg.shortCode} is past effective date and compliance is ${compliancePct}% (floor: ${REGULATION_COMPLIANCE_FLOOR_PCT}%)`;
      const valueCase = `A watched regulation — ${reg.shortCode} (${reg.name}) — passed its effective date but the organization's compliance posture is only ${compliancePct}% across ${assessed} required capabilities. Investigate the unmet requirements, the regulatory risk exposure, comparable enforcement actions in 2024-2026, and a remediation sequence with realistic timelines and investment ranges.`;
      out.push({
        signalSource: "regulation_overdue",
        signalKey,
        userId,
        targetId: w.regulationId,
        industryId: null,
        clientLabel: `Auto-VCR: ${reg.shortCode} overdue`,
        reason,
        valueCase,
      });
    }
  }
  return out;
}

/**
 * Sign #3: portfolio company average capability CVI dropped ≥ 5 pts. Use
 * the company's fingerprint to average over the relevant capabilities.
 */
async function collectPortfolioCompanyTriggers(
  recent: Set<string>,
): Promise<PendingTrigger[]> {
  const portfolio = await db.select().from(portfolioCompaniesTable);
  if (portfolio.length === 0) return [];

  const sessionTokens = Array.from(new Set(portfolio.map((p) => p.sessionToken)));
  const userByToken = await resolveUserIdsBySessionToken(sessionTokens);

  const companyIds = Array.from(new Set(portfolio.map((p) => p.companyId)));
  const companies = await db.select().from(companiesTable).where(inArray(companiesTable.id, companyIds));
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const fingerprints = await db
    .select()
    .from(companyCapabilityFingerprintTable)
    .where(inArray(companyCapabilityFingerprintTable.companyId, companyIds));
  const fpByCompany = new Map<number, number[]>();
  for (const fp of fingerprints) {
    const arr = fpByCompany.get(fp.companyId) ?? [];
    arr.push(fp.capabilityId);
    fpByCompany.set(fp.companyId, arr);
  }

  const allCapIds = Array.from(new Set(fingerprints.map((f) => f.capabilityId)));
  const drops = await computeCapabilityDrops(allCapIds);

  const out: PendingTrigger[] = [];
  for (const p of portfolio) {
    const userId = userByToken.get(p.sessionToken);
    if (!userId) continue;
    const company = companyById.get(p.companyId);
    if (!company) continue;

    const capIds = fpByCompany.get(p.companyId) ?? [];
    if (capIds.length === 0) continue;

    // Average drop across the company's fingerprint capabilities.
    let totalDrop = 0;
    let totalStart = 0;
    let totalEnd = 0;
    let counted = 0;
    for (const capId of capIds) {
      const d = drops.get(capId);
      if (!d) continue;
      totalDrop += d.dropPoints;
      totalStart += d.start;
      totalEnd += d.end;
      counted++;
    }
    if (counted === 0) continue;
    const avgDrop = totalDrop / counted;
    if (avgDrop < PORTFOLIO_COMPANY_DROP_THRESHOLD_POINTS) continue;

    const signalKey = `company:${p.companyId}:user:${userId}`;
    if (recent.has(makeKey("portfolio_company_dip", signalKey))) continue;

    const avgStart = totalStart / counted;
    const avgEnd = totalEnd / counted;
    const reason = `${company.name} avg capability CVI fell ${avgDrop.toFixed(1)} pts across ${counted} capabilities (${avgStart.toFixed(1)} → ${avgEnd.toFixed(1)})`;
    const valueCase = `A portfolio company — ${company.name} (${company.country ?? "unknown geo"}, ${company.ownership ?? "ownership unknown"}) — has seen its average capability CVI drop ${avgDrop.toFixed(1)} points in the last ${HISTORY_LOOKBACK_DAYS} days (${avgStart.toFixed(1)} → ${avgEnd.toFixed(1)} averaged across ${counted} fingerprinted capabilities). Investigate the macroeconomic, competitive, and technology disruption drivers; identify which capabilities are dragging the most and why; and provide a recommended portfolio response (hold, double down, exit, hedge) with rationale.`;
    out.push({
      signalSource: "portfolio_company_dip",
      signalKey,
      userId,
      targetId: p.companyId,
      industryId: company.industryId,
      clientLabel: `Auto-VCR: ${company.name.slice(0, 80)}`,
      reason,
      valueCase,
    });
  }
  return out;
}

/**
 * Run a single trigger: create the VCR campaign, kick the first cycle, post
 * an inbox notification when the cycle's findings are persisted. Returns
 * whether the auto-VCR row was written.
 *
 * If any step fails after the ledger row is written we still leave the
 * ledger row in place — that's the dedupe key, and re-firing the same
 * signal an hour later (because the failure left the ledger empty) would
 * spam Perplexity. The user can see the half-completed campaign on the
 * VCR page and re-fire manually if needed.
 */
async function executeTrigger(t: PendingTrigger): Promise<boolean> {
  // 1. Create a 1-day, 1-cycle VCR campaign — auto-trigger is not a full 7-day
  //    engagement, it's a focused root-cause investigation.
  let campaignId: number;
  try {
    const created = await createCampaign({
      clientName: t.clientLabel,
      industryId: t.industryId ?? undefined,
      valueCase: t.valueCase,
      valueCaseSource: "typed",
      durationDays: 1,
      totalCycles: 1,
    });
    campaignId = created.id;
  } catch (err) {
    console.warn(`[AutoVcrTrigger] createCampaign failed for ${t.signalSource}/${t.signalKey}:`, err instanceof Error ? err.message : err);
    return false;
  }

  // 2. Record the trigger ledger row BEFORE running cycles (so a long-running
  //    cycle that crashes still leaves a dedupe record).
  await db.insert(autoVcrTriggersTable).values({
    signalSource: t.signalSource,
    signalKey: t.signalKey,
    userId: t.userId,
    targetId: t.targetId,
    reason: t.reason,
    vcrAssessmentId: campaignId,
  });

  // 3. Intake questions — fully LLM-generated, no human loop.
  try {
    await generateIntakeQuestions(campaignId);
  } catch (err) {
    console.warn(`[AutoVcrTrigger] generateIntakeQuestions failed for campaign ${campaignId}:`, err instanceof Error ? err.message : err);
    // Continue — runNextCycle works without intake answers; the LLM grounds
    // research in valueCase + objective alone.
  }

  // 4. Fire the first (and only) cycle end-to-end.
  let cycleSummary: string | null = null;
  let itemsCreated = 0;
  try {
    const r = await runNextCycle(campaignId);
    cycleSummary = r.summary;
    itemsCreated = r.itemsCreated;
  } catch (err) {
    console.warn(`[AutoVcrTrigger] runNextCycle failed for campaign ${campaignId}:`, err instanceof Error ? err.message : err);
  }

  // 5. Post member_notification (inbox + bell badge) summarizing the run.
  try {
    const summaryLine = cycleSummary?.trim() ?? "Auto-VCR campaign created; first cycle did not complete — review on /vcr.";
    const headLine = `Auto-VCR triggered: ${t.reason}`;
    const body = `${headLine}\n\n${summaryLine}\n\n${itemsCreated} finding(s) await review. Open VCR campaign #${campaignId} to drill in.`;
    await db.insert(memberNotificationsTable).values({
      userId: t.userId,
      type: "auto_vcr_complete",
      targetType: "vcr_assessment",
      targetId: campaignId,
      body,
    });
    await db
      .update(autoVcrTriggersTable)
      .set({ notifiedAt: new Date() })
      .where(eq(autoVcrTriggersTable.vcrAssessmentId, campaignId));
  } catch (err) {
    console.warn(`[AutoVcrTrigger] member_notification failed for campaign ${campaignId}:`, err instanceof Error ? err.message : err);
  }

  return true;
}

/**
 * Scheduler entrypoint. Scans all three signal sources, returns stats.
 * Caps to MAX_TRIGGERS_PER_TICK Perplexity-heavy campaigns per run so a
 * sudden flood (e.g. world-scan-driven 30-pt collapse across many caps)
 * doesn't blow out the LLM budget in one tick.
 */
export async function evaluateAutoVcrTriggers(): Promise<AutoVcrTriggerStats> {
  const stats: AutoVcrTriggerStats = { walked: 0, fired: 0, skippedRecent: 0, skippedCap: 0, errors: 0 };

  let recent: Set<string>;
  try {
    recent = await loadRecentTriggerKeys();
  } catch (err) {
    console.warn("[AutoVcrTrigger] loadRecentTriggerKeys failed:", err instanceof Error ? err.message : err);
    return stats;
  }

  let pending: PendingTrigger[] = [];
  try {
    const [a, b, c] = await Promise.all([
      collectCapabilityDropTriggers(recent),
      collectRegulationOverdueTriggers(recent),
      collectPortfolioCompanyTriggers(recent),
    ]);
    pending = [...a, ...b, ...c];
  } catch (err) {
    console.warn("[AutoVcrTrigger] candidate collection failed:", err instanceof Error ? err.message : err);
    stats.errors++;
    return stats;
  }

  stats.walked = pending.length;
  if (pending.length === 0) return stats;

  // Cost cap: rank pending triggers by signal strength (drop magnitude) and
  // take the top N. Without this a fresh deploy that has 100 stale watches
  // could fire 100 Perplexity-heavy campaigns in one tick.
  const ranked = pending.slice(0, MAX_TRIGGERS_PER_TICK);
  stats.skippedCap = pending.length - ranked.length;

  for (const t of ranked) {
    try {
      const ok = await executeTrigger(t);
      if (ok) stats.fired++;
      else stats.errors++;
    } catch (err) {
      stats.errors++;
      console.warn(
        `[AutoVcrTrigger] trigger ${t.signalSource}/${t.signalKey} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return stats;
}

/**
 * Lightweight introspection helper — exposed for an admin route or test.
 * Returns the count of triggers fired in the trailing 14-day dedupe window.
 */
export async function getRecentAutoVcrTriggerCount(): Promise<number> {
  const cutoff = new Date(Date.now() - TRIGGER_DEDUPE_WINDOW_MS);
  const rows = await db
    .select({ id: autoVcrTriggersTable.id })
    .from(autoVcrTriggersTable)
    .where(gte(autoVcrTriggersTable.firedAt, cutoff));
  return rows.length;
}

/**
 * Returns the most recent auto-VCR triggers (default 20). Joined to
 * vcr_assessments so callers can render the result-status alongside the
 * trigger metadata.
 */
export async function listRecentAutoVcrTriggers(limit = 20): Promise<Array<{
  id: number;
  signalSource: string;
  signalKey: string;
  userId: string;
  targetId: number | null;
  reason: string;
  vcrAssessmentId: number;
  firedAt: Date;
  notifiedAt: Date | null;
  assessmentStatus: string | null;
  findingsCount: number;
}>> {
  const rows = await db
    .select({
      id: autoVcrTriggersTable.id,
      signalSource: autoVcrTriggersTable.signalSource,
      signalKey: autoVcrTriggersTable.signalKey,
      userId: autoVcrTriggersTable.userId,
      targetId: autoVcrTriggersTable.targetId,
      reason: autoVcrTriggersTable.reason,
      vcrAssessmentId: autoVcrTriggersTable.vcrAssessmentId,
      firedAt: autoVcrTriggersTable.firedAt,
      notifiedAt: autoVcrTriggersTable.notifiedAt,
      assessmentStatus: vcrAssessmentsTable.status,
    })
    .from(autoVcrTriggersTable)
    .leftJoin(vcrAssessmentsTable, eq(autoVcrTriggersTable.vcrAssessmentId, vcrAssessmentsTable.id))
    .orderBy(desc(autoVcrTriggersTable.firedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const assessmentIds = rows.map((r) => r.vcrAssessmentId);
  const items = await db
    .select({ assessmentId: vcrResearchItemsTable.assessmentId })
    .from(vcrResearchItemsTable)
    .where(inArray(vcrResearchItemsTable.assessmentId, assessmentIds));
  const findingsByAssessment = new Map<number, number>();
  for (const i of items) {
    findingsByAssessment.set(i.assessmentId, (findingsByAssessment.get(i.assessmentId) ?? 0) + 1);
  }

  return rows.map((r) => ({
    ...r,
    findingsCount: findingsByAssessment.get(r.vcrAssessmentId) ?? 0,
  }));
}
