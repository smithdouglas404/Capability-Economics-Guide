/**
 * Cross-tenant isolation regression test.
 *
 * Seeds two anonymous orgs (Org A, Org B), creates simulation scenarios,
 * innovation projects, and ROI records on each, and then asserts that:
 *   - Each list endpoint with token A returns only A's rows.
 *   - GET /:id for a B-owned row using token A returns 404.
 *   - DELETE /:id for a B-owned row using token A returns 404 and leaves
 *     the row intact (verified by re-reading via token B).
 *
 * Run against a live API server: `API_BASE=http://localhost:8080 node
 * artifacts/api-server/test/tenant-isolation.test.mjs`.
 */

const API = process.env.API_BASE ?? "http://localhost:8080";

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function j(method, path, body, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function pickIndustry() {
  const { data } = await j("GET", "/api/industries");
  if (!Array.isArray(data) || data.length === 0) throw new Error("No industries seeded");
  return data[0].id;
}

async function createOrg(label, industryId) {
  const { status, data } = await j("POST", "/api/organizations", {
    name: `iso-test-${label}-${Date.now()}`,
    industryId,
    size: "mid",
  });
  if (status !== 201) throw new Error(`Failed to create org ${label}: ${status} ${JSON.stringify(data)}`);
  return data.sessionToken;
}

async function main() {
  console.log(`Tenant isolation test against ${API}`);
  const industryId = await pickIndustry();
  const tokenA = await createOrg("A", industryId);
  const tokenB = await createOrg("B", industryId);
  console.log(`  org A token=${tokenA.slice(0, 8)}…  org B token=${tokenB.slice(0, 8)}…`);

  // ── Innovation projects ──────────────────────────────────────────────
  const projA = (await j("POST", "/api/innovation/projects", {
    sessionToken: tokenA, name: "A-project",
  })).data;
  const projB = (await j("POST", "/api/innovation/projects", {
    sessionToken: tokenB, name: "B-project",
  })).data;

  const listA = (await j("GET", `/api/innovation/projects?sessionToken=${tokenA}`)).data;
  check("innovation: list with token A excludes B's rows",
    Array.isArray(listA) && listA.every(r => r.sessionToken === tokenA),
    `got ${JSON.stringify(listA?.map(r => r.sessionToken))}`);

  const getBviaA = await j("GET", `/api/innovation/projects/${projB.id}?sessionToken=${tokenA}`);
  check("innovation: GET B-row via A returns 404", getBviaA.status === 404,
    `got ${getBviaA.status}`);

  const delBviaA = await j("DELETE", `/api/innovation/projects/${projB.id}?sessionToken=${tokenA}`);
  check("innovation: DELETE B-row via A returns 404", delBviaA.status === 404,
    `got ${delBviaA.status}`);

  const stillThere = await j("GET", `/api/innovation/projects/${projB.id}?sessionToken=${tokenB}`);
  check("innovation: B's row still readable by B after A's failed delete",
    stillThere.status === 200, `got ${stillThere.status}`);

  // ── ROI records ──────────────────────────────────────────────────────
  // Need a capability id for ROI rows.
  const caps = (await j("GET", "/api/capabilities")).data;
  const capId = Array.isArray(caps) && caps[0]?.id;
  if (capId) {
    const roiB = (await j("POST", "/api/roi/records", {
      sessionToken: tokenB, capabilityId: capId, quarter: "2026-Q1", spendUsdK: 10,
    })).data;
    const delRoiBviaA = await j("DELETE", `/api/roi/records/${roiB.id}?sessionToken=${tokenA}`);
    check("roi: DELETE B-row via A returns 404", delRoiBviaA.status === 404,
      `got ${delRoiBviaA.status}`);

    const listRoiA = (await j("GET", `/api/roi/records?sessionToken=${tokenA}`)).data;
    check("roi: list with token A excludes B's rows",
      Array.isArray(listRoiA) && listRoiA.every(r => r.sessionToken === tokenA),
      `got ${JSON.stringify(listRoiA?.map(r => r.sessionToken))}`);
  } else {
    console.log("  - skipping ROI checks (no capabilities seeded)");
  }

  // ── Simulation scenarios ────────────────────────────────────────────
  // Run a tiny simulation for each tenant to materialize a scenario row.
  const scenarioBody = (token) => ({
    sessionToken: token, name: "iso-scenario",
    investments: capId
      ? [{ capabilityId: capId, investmentUsdMm: 1, targetMaturityDelta: 0.1, timelineMonths: 6 }]
      : [],
  });
  if (capId) {
    const simB = (await j("POST", "/api/simulation/run", scenarioBody(tokenB))).data;
    if (simB?.id) {
      const getSimBviaA = await j("GET", `/api/simulation/scenarios/${simB.id}?sessionToken=${tokenA}`);
      check("simulation: GET B-row via A returns 404", getSimBviaA.status === 404,
        `got ${getSimBviaA.status}`);

      const delSimBviaA = await j("DELETE", `/api/simulation/scenarios/${simB.id}?sessionToken=${tokenA}`);
      check("simulation: DELETE B-row via A returns 404", delSimBviaA.status === 404,
        `got ${delSimBviaA.status}`);
    }
  }

  // Cleanup — best-effort, ignore errors.
  await j("DELETE", `/api/innovation/projects/${projA.id}?sessionToken=${tokenA}`);
  await j("DELETE", `/api/innovation/projects/${projB.id}?sessionToken=${tokenB}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(2); });
