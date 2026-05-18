/**
 * Contract-drift checks — catches the class of bug that has caused every
 * data issue in this codebase (CEI→CVI rename misses, /embed/cei vs /embed/cvi
 * mismatch, the BullMQ /healthz/redis dangler, the v1 schemas pointing at
 * /v1/cei/* while the routes are /v1/cvi/*).
 *
 * Two checks bundled — run them via `pnpm run check:contract`:
 *
 *   1. Route-existence: every `/api/...` URL referenced by the frontend
 *      must resolve to at least one router.get/post/put/delete/patch in
 *      artifacts/api-server/src/routes/**.ts. Path params are normalised
 *      to `:param` on both sides before matching.
 *
 *   2. Codegen drift: re-run the orval codegen, fail if anything in
 *      lib/api-client-react/src/generated or lib/api-zod/src/generated
 *      differs from what's committed. Catches stale openapi.yaml (the
 *      ceiBeforeIndex → cviBeforeIndex case from earlier).
 *
 * Exits non-zero if either check fails so it can gate CI / pre-push hooks.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const REPO = resolve(import.meta.dirname, "..", "..");

async function walk(dir: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      out.push(...await walk(full, exts));
    } else if (exts.some(e => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function normaliseUrl(url: string): string {
  let u = url.replace(/^\$\{API_BASE\}/, "/api");
  u = u.replace(/^https?:\/\/[^/]+/, "");
  // Strip literal query strings + fragments.
  u = u.replace(/\?.*$/, "").split("#")[0]!;
  // Replace template interpolations with a sentinel. Any `:param` that ends
  // up glued to non-slash text (e.g. `/api/insights:param` from
  // `${API_BASE}/insights${qs}`) is a query-string variable, not a path
  // segment — strip it and everything after.
  u = u.replace(/\$\{[^}]+\}/g, ":param");
  u = u.replace(/([^/]):param.*$/, "$1");
  // A leading dot inside a segment (`/exports/:param.csv` style) — keep, the
  // backend uses literal `.csv` / `.parquet` extensions. Our normalised form
  // matches via the segment-by-segment compare, since `:param.csv` won't
  // collapse to `:param.:param` anymore.
  u = u.replace(/\/+/g, "/").replace(/\/$/, "");
  return u;
}

interface RouterMount {
  file: string;       // absolute path to the routes/foo.ts file
  prefix: string;     // "" if mounted at root, "/enrichment" etc otherwise
}

async function readRouterMounts(): Promise<RouterMount[]> {
  const indexText = await readFile(join(REPO, "artifacts/api-server/src/routes/index.ts"), "utf8");
  // Map import varName → relative file path: `import fooRouter from "./foo";`
  const importMap = new Map<string, string>();
  const importRe = /import\s+(?:\{[^}]+\}\s*=\s*)?([A-Za-z_][A-Za-z0-9_]*)\s+from\s+["']\.\/([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(indexText)) !== null) {
    importMap.set(m[1]!, m[2]!);
  }
  // Also handle named imports like `import { foo } from "./bar";`
  const namedRe = /import\s+\{\s*([^}]+)\s*\}\s+from\s+["']\.\/([^"']+)["']/g;
  while ((m = namedRe.exec(indexText)) !== null) {
    for (const name of m[1]!.split(",").map(s => s.trim()).filter(Boolean)) {
      importMap.set(name, m[2]!);
    }
  }
  // Parse mount lines: router.use(varName) → prefix="", router.use("/prefix", varName)
  const mounts: RouterMount[] = [];
  const seen = new Set<string>();
  const mountRe = /router\.use\(\s*(?:["']([^"']+)["']\s*,\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*[),]/g;
  while ((m = mountRe.exec(indexText)) !== null) {
    const prefix = m[1] ?? "";
    const varName = m[2]!;
    const relPath = importMap.get(varName);
    if (!relPath) continue;
    const file = join(REPO, "artifacts/api-server/src/routes", relPath + ".ts");
    const key = `${file}|${prefix}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mounts.push({ file, prefix });
  }
  // Also include files in routes/ that aren't mounted via index.ts (defensive)
  const allRouteFiles = await walk(join(REPO, "artifacts/api-server/src/routes"), [".ts"]);
  for (const f of allRouteFiles) {
    if (!mounts.some(mt => mt.file === f)) mounts.push({ file: f, prefix: "" });
  }
  return mounts;
}

function normaliseRoute(route: string): string {
  return route.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, ":param").replace(/\/+/g, "/").replace(/\/$/, "");
}

function urlMatchesRoute(url: string, route: string): boolean {
  const u = url.split("/");
  const r = route.split("/");
  if (u.length !== r.length) return false;
  return u.every((seg, i) => seg === r[i] || r[i] === ":param");
}

/**
 * Known-OK frontend patterns the checker can't statically resolve. Each
 * entry must include a one-line justification — if you can't write the
 * comment, don't add the entry. Format: normalised URL → reason.
 */
const ROUTE_CHECK_ALLOWLIST: Record<string, string> = {
  "/api/exports/:param.": "frontend builds `/api/exports/${id}.${format}`; backend serves /exports/:dataset.csv + /exports/:dataset.parquet with literal extensions",
  "/api/marketplace/listings/:param/:param": "frontend builds `/api/marketplace/listings/${id}/${kind}`; backend has discrete routes per kind (/file, /preview-file, /submit, /archive)",
};

async function checkRoutes(): Promise<{ ok: boolean; missing: Array<{ url: string; file: string }> }> {
  const frontendDirs = ["artifacts/inflexcvi/src", "artifacts/ce-pitch-deck/src", "artifacts/mockup-sandbox/src"];
  const frontendFiles: string[] = [];
  for (const d of frontendDirs) {
    try { frontendFiles.push(...await walk(join(REPO, d), [".ts", ".tsx"])); } catch { /* dir may not exist */ }
  }
  const frontendUrls = new Map<string, string>();
  const fetchRe = /(?:fetch|useApi[^a-zA-Z]*<[^>]*>|customFetch)\(\s*[`"']([^`"']+)/g;
  for (const f of frontendFiles) {
    const text = await readFile(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = fetchRe.exec(text)) !== null) {
      const raw = m[1]!;
      const u = normaliseUrl(raw);
      if (!u.startsWith("/api/")) continue;
      if (!frontendUrls.has(u)) frontendUrls.set(u, f.replace(REPO + "/", ""));
    }
  }

  const mounts = await readRouterMounts();
  const backendRoutes = new Set<string>();
  // Match any variable ending in "router" or "Router" — catches the standard
  // `router.get(...)` plus alias-style locals like `enrichmentAliasRouter.get(...)`.
  const routeRe = /\b\w*[Rr]outer\.(get|post|put|delete|patch)\(\s*[`"']([^`"']+)/g;
  for (const { file, prefix } of mounts) {
    let text: string;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(text)) !== null) {
      const p = m[2]!;
      const joined = "/api" + prefix + (p.startsWith("/") ? p : "/" + p);
      backendRoutes.add(normaliseRoute(joined));
    }
  }

  const missing: Array<{ url: string; file: string }> = [];
  for (const [url, file] of frontendUrls) {
    if (backendRoutes.has(url)) continue;
    if (url in ROUTE_CHECK_ALLOWLIST) continue;
    const matched = [...backendRoutes].some(r => urlMatchesRoute(url, r));
    if (!matched) missing.push({ url, file });
  }

  console.log(`[check:routes] frontend URLs: ${frontendUrls.size}  backend routes: ${backendRoutes.size}  missing: ${missing.length}`);
  return { ok: missing.length === 0, missing };
}

function checkCodegen(): { ok: boolean; drift: string } {
  console.log("[check:codegen] running orval codegen…");
  try {
    execSync("pnpm --filter @workspace/api-spec run codegen", { cwd: REPO, stdio: "pipe" });
  } catch (err) {
    return { ok: false, drift: `codegen command failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const generated = ["lib/api-client-react/src/generated", "lib/api-zod/src/generated"];
  const status = execSync(`git status --porcelain ${generated.join(" ")}`, { cwd: REPO, encoding: "utf8" });
  if (status.trim().length > 0) {
    return { ok: false, drift: status };
  }
  return { ok: true, drift: "" };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runRoutes = args.length === 0 || args.includes("routes");
  const runCodegen = args.length === 0 || args.includes("codegen");

  let anyFailed = false;
  if (runRoutes) {
    const r = await checkRoutes();
    if (!r.ok) {
      console.error("\n✗ Frontend URLs with no backing route:");
      for (const m of r.missing) console.error(`  ${m.url}    ← ${m.file}`);
      console.error("\nFix: add a router.{get,post,put,delete,patch}() for each URL above,");
      console.error("or rename the frontend call to match an existing route.");
      anyFailed = true;
    } else {
      console.log("✓ check:routes  every frontend /api/* URL has a matching backend route");
    }
  }
  if (runCodegen) {
    const c = checkCodegen();
    if (!c.ok) {
      console.error("\n✗ Codegen drift — openapi.yaml doesn't match committed generated code:");
      console.error(c.drift);
      console.error("Fix: pnpm --filter @workspace/api-spec run codegen && git add lib/api-client-react/src/generated lib/api-zod/src/generated && commit.");
      anyFailed = true;
    } else {
      console.log("✓ check:codegen  generated client matches openapi.yaml");
    }
  }
  process.exit(anyFailed ? 1 : 0);
}

void main();
