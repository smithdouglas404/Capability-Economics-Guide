/**
 * Data exports — point-in-time CSV / Parquet snapshots of CE datasets.
 *
 * Quants and Data License customers want raw rows, not dashboards. This
 * module exposes a small catalog of canned datasets and produces:
 *   - CSV  (any tier with export entitlement)
 *   - Parquet (Platform / Data License tiers)
 *
 * Each export is tagged with a `snapshotId` (ISO timestamp + dataset id +
 * row count, sha-256 short hash) so two downloads of the same dataset at
 * the same instant are bit-identical and reproducible.
 *
 * Streaming exports + custom queries are intentionally out of scope — see
 * the Data License REST API task.
 */

import { createHash } from "node:crypto";
import {
  db,
  cviSnapshotsTable,
  capabilityEconomicsTable,
  capabilityQuadrantsTable,
  valueChainStagesTable,
  capabilityDependenciesTable,
  macroEventsTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";
import { parquetWriteBuffer, type BasicType } from "hyparquet-writer";
import { toCsv } from "./foundry/client";

export type DatasetId =
  | "cvi_snapshots"
  | "capability_metrics"
  | "macro_events"
  | "value_chain_stages"
  | "capability_dependencies";

export interface DatasetSpec {
  id: DatasetId;
  label: string;
  description: string;
  /** Logical column ordering used in both CSV and Parquet outputs. */
  columns: string[];
  /** Per-column parquet types. Defaults to STRING when omitted. */
  parquetTypes: Partial<Record<string, BasicType>>;
}

export const DATASETS: Record<DatasetId, DatasetSpec> = {
  cvi_snapshots: {
    id: "cvi_snapshots",
    label: "CEI snapshots",
    description: "Capability Economics Index — overall index, breakdowns, sentiment, volatility.",
    columns: ["id", "overallIndex", "overallCiLow", "overallCiHigh", "marketSentiment", "volatility", "methodologyVersion", "industryBreakdowns", "snapshotAt"],
    parquetTypes: {
      id: "INT64",
      overallIndex: "DOUBLE",
      overallCiLow: "DOUBLE",
      overallCiHigh: "DOUBLE",
      marketSentiment: "DOUBLE",
      volatility: "DOUBLE",
      methodologyVersion: "STRING",
      industryBreakdowns: "JSON",
      snapshotAt: "TIMESTAMP",
    },
  },
  capability_metrics: {
    id: "capability_metrics",
    label: "Capability metrics",
    description: "Per-capability TAM/SAM, half-life, consensus quadrant, scores.",
    columns: ["id", "capabilityId", "industryId", "tamUsdMm", "samUsdMm", "marginStructurePct", "halfLifeMonths", "commoditizationVelocity", "revenueExposureMm", "consensusQuadrant", "consensusConfidence", "aiExposureScore", "aiTimeToDisplacementMonths", "generatedAt"],
    parquetTypes: {
      id: "INT64", capabilityId: "INT64", industryId: "INT64",
      tamUsdMm: "DOUBLE", samUsdMm: "DOUBLE", marginStructurePct: "DOUBLE",
      halfLifeMonths: "DOUBLE", commoditizationVelocity: "DOUBLE",
      revenueExposureMm: "DOUBLE", consensusQuadrant: "STRING",
      consensusConfidence: "DOUBLE", aiExposureScore: "DOUBLE",
      aiTimeToDisplacementMonths: "DOUBLE", generatedAt: "TIMESTAMP",
    },
  },
  macro_events: {
    id: "macro_events",
    label: "Macro events",
    description: "Macro shocks tagged by industry/capability with severity + decay.",
    columns: ["id", "eventType", "severity", "title", "description", "affectedIndustryIds", "affectedCapabilityIds", "sentimentDirection", "startedAt", "decayDays", "source", "citations", "createdAt"],
    parquetTypes: {
      id: "INT64", eventType: "STRING", severity: "DOUBLE",
      title: "STRING", description: "STRING",
      affectedIndustryIds: "JSON", affectedCapabilityIds: "JSON",
      sentimentDirection: "STRING", startedAt: "TIMESTAMP",
      decayDays: "DOUBLE", source: "STRING", citations: "JSON",
      createdAt: "TIMESTAMP",
    },
  },
  value_chain_stages: {
    id: "value_chain_stages",
    label: "Value chain stages",
    description: "Per-industry value chain stages with HHI, patent/startup/capital trends.",
    columns: ["id", "industryId", "stageName", "stageOrder", "numSectors", "hhiScore", "patentCount", "patentTrendPct", "startupCount", "startupTrendPct", "capitalFlowMm", "capitalTrendPct", "generatedAt"],
    parquetTypes: {
      id: "INT64", industryId: "INT64", stageName: "STRING",
      stageOrder: "INT32", numSectors: "INT32", hhiScore: "DOUBLE",
      patentCount: "INT32", patentTrendPct: "DOUBLE",
      startupCount: "INT32", startupTrendPct: "DOUBLE",
      capitalFlowMm: "DOUBLE", capitalTrendPct: "DOUBLE",
      generatedAt: "TIMESTAMP",
    },
  },
  capability_dependencies: {
    id: "capability_dependencies",
    label: "Capability dependencies",
    description: "Capability → capability dependency graph with edge strength.",
    columns: ["id", "capabilityId", "dependsOnId", "strength"],
    parquetTypes: {
      id: "INT64", capabilityId: "INT64", dependsOnId: "INT64", strength: "STRING",
    },
  },
};

export function listDatasets(): Array<Pick<DatasetSpec, "id" | "label" | "description">> {
  return Object.values(DATASETS).map(d => ({ id: d.id, label: d.label, description: d.description }));
}

async function fetchRows(id: DatasetId): Promise<Array<Record<string, unknown>>> {
  switch (id) {
    case "cvi_snapshots":
      return db.select().from(cviSnapshotsTable).orderBy(desc(cviSnapshotsTable.id));
    case "capability_metrics":
      return db.select().from(capabilityEconomicsTable).orderBy(desc(capabilityEconomicsTable.id));
    case "macro_events":
      return db.select().from(macroEventsTable).orderBy(desc(macroEventsTable.id));
    case "value_chain_stages":
      return db.select().from(valueChainStagesTable).orderBy(desc(valueChainStagesTable.id));
    case "capability_dependencies":
      return db.select().from(capabilityDependenciesTable).orderBy(desc(capabilityDependenciesTable.id));
  }
  // Exhaustive — TS will complain if a DatasetId is added without a branch.
  const _exhaustive: never = id;
  void _exhaustive;
  return [];
}

export interface ExportPayload {
  filename: string;
  contentType: string;
  body: Buffer;
  snapshotId: string;
  rowCount: number;
}

/**
 * Build a deterministic snapshotId from the dataset id, generation timestamp
 * (truncated to the second), and the row count. Two downloads issued in the
 * same second produce the same id; later downloads change as data changes.
 */
function buildSnapshotId(datasetId: DatasetId, generatedAt: Date, rowCount: number): string {
  const isoSec = generatedAt.toISOString().replace(/\.\d{3}/, "");
  const hash = createHash("sha256")
    .update(`${datasetId}|${isoSec}|${rowCount}`)
    .digest("hex")
    .slice(0, 12);
  return `${datasetId}-${isoSec.replace(/[:.]/g, "")}-${hash}`;
}

function rowToParquetCell(value: unknown, type: BasicType | undefined): unknown {
  if (value == null) return null;
  if (type === "JSON") {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  if (type === "TIMESTAMP") {
    if (value instanceof Date) return value;
    const d = new Date(value as string | number);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (type === "INT32" || type === "INT64") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return type === "INT64" ? BigInt(Math.trunc(n)) : Math.trunc(n);
  }
  if (type === "DOUBLE" || type === "FLOAT") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "BOOLEAN") return Boolean(value);
  // STRING and the unspecified default
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function buildCsvExport(id: DatasetId): Promise<ExportPayload> {
  const spec = DATASETS[id];
  const rows = await fetchRows(id);
  const csv = toCsv(rows, spec.columns);
  const generatedAt = new Date();
  const snapshotId = buildSnapshotId(id, generatedAt, rows.length);
  return {
    filename: `${snapshotId}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: Buffer.from(csv, "utf8"),
    snapshotId,
    rowCount: rows.length,
  };
}

export async function buildParquetExport(id: DatasetId): Promise<ExportPayload> {
  const spec = DATASETS[id];
  const rows = await fetchRows(id);
  const generatedAt = new Date();
  const snapshotId = buildSnapshotId(id, generatedAt, rows.length);

  const columnData = spec.columns.map(col => {
    const type: BasicType = spec.parquetTypes[col] ?? "STRING";
    const data = rows.map(r => rowToParquetCell(r[col], type));
    return { name: col, data, type, nullable: true };
  });

  const arrayBuffer = parquetWriteBuffer({
    columnData,
    kvMetadata: [
      { key: "snapshotId", value: snapshotId },
      { key: "datasetId", value: id },
      { key: "generatedAt", value: generatedAt.toISOString() },
      { key: "rowCount", value: String(rows.length) },
    ],
  });

  return {
    filename: `${snapshotId}.parquet`,
    contentType: "application/vnd.apache.parquet",
    body: Buffer.from(arrayBuffer),
    snapshotId,
    rowCount: rows.length,
  };
}
