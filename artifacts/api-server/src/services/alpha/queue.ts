import { db, enrichmentJobsTable, capabilitiesTable, type EnrichmentJob } from "@workspace/db";
import { eq, and, lt, inArray, sql } from "drizzle-orm";
import { logger as log } from "../../lib/logger";
import { runAlphaEnrichment, runDetailEnrichment } from "./enrich";

async function setCapabilityEnrichment(
  capabilityId: number,
  status: string,
  stage: string | null,
  error: string | null,
): Promise<void> {
  try {
    await db
      .update(capabilitiesTable)
      .set({
        enrichmentStatus: status,
        enrichmentStage: stage,
        enrichmentError: error,
        enrichmentUpdatedAt: new Date(),
      })
      .where(eq(capabilitiesTable.id, capabilityId));
  } catch (e) {
    log.error({ capabilityId, err: String(e) }, "[queue] failed to update capability enrichment status");
  }
}

export type EnrichmentJobType = "alpha" | "detail";

export interface AlphaPayload {
  industryId?: number;
  limitCapabilities?: number;
  limitEdges?: number;
}

export interface DetailPayload {
  capabilityId?: number;
  limit?: number;
  force?: boolean;
  revisionGuidance?: string;
}

export async function enqueueEnrichmentJob(
  jobType: EnrichmentJobType,
  payload: AlphaPayload | DetailPayload,
  opts: { capabilityId?: number; industryId?: number } = {},
): Promise<EnrichmentJob> {
  const [row] = await db
    .insert(enrichmentJobsTable)
    .values({
      jobType,
      payload: payload as Record<string, unknown>,
      capabilityId: opts.capabilityId ?? null,
      industryId: opts.industryId ?? null,
      status: "queued",
    })
    .returning();
  log.info(
    { jobId: row.id, jobType, capabilityId: opts.capabilityId ?? null },
    "[queue] job enqueued",
  );
  notifyWorker();
  return row;
}

export async function getQueuePositionFor(
  capabilityId: number,
): Promise<{ jobId: number; status: string; ahead: number } | null> {
  const [job] = await db
    .select()
    .from(enrichmentJobsTable)
    .where(
      and(
        eq(enrichmentJobsTable.capabilityId, capabilityId),
        inArray(enrichmentJobsTable.status, ["queued", "running"]),
      ),
    )
    .orderBy(enrichmentJobsTable.id)
    .limit(1);
  if (!job) return null;
  if (job.status === "running") {
    return { jobId: job.id, status: "running", ahead: 0 };
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enrichmentJobsTable)
    .where(
      and(
        inArray(enrichmentJobsTable.status, ["queued", "running"]),
        lt(enrichmentJobsTable.id, job.id),
      ),
    );
  return { jobId: job.id, status: "queued", ahead: Number(count) };
}

let workerStarted = false;
let workerWake: (() => void) | null = null;

function notifyWorker(): void {
  if (workerWake) workerWake();
}

interface RawJobRow {
  id: number;
  job_type: string;
  payload: Record<string, unknown> | null;
  status: string;
  capability_id: number | null;
  industry_id: number | null;
  attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

function mapRawJob(row: RawJobRow): EnrichmentJob {
  return {
    id: row.id,
    jobType: row.job_type,
    payload: row.payload ?? {},
    status: row.status,
    capabilityId: row.capability_id,
    industryId: row.industry_id,
    attempts: row.attempts,
    error: row.error,
    result: row.result,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  } as EnrichmentJob;
}

async function claimNextJob(): Promise<EnrichmentJob | null> {
  // Atomically grab the oldest queued job. Using FOR UPDATE SKIP LOCKED so
  // multiple worker processes (if ever scaled out) won't double-claim.
  const result = await db.execute(sql`
    UPDATE enrichment_jobs
       SET status = 'running',
           started_at = now(),
           attempts = attempts + 1
     WHERE id = (
       SELECT id FROM enrichment_jobs
        WHERE status = 'queued'
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *
  `);
  const rows = ((result as unknown as { rows: RawJobRow[] }).rows ?? []);
  return rows.length > 0 ? mapRawJob(rows[0]) : null;
}

async function runJob(job: EnrichmentJob): Promise<void> {
  const start = Date.now();
  log.info({ jobId: job.id, jobType: job.jobType }, "[queue] job starting");
  const stage = job.jobType === "alpha" ? "alpha" : "detail";
  if (job.capabilityId != null) {
    await setCapabilityEnrichment(job.capabilityId, "running", stage, null);
  }
  try {
    let result: Record<string, unknown>;
    if (job.jobType === "alpha") {
      const p = (job.payload ?? {}) as AlphaPayload;
      const r = await runAlphaEnrichment({
        industryId: p.industryId,
        limitCapabilities: p.limitCapabilities,
        limitEdges: p.limitEdges,
      });
      result = r as unknown as Record<string, unknown>;
      if (job.capabilityId != null) {
        const errs = (r.errors ?? []) as string[];
        if (r.capabilitiesEnriched === 0 && errs.length > 0) {
          await setCapabilityEnrichment(job.capabilityId, "failed", "alpha", `alpha: ${errs[0].slice(0, 300)}`);
        }
        // Otherwise leave as 'running' — the queued detail job will advance the status.
      }
    } else if (job.jobType === "detail") {
      const p = (job.payload ?? {}) as DetailPayload;
      const r = await runDetailEnrichment({
        capabilityId: p.capabilityId,
        limit: p.limit,
        force: p.force,
        revisionGuidance: p.revisionGuidance,
      });
      result = r as unknown as Record<string, unknown>;
      if (job.capabilityId != null) {
        const errs = (r.errors ?? []) as string[];
        if (r.enriched === 0 && errs.length > 0) {
          await setCapabilityEnrichment(job.capabilityId, "failed", "detail", `detail: ${errs[0].slice(0, 300)}`);
        } else {
          await setCapabilityEnrichment(job.capabilityId, "ready", "done", null);
        }
      }
    } else {
      throw new Error(`Unknown jobType: ${job.jobType}`);
    }
    await db
      .update(enrichmentJobsTable)
      .set({ status: "completed", completedAt: new Date(), result })
      .where(eq(enrichmentJobsTable.id, job.id));
    log.info(
      { jobId: job.id, durationMs: Date.now() - start },
      "[queue] job completed",
    );
  } catch (err) {
    const message = String(err).slice(0, 1000);
    await db
      .update(enrichmentJobsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        error: message,
      })
      .where(eq(enrichmentJobsTable.id, job.id));
    if (job.capabilityId != null) {
      await setCapabilityEnrichment(job.capabilityId, "failed", stage, `${stage}: ${message.slice(0, 300)}`);
    }
    log.error(
      { jobId: job.id, err: message, durationMs: Date.now() - start },
      "[queue] job failed",
    );
  }
}

async function workerLoop(): Promise<void> {
  log.info("[queue] worker loop started");
  // On boot, requeue any 'running' jobs that were abandoned by a crashed
  // process. We're a single-worker process, so anything still 'running' must
  // be a leftover from a prior invocation.
  try {
    const requeued = await db
      .update(enrichmentJobsTable)
      .set({ status: "queued", startedAt: null })
      .where(eq(enrichmentJobsTable.status, "running"))
      .returning({ id: enrichmentJobsTable.id });
    if (requeued.length > 0) {
      log.warn(
        { count: requeued.length, ids: requeued.map((r) => r.id) },
        "[queue] requeued abandoned 'running' jobs from prior process",
      );
    }
  } catch (err) {
    log.error({ err: String(err) }, "[queue] failed to requeue abandoned jobs");
  }

  // Forever: drain queue, then sleep until notified or 30s timeout.
  while (true) {
    let job: EnrichmentJob | null = null;
    try {
      job = await claimNextJob();
    } catch (err) {
      log.error({ err: String(err) }, "[queue] claimNextJob failed");
    }
    if (job) {
      await runJob(job);
      continue;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        workerWake = null;
        resolve();
      }, 30_000);
      workerWake = () => {
        clearTimeout(timer);
        workerWake = null;
        resolve();
      };
    });
  }
}

export function startEnrichmentWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  workerLoop().catch((err) => {
    log.error({ err: String(err) }, "[queue] worker loop crashed");
    workerStarted = false;
  });
}
