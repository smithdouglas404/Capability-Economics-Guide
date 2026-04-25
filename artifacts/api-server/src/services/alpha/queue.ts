import { db, capabilitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Queue, Worker, type Job } from "bullmq";
import { logger as log } from "../../lib/logger";
import { runAlphaEnrichment, runDetailEnrichment } from "./enrich";
import { getRedis, isRedisConfigured } from "./redis";

const QUEUE_NAME = "enrichment";

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

export interface EnrichmentJobData {
  jobType: EnrichmentJobType;
  payload: AlphaPayload | DetailPayload;
  capabilityId: number | null;
  industryId: number | null;
}

export interface EnrichmentJobResult {
  id: number;
  jobType: EnrichmentJobType;
  payload: AlphaPayload | DetailPayload;
  status: string;
  capabilityId: number | null;
  industryId: number | null;
}

let queueInstance: Queue<EnrichmentJobData> | null = null;
let workerInstance: Worker<EnrichmentJobData> | null = null;

function getQueueInternal(): Queue<EnrichmentJobData> {
  if (queueInstance) return queueInstance;
  queueInstance = new Queue<EnrichmentJobData>(QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      // removeOnComplete: true — drop completed jobs immediately so the
      // deterministic jobId (`alpha-ind-1`, `cap-42`, etc.) is freed for
      // re-enqueue on the next scheduler tick or admin click. Without this,
      // BullMQ keeps completed jobs in Redis and silently collapses every
      // future add() with the same jobId, so the queue *appears* to enqueue
      // but the worker never sees the new payload. Dedupe protection for
      // in-flight work is preserved — BullMQ still rejects duplicates
      // against `active`/`waiting` states regardless of this setting.
      removeOnComplete: true,
      // removeOnFail: true — drop failed jobs immediately so a single
      // poison job doesn't permanently block the deterministic jobId from
      // being re-enqueued. Retry attempts (3 above) still happen before this
      // takes effect.
      removeOnFail: true,
    },
  });
  return queueInstance;
}

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

export async function enqueueEnrichmentJob(
  jobType: EnrichmentJobType,
  payload: AlphaPayload | DetailPayload,
  opts: { capabilityId?: number; industryId?: number } = {},
): Promise<EnrichmentJobResult> {
  if (!isRedisConfigured()) {
    throw new Error("REDIS_URL is not configured. Cannot enqueue enrichment job.");
  }
  const data: EnrichmentJobData = {
    jobType,
    payload,
    capabilityId: opts.capabilityId ?? null,
    industryId: opts.industryId ?? null,
  };
  // Deterministic jobId so a duplicate click or cron-tick enqueue is silently
  // collapsed by BullMQ (add() returns the existing job rather than creating
  // a second one). Scopes to capability → industry → global so the three
  // natural call patterns don't collide. BullMQ disallows `:` in custom
  // jobIds (reserved as Redis key separator), so we use dashes.
  const scope = opts.capabilityId != null
    ? `cap-${opts.capabilityId}`
    : opts.industryId != null
      ? `ind-${opts.industryId}`
      : "all";
  const jobId = `${jobType}-${scope}`;
  const job = await getQueueInternal().add(jobType, data, { jobId });
  const numericId = job.id ? Number(job.id) : Date.now();
  log.info(
    { jobId: numericId, jobType, capabilityId: opts.capabilityId ?? null },
    "[queue] job enqueued",
  );
  return {
    id: numericId,
    jobType,
    payload,
    status: "queued",
    capabilityId: data.capabilityId,
    industryId: data.industryId,
  };
}

export async function getQueuePositionFor(
  capabilityId: number,
): Promise<{ jobId: number; status: string; ahead: number } | null> {
  if (!isRedisConfigured()) return null;
  const q = getQueueInternal();
  const [active, waiting, delayed] = await Promise.all([
    q.getJobs(["active"], 0, 200, true),
    q.getJobs(["waiting", "waiting-children", "paused"], 0, 500, true),
    q.getJobs(["delayed"], 0, 500, true),
  ]);
  const matchInActive = active.find((j) => j.data?.capabilityId === capabilityId);
  if (matchInActive) {
    return { jobId: Number(matchInActive.id ?? 0), status: "running", ahead: 0 };
  }
  const queue = [...waiting, ...delayed];
  const idx = queue.findIndex((j) => j.data?.capabilityId === capabilityId);
  if (idx === -1) return null;
  return { jobId: Number(queue[idx].id ?? 0), status: "queued", ahead: idx };
}

async function processJob(job: Job<EnrichmentJobData>): Promise<Record<string, unknown>> {
  const start = Date.now();
  const { jobType, payload, capabilityId } = job.data;
  log.info({ jobId: job.id, jobType, attempt: job.attemptsMade + 1 }, "[queue] job starting");
  const stage = jobType === "alpha" ? "alpha" : "detail";
  if (capabilityId != null) {
    await setCapabilityEnrichment(capabilityId, "running", stage, null);
  }
  // BullMQ automatically renews the worker lock every lockDuration/2 by
  // default — no custom heartbeat needed. (Earlier version had one; it was
  // redundant and the setInterval callback could throw, killing the worker.)
  try {
    if (jobType === "alpha") {
      const p = payload as AlphaPayload;
      const r = await runAlphaEnrichment({
        industryId: p.industryId,
        limitCapabilities: p.limitCapabilities,
        limitEdges: p.limitEdges,
      });
      if (capabilityId != null) {
        const errs = (r.errors ?? []) as string[];
        if (r.capabilitiesEnriched === 0 && errs.length > 0) {
          await setCapabilityEnrichment(capabilityId, "failed", "alpha", `alpha: ${errs[0].slice(0, 300)}`);
        }
      }
      log.info({ jobId: job.id, durationMs: Date.now() - start }, "[queue] job completed");
      return r as unknown as Record<string, unknown>;
    } else if (jobType === "detail") {
      const p = payload as DetailPayload;
      const r = await runDetailEnrichment({
        capabilityId: p.capabilityId,
        limit: p.limit,
        force: p.force,
        revisionGuidance: p.revisionGuidance,
      });
      if (capabilityId != null) {
        const errs = (r.errors ?? []) as string[];
        if (r.enriched === 0 && errs.length > 0) {
          await setCapabilityEnrichment(capabilityId, "failed", "detail", `detail: ${errs[0].slice(0, 300)}`);
        } else {
          await setCapabilityEnrichment(capabilityId, "ready", "done", null);
        }
      }
      log.info({ jobId: job.id, durationMs: Date.now() - start }, "[queue] job completed");
      return r as unknown as Record<string, unknown>;
    } else {
      throw new Error(`Unknown jobType: ${jobType}`);
    }
  } catch (err) {
    const message = String(err).slice(0, 1000);
    if (capabilityId != null) {
      await setCapabilityEnrichment(capabilityId, "failed", stage, `${stage}: ${message.slice(0, 300)}`);
    }
    log.error({ jobId: job.id, err: message, durationMs: Date.now() - start }, "[queue] job failed");
    throw err;
  }
}

export function startEnrichmentWorker(): void {
  if (workerInstance) return;
  if (!isRedisConfigured()) {
    log.warn("[queue] REDIS_URL not configured — enrichment worker NOT started");
    return;
  }

  // One-shot cleanup of zombie completed jobs from before the
  // removeOnComplete:true change. Without this, the deterministic jobIds
  // (alpha-ind-1, etc.) stay claimed in Redis for up to 24h and dedupe
  // every fresh enqueue. Running this on every boot is harmless —
  // queue.clean() is idempotent and only touches the requested status.
  void getQueueInternal().clean(0, 1000, "completed").then(removed => {
    if (removed.length > 0) log.info({ removed: removed.length }, "[queue] purged stale completed jobs");
  }).catch(err => log.warn({ err: String(err) }, "[queue] startup clean failed"));

  workerInstance = new Worker<EnrichmentJobData>(
    QUEUE_NAME,
    processJob,
    {
      connection: getRedis(),
      concurrency: 1,
      // 15 min — our per-capability Perplexity + GLM round-trip can push
      // past 5 min during provider slowness. Short locks led to BullMQ
      // considering the job stalled and re-assigning it mid-run, which
      // caused double-writes. Heartbeats via job.extendLock in processJob
      // keep this safe for even longer batches.
      lockDuration: 15 * 60 * 1000,
    },
  );
  workerInstance.on("ready", () => log.info("[queue] BullMQ worker ready"));
  workerInstance.on("failed", (job, err) => {
    log.warn(
      { jobId: job?.id, attempts: job?.attemptsMade, willRetry: (job?.attemptsMade ?? 0) < (job?.opts?.attempts ?? 1), err: String(err).slice(0, 300) },
      "[queue] job attempt failed",
    );
  });
  workerInstance.on("error", (err) => log.error({ err: String(err) }, "[queue] worker error"));
  log.info("[queue] BullMQ worker started (Redis-backed, concurrency=1)");
}

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export async function getQueueStats(): Promise<QueueStats> {
  if (!isRedisConfigured()) {
    return { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
  }
  const q = getQueueInternal();
  const counts = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  return {
    waiting: Number(counts.waiting ?? 0),
    active: Number(counts.active ?? 0),
    delayed: Number(counts.delayed ?? 0),
    failed: Number(counts.failed ?? 0),
    completed: Number(counts.completed ?? 0),
  };
}
