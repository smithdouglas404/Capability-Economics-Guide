/**
 * One-shot importer: pushes every `dify-workflows/*.yml` DSL into the
 * configured Dify instance via Console API, then writes the
 * slug → app-id mapping into `dify_workflow_registry`. Re-running is
 * idempotent — skips any YAML whose SHA-256 hasn't changed since the last
 * import.
 *
 * Auth: Dify's import endpoint lives on the Console API, which uses
 * cookie-based session auth (NOT the workspace Service API key). We log in
 * once with the admin email/password (base64-encoded — see CLAUDE.md
 * "Service API auth quirk" — `FieldEncryption.decrypt_field` is literally
 * `base64.b64decode`), then reuse the session cookie + CSRF token for
 * each import call.
 *
 * Required env:
 *   DIFY_BASE_URL          — e.g. https://nginx-production-ab8f.up.railway.app
 *   DIFY_ADMIN_EMAIL       — e.g. dsmith@smithfamilyusa.com
 *   DIFY_ADMIN_PASSWORD    — plaintext; we base64-encode before sending
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run dify:import-workflows
 *   pnpm --filter @workspace/scripts run dify:import-workflows -- --dry-run
 *   pnpm --filter @workspace/scripts run dify:import-workflows -- --only=onboarding-concierge
 *   pnpm --filter @workspace/scripts run dify:import-workflows -- --update      # rewrite DSL of already-imported apps in place (preserves app ids)
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, difyWorkflowRegistry } from "@workspace/db";
import { eq } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, "..", "..", "dify-workflows");

interface CliOpts {
  dryRun: boolean;
  only: string | null;
  update: boolean;
}

function parseArgs(): CliOpts {
  const opts: CliOpts = { dryRun: false, only: null, update: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--update") opts.update = true;
    else if (a.startsWith("--only=")) opts.only = a.slice("--only=".length);
  }
  return opts;
}

interface DifySession {
  cookies: string;
  csrfToken: string;
  baseUrl: string;
}

async function login(): Promise<DifySession> {
  const baseUrl = (process.env.DIFY_BASE_URL ?? "").replace(/\/+$/, "");
  const email = process.env.DIFY_ADMIN_EMAIL ?? "";
  const password = process.env.DIFY_ADMIN_PASSWORD ?? "";
  if (!baseUrl || !email || !password) {
    throw new Error("DIFY_BASE_URL + DIFY_ADMIN_EMAIL + DIFY_ADMIN_PASSWORD required");
  }
  const passwordB64 = Buffer.from(password, "utf8").toString("base64");
  const resp = await fetch(`${baseUrl}/console/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: passwordB64, language: "en-US", remember_me: true }),
  });
  if (!resp.ok) {
    throw new Error(`Dify login failed ${resp.status}: ${await resp.text()}`);
  }
  // Collect Set-Cookie headers — Node fetch surfaces them via getSetCookie()
  // (Node 19.7+); fall back to the raw header for older runtimes.
  const setCookies: string[] = typeof (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : (resp.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  const cookiePairs = setCookies
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean) as string[];
  const cookies = cookiePairs.join("; ");
  // CSRF token is sent as a cookie named __Host-csrf_token (the same JWT
  // we have to echo back as X-CSRF-Token on subsequent writes).
  const csrfMatch = cookies.match(/__Host-csrf_token=([^;]+)/);
  if (!csrfMatch) throw new Error("CSRF cookie missing from Dify login response");
  return { cookies, csrfToken: csrfMatch[1], baseUrl };
}

interface ImportResult {
  appId: string;
}

async function importYaml(
  session: DifySession,
  yamlText: string,
  appName: string,
): Promise<ImportResult> {
  const resp = await fetch(`${session.baseUrl}/console/api/apps/imports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookies,
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({ mode: "yaml-content", yaml_content: yamlText, name: appName }),
  });
  if (!resp.ok) {
    throw new Error(`import ${appName} failed ${resp.status}: ${await resp.text()}`);
  }
  const body = (await resp.json()) as { id?: string; app_id?: string; app?: { id?: string } };
  const id = body.app?.id ?? body.app_id ?? body.id;
  if (!id) throw new Error(`import ${appName} returned no app id: ${JSON.stringify(body)}`);
  return { appId: id };
}

/**
 * Update an existing Dify app's graph in place — preserves the app id (which
 * the registry already points at) and avoids orphaning prior versions. Uses
 * the Console API's DSL endpoint that the Web UI's "Edit DSL → Save" button
 * calls under the hood.
 */
async function updateDsl(
  session: DifySession,
  appId: string,
  yamlText: string,
): Promise<void> {
  const resp = await fetch(`${session.baseUrl}/console/api/apps/${appId}/dsl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookies,
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({ data: yamlText }),
  });
  if (!resp.ok) {
    throw new Error(`update ${appId} failed ${resp.status}: ${await resp.text()}`);
  }
}

async function listYamls(): Promise<Array<{ slug: string; text: string; hash: string }>> {
  const entries = await readdir(WORKFLOWS_DIR);
  const out: Array<{ slug: string; text: string; hash: string }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    if (entry.startsWith("_")) continue; // _config.json etc.
    const slug = entry.replace(/\.(yml|yaml)$/, "");
    const text = await readFile(join(WORKFLOWS_DIR, entry), "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    out.push({ slug, text, hash });
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  console.log(`[dify-import] workflows dir: ${WORKFLOWS_DIR}`);
  if (opts.dryRun) console.log("[dify-import] DRY RUN — no Dify calls");
  if (opts.only) console.log(`[dify-import] only: ${opts.only}`);

  const yamls = await listYamls();
  if (yamls.length === 0) {
    console.log("[dify-import] no workflows found");
    return;
  }
  console.log(`[dify-import] found ${yamls.length} workflow(s): ${yamls.map((y) => y.slug).join(", ")}`);

  let session: DifySession | null = null;
  for (const y of yamls) {
    if (opts.only && y.slug !== opts.only) continue;

    const [existing] = await db
      .select()
      .from(difyWorkflowRegistry)
      .where(eq(difyWorkflowRegistry.slug, y.slug))
      .limit(1);
    if (existing && existing.versionHash === y.hash) {
      console.log(`  ${y.slug}: up to date (hash=${y.hash.slice(0, 12)})`);
      continue;
    }

    if (opts.dryRun) {
      const action = existing && opts.update ? "would update DSL in place" : "would import";
      console.log(`  ${y.slug}: ${action} (new=${!existing}, hash=${y.hash.slice(0, 12)})`);
      continue;
    }

    if (!session) session = await login();

    if (existing && opts.update) {
      // Update path: preserves the existing dify_app_id so callers that have
      // already cached the id (e.g. live Dify Service API keys minted against
      // that specific app) continue to work.
      console.log(`  ${y.slug}: updating in place (app=${existing.difyAppId})...`);
      await updateDsl(session, existing.difyAppId, y.text);
      await db
        .update(difyWorkflowRegistry)
        .set({ versionHash: y.hash, importedAt: new Date() })
        .where(eq(difyWorkflowRegistry.slug, y.slug));
      console.log(`  ${y.slug}: updated`);
      continue;
    }

    if (existing && !opts.update) {
      // Default behaviour for an already-imported slug whose YAML changed:
      // skip and tell the operator to pass --update. Re-running POST imports
      // would create a duplicate app and orphan the registry mapping.
      console.log(`  ${y.slug}: SKIPPED — YAML changed but --update flag not set (would orphan app ${existing.difyAppId})`);
      continue;
    }

    console.log(`  ${y.slug}: importing...`);
    const { appId } = await importYaml(session, y.text, y.slug);
    await db.insert(difyWorkflowRegistry).values({
      slug: y.slug,
      difyAppId: appId,
      versionHash: y.hash,
    });
    console.log(`  ${y.slug}: imported as ${appId}`);
  }

  console.log("[dify-import] done");
}

main().catch((err) => {
  console.error("[dify-import] FAILED:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
