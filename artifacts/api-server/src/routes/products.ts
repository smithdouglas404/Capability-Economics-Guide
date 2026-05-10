import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  listProductsByCompany,
  listProductsByCapability,
  upsertProduct,
  deleteProduct,
  researchProductsForCapability,
  seedKnownProducts,
} from "../services/products";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/companies/:id/products", async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const products = await listProductsByCompany(id);
  res.json({ products });
});

router.get("/capabilities/:id/products", async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const products = await listProductsByCapability(id);
  res.json({ products });
});

const upsertBody = z.object({
  companyId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).nullable().optional(),
  launchDate: z.string().max(20).nullable().optional(),
  status: z.enum(["active", "preview", "deprecated", "discontinued"]).optional(),
  websiteUrl: z.string().url().nullable().optional(),
  source: z.string().max(40).optional(),
  capabilities: z.array(z.object({
    capabilityId: z.number().int().positive(),
    weight: z.number().min(0).max(1),
    evidenceNote: z.string().max(500).nullable().optional(),
  })).min(1),
});

router.post("/admin/products", requireAdmin, async (req, res) => {
  const parsed = upsertBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", issues: parsed.error.issues }); return; }
  const id = await upsertProduct(parsed.data);
  res.json({ ok: true, id });
});

router.put("/admin/products/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const parsed = upsertBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid body", issues: parsed.error.issues }); return; }
  await upsertProduct(parsed.data, id);
  res.json({ ok: true, id });
});

router.delete("/admin/products/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  await deleteProduct(id);
  res.json({ ok: true });
});

router.post("/admin/products/_research", requireAdmin, async (req, res) => {
  const capabilityId = parseInt(String(req.body?.capabilityId ?? ""), 10);
  if (!Number.isFinite(capabilityId)) { res.status(400).json({ error: "capabilityId required" }); return; }
  try {
    const r = await researchProductsForCapability(capabilityId);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/admin/products/_seed", requireAdmin, async (_req, res) => {
  try {
    const r = await seedKnownProducts();
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
