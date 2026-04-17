import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityMetricsTable,
  capabilityDependenciesTable,
  capabilityRoleMappingsTable,
  cSuiteRolesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ListCapabilitiesQueryParams, GetCapabilityParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/capabilities", async (req, res) => {
  const parsed = ListCapabilitiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { industryId } = parsed.data;

  const includePending = req.query.includePending === "1" || req.query.includePending === "true";
  let query = db.select().from(capabilitiesTable);
  if (industryId !== undefined && !includePending) {
    query = query.where(and(eq(capabilitiesTable.industryId, industryId), eq(capabilitiesTable.reviewStatus, "approved"))) as typeof query;
  } else if (industryId !== undefined) {
    query = query.where(eq(capabilitiesTable.industryId, industryId)) as typeof query;
  } else if (!includePending) {
    query = query.where(eq(capabilitiesTable.reviewStatus, "approved")) as typeof query;
  }
  const capabilities = await query;
  res.json(capabilities);
});

router.get("/capabilities/:id", async (req, res) => {
  const parsed = GetCapabilityParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid capability ID" });
    return;
  }

  const { id } = parsed.data;

  const [capability] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, id));
  if (!capability) {
    res.status(404).json({ error: "Capability not found" });
    return;
  }

  const metrics = await db.select().from(capabilityMetricsTable).where(eq(capabilityMetricsTable.capabilityId, id));

  const depsRaw = await db
    .select({
      id: capabilityDependenciesTable.id,
      dependsOnId: capabilityDependenciesTable.dependsOnId,
      dependsOnName: capabilitiesTable.name,
      strength: capabilityDependenciesTable.strength,
    })
    .from(capabilityDependenciesTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, capabilityDependenciesTable.dependsOnId))
    .where(eq(capabilityDependenciesTable.capabilityId, id));

  const roleMappingsRaw = await db
    .select({
      roleId: capabilityRoleMappingsTable.roleId,
      roleTitle: cSuiteRolesTable.title,
      roleName: cSuiteRolesTable.name,
      relevance: capabilityRoleMappingsTable.relevance,
      perspective: capabilityRoleMappingsTable.perspective,
    })
    .from(capabilityRoleMappingsTable)
    .innerJoin(cSuiteRolesTable, eq(cSuiteRolesTable.id, capabilityRoleMappingsTable.roleId))
    .where(eq(capabilityRoleMappingsTable.capabilityId, id));

  res.json({
    ...capability,
    metrics,
    dependencies: depsRaw,
    roleMappings: roleMappingsRaw,
  });
});

router.get("/roles", async (_req, res) => {
  const roles = await db.select().from(cSuiteRolesTable);
  res.json(roles);
});

export default router;
