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
 * Apply (or re-apply) a schema to a Dataset by inferring it from the latest
 * committed CSV transaction. Foundry's CSV upload writes the file but does NOT
 * auto-attach a schema — without one, the Dataset's columns aren't queryable
 * and Object Type "Backing column" dropdowns are empty.
 *
 * Schema inference requires the latest committed transaction RID. Earlier
 * version of this function omitted that and the inference endpoint silently
 * no-op'd (200 OK with no schema attached). This version queries the latest
 * committed transaction first, then runs inference against it, then verifies
 * the schema actually landed by reading it back.
 */

interface DatasetTransactionsResponse {
  data: Array<{ rid: string; transactionType: string; status: string }>;
}

export async function getLatestCommittedTransactionRid(datasetRid: string, branch = "master"): Promise<string | null> {
  try {
    const r = await foundryJson<DatasetTransactionsResponse>(
      `/api/v2/datasets/${datasetRid}/transactions?branchName=${encodeURIComponent(branch)}&pageSize=20`,
    );
    const committed = r.data.find((t) => t.status === "COMMITTED");
    return committed?.rid ?? null;
  } catch {
    return null;
  }
}

interface DatasetSchemaResponse {
  fieldSchemaList?: Array<{ name: string }>;
  data?: { fieldSchemaList?: Array<{ name: string }> };
}

export async function getDatasetSchemaColumnCount(datasetRid: string, branch = "master"): Promise<number> {
  try {
    const r = await foundryJson<DatasetSchemaResponse>(
      `/api/v2/datasets/${datasetRid}/schemas/${branch}?preview=true`,
    );
    return (r.fieldSchemaList ?? r.data?.fieldSchemaList ?? []).length;
  } catch {
    return 0;
  }
}

export async function applySchemaFromCsv(datasetRid: string, branch = "master"): Promise<{ ok: boolean; via?: string; columns?: number; error?: string }> {
  const txRid = await getLatestCommittedTransactionRid(datasetRid, branch);
  if (!txRid) return { ok: false, error: "no committed transaction found on dataset" };

  // Try 1: foundry-schema-inference with explicit endTransactionRid + parser=CSV
  try {
    await foundryFetch(
      `/foundry-schema-inference/api/datasets/${datasetRid}/branches/${encodeURIComponent(branch)}/schema?endTransactionRid=${txRid}&parser=CSV`,
      { method: "POST", body: "{}" },
    );
    const columns = await getDatasetSchemaColumnCount(datasetRid, branch);
    if (columns > 0) return { ok: true, via: "schema-inference", columns };
  } catch { /* fall through */ }

  // Try 2: v2 schemas endpoint with branchName + endTransactionRid in body
  try {
    await foundryFetch(
      `/api/v2/datasets/${datasetRid}/schemas?preview=true`,
      {
        method: "POST",
        body: JSON.stringify({ branchName: branch, endTransactionRid: txRid, parser: "CSV" }),
      },
    );
    const columns = await getDatasetSchemaColumnCount(datasetRid, branch);
    if (columns > 0) return { ok: true, via: "v2-schemas", columns };
  } catch { /* fall through */ }

  // Try 3: foundry-metadata schema PUT with explicit empty fieldSchemaList → triggers inference
  try {
    await foundryFetch(
      `/foundry-metadata/api/schemas/datasets/${datasetRid}/branches/${branch}?endTransactionRid=${txRid}`,
      {
        method: "PUT",
        body: JSON.stringify({
          schema: {
            fieldSchemaList: [],
            primaryKey: null,
            customMetadata: { format: "csv", "options.header": "true" },
          },
        }),
      },
    );
    const columns = await getDatasetSchemaColumnCount(datasetRid, branch);
    if (columns > 0) return { ok: true, via: "metadata-schema", columns };
  } catch { /* fall through */ }

  return { ok: false, error: `tried 3 endpoints with txRid=${txRid}, none attached a schema (verified via column-count read-back)` };
}

/**
 * Replace a Dataset's contents with a single CSV file. Snapshot transaction so
 * each sync produces a clean, full-table view (no append/dedup logic needed).
 * After commit, attempts schema auto-apply so the Dataset is immediately
 * queryable as a table — without this step Object Type "Backing column"
 * dropdowns stay empty.
 */
export async function replaceDatasetCsv(datasetRid: string, csvBody: string, fileName = "data.csv"): Promise<void> {
  const txn = await startTransaction(datasetRid, "SNAPSHOT");
  try {
    await uploadFile(datasetRid, txn, fileName, csvBody, "text/csv");
    await commitTransaction(datasetRid, txn);
    // Apply schema as best-effort. Failure is logged but does not break the
    // upload — the data is committed regardless, so worst case the user
    // applies schema manually in the Foundry UI.
    const schemaResult = await applySchemaFromCsv(datasetRid);
    if (!schemaResult.ok) {
      console.warn(`[foundry] schema auto-apply failed for ${datasetRid}: ${schemaResult.error}`);
    }
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
