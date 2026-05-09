import { Router, type IRouter, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, userMembershipsTable, membershipTiersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { writeInvoicePdf, type InvoiceData } from "../services/invoice-pdf";

const router: IRouter = Router();

function invoiceEntityType(raw: string): InvoiceData["customer"]["entityType"] {
  return raw === "individual" ? "individual" : "company";
}

function invoicePaymentMethod(raw: string): InvoiceData["payment"]["method"] {
  if (raw === "crypto") return "crypto";
  if (raw === "invoice") return "invoice";
  return "card";
}

function buildInvoiceData(opts: {
  membership: typeof userMembershipsTable.$inferSelect;
  tier: typeof membershipTiersTable.$inferSelect | null;
}): InvoiceData {
  const { membership, tier } = opts;

  // Derive billing period from the stored amount (best-effort; falls back to Annual).
  const annualCents = tier?.annualPriceCents ?? null;
  const monthlyCents = tier?.monthlyPriceCents ?? null;
  const amt = membership.paymentAmountCents ?? annualCents ?? monthlyCents ?? 0;
  const periodLabel = amt === monthlyCents ? "Monthly" : "Annual";

  return {
    invoiceNumber: `CE-${String(membership.id).padStart(6, "0")}`,
    issuedAt: membership.requestedAt ?? new Date(),
    customer: {
      name: membership.userName,
      email: membership.userEmail,
      entityName: membership.entityName,
      entityType: invoiceEntityType(membership.entityType),
    },
    lineItem: {
      description: `${tier?.name ?? "Membership"} — ${tier?.tagline ?? "Capability Economics"}`,
      amountCents: amt,
      periodLabel,
    },
    payment: {
      method: invoicePaymentMethod(membership.paymentMethod),
      status: membership.paymentStatus,
      reference: membership.paymentRef,
      paidAt: membership.approvedAt,
    },
    provider: {
      name: "Capability Economics",
      address: ["Capability Economics, Inc."],
      email: "billing@capabilityeconomics.com",
    },
  };
}

async function streamPdfResponse(res: Response, data: InvoiceData) {
  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${data.invoiceNumber}.pdf"`);
    await writeInvoicePdf(data, res);
  } catch (err) {
    // If pdfkit failed to load or render (rare — usually font file resolution),
    // return a JSON error instead of a dangling PDF header.
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: "PDF generation failed", message: (err as Error).message });
    }
  }
}

/** Users can download invoices for their own memberships. */
router.get("/me/memberships/:id/invoice.pdf", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [m] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!m || m.userId !== auth.userId) { res.status(404).json({ error: "not found" }); return; }
  const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, m.tierId));
  await streamPdfResponse(res, buildInvoiceData({ membership: m, tier: tier ?? null }));
});

/** Admin can download invoices for any membership. */
router.get("/admin/memberships/:id/invoice.pdf", requireAdmin, async (req, res) => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [m] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!m) { res.status(404).json({ error: "not found" }); return; }
  const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, m.tierId));
  await streamPdfResponse(res, buildInvoiceData({ membership: m, tier: tier ?? null }));
});

export default router;
