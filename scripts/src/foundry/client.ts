/**
 * Foundry HTTP client — thin fetch wrapper with bearer auth.
 *
 * No OSDK dependency yet — Foundry's public REST surface (v2) covers everything
 * we need (Datasets, Ontologies, Functions, AIP). Add @osdk/client later if
 * we want typed Object Type access.
 */

import { FOUNDRY } from "./config";

export async function foundryFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${FOUNDRY.baseUrl}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${FOUNDRY.token}`);
  if (init.body && !headers.has("Content-Type") && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const resp = await fetch(url, { ...init, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Foundry ${init.method ?? "GET"} ${path} ${resp.status}: ${body.slice(0, 500)}`);
  }
  return resp;
}

export async function foundryJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const resp = await foundryFetch(path, init);
  return resp.json() as Promise<T>;
}

// ── Dataset transaction helpers ────────────────────────────────────────────
// Foundry Datasets are versioned via transactions. To replace contents:
//   1. start transaction (type SNAPSHOT)
//   2. upload file(s) into the transaction
//   3. commit
// The v2 endpoints follow this pattern.

interface TransactionResponse { rid: string; transactionType: string; status: string }

export async function startTransaction(datasetRid: string, type: "APPEND" | "SNAPSHOT" | "UPDATE" | "DELETE" = "SNAPSHOT"): Promise<string> {
  const resp = await foundryJson<TransactionResponse>(
    `/api/v2/datasets/${datasetRid}/transactions`,
    { method: "POST", body: JSON.stringify({ transactionType: type }) },
  );
  return resp.rid;
}

export async function uploadFile(
  datasetRid: string,
  transactionRid: string,
  path: string,
  body: string | Uint8Array,
  contentType = "text/csv",
): Promise<void> {
  const url = `${FOUNDRY.baseUrl}/api/v2/datasets/${datasetRid}/files/${encodeURIComponent(path)}/upload?transactionRid=${transactionRid}&preview=true`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${FOUNDRY.token}`, "Content-Type": contentType },
    body,
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`upload ${datasetRid}/${path} ${resp.status}: ${errBody.slice(0, 500)}`);
  }
}

export async function commitTransaction(datasetRid: string, transactionRid: string): Promise<void> {
  await foundryFetch(
    `/api/v2/datasets/${datasetRid}/transactions/${transactionRid}/commit`,
    { method: "POST" },
  );
}

export async function abortTransaction(datasetRid: string, transactionRid: string): Promise<void> {
  await foundryFetch(
    `/api/v2/datasets/${datasetRid}/transactions/${transactionRid}/abort`,
    { method: "POST" },
  ).catch(() => undefined);
}

/**
 * Replace a Dataset's contents with a single CSV file. Snapshot transaction so
 * each sync produces a clean, full-table view (no append/dedup logic needed).
 */
export async function replaceDatasetCsv(datasetRid: string, csvBody: string, fileName = "data.csv"): Promise<void> {
  const txn = await startTransaction(datasetRid, "SNAPSHOT");
  try {
    await uploadFile(datasetRid, txn, fileName, csvBody, "text/csv");
    await commitTransaction(datasetRid, txn);
  } catch (err) {
    await abortTransaction(datasetRid, txn);
    throw err;
  }
}

// ── CSV helpers — minimal escape, handles strings/numbers/null/booleans/dates
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const escape = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
    const s = String(v);
    if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map(c => escape(r[c])).join(","));
  return lines.join("\n");
}
