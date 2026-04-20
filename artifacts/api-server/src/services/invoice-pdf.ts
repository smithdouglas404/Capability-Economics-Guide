import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";

export type InvoiceData = {
  invoiceNumber: string;
  issuedAt: Date;
  customer: {
    name: string | null;
    email: string | null;
    entityName: string;
    entityType: "company" | "individual";
  };
  lineItem: {
    description: string;
    amountCents: number;
    periodLabel: string; // e.g. "Annual" or "Monthly"
  };
  payment: {
    method: "card" | "invoice" | "crypto";
    status: string;
    reference: string | null;
    paidAt: Date | null;
  };
  provider: {
    name: string; // "Capability Economics"
    address?: string[];
    email?: string;
  };
};

const USD = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DATE = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
const methodLabel = (m: InvoiceData["payment"]["method"]) =>
  m === "card" ? "Credit card" : m === "invoice" ? "Invoice" : "Crypto";

/**
 * Render an invoice as a PDF into `out`. Call `out.end()` on completion only
 * if you need to flush — the underlying PDFDocument ends itself when the
 * internal stream is drained.
 */
export function writeInvoicePdf(data: InvoiceData, out: Writable): void {
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  doc.pipe(out);

  const accent = "#4338ca";
  const muted = "#6b7280";

  // Header — brand mark + title
  doc
    .fillColor(accent)
    .rect(50, 50, 34, 34)
    .fill();
  doc
    .fillColor("white")
    .fontSize(16)
    .font("Helvetica-Bold")
    .text("CE", 50, 60, { width: 34, align: "center" });

  doc
    .fillColor("#1a1a1a")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text(data.provider.name, 95, 55);
  if (data.provider.address?.length) {
    doc.font("Helvetica").fontSize(9).fillColor(muted);
    let y = 80;
    for (const line of data.provider.address) {
      doc.text(line, 95, y);
      y += 11;
    }
  }

  // Invoice title (right-aligned)
  doc
    .fillColor("#1a1a1a")
    .font("Helvetica-Bold")
    .fontSize(26)
    .text("INVOICE", 400, 55, { width: 150, align: "right" });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(muted)
    .text(`#${data.invoiceNumber}`, 400, 85, { width: 150, align: "right" });
  doc.text(`Issued ${DATE(data.issuedAt)}`, 400, 99, { width: 150, align: "right" });

  // Separator
  doc.moveTo(50, 140).lineTo(562, 140).strokeColor("#e5e7eb").lineWidth(1).stroke();

  // Billed-to block
  doc
    .fillColor(muted)
    .fontSize(9)
    .font("Helvetica")
    .text("BILLED TO", 50, 160);
  doc.fillColor("#1a1a1a").fontSize(11).font("Helvetica-Bold").text(data.customer.entityName, 50, 175);
  doc.font("Helvetica").fontSize(10).fillColor(muted);
  let billedY = 190;
  if (data.customer.name && data.customer.name !== data.customer.entityName) { doc.text(data.customer.name, 50, billedY); billedY += 13; }
  if (data.customer.email) { doc.text(data.customer.email, 50, billedY); billedY += 13; }
  doc.text(data.customer.entityType === "company" ? "Company" : "Individual", 50, billedY);

  // Payment-status block (right column)
  doc.fillColor(muted).fontSize(9).font("Helvetica").text("STATUS", 400, 160, { width: 150, align: "right" });
  const paid = data.payment.status === "paid" || data.payment.status === "comped";
  doc
    .fillColor(paid ? "#059669" : "#d97706")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(paid ? "PAID" : data.payment.status.toUpperCase(), 400, 175, { width: 150, align: "right" });
  doc.fillColor(muted).font("Helvetica").fontSize(10);
  doc.text(`Method: ${methodLabel(data.payment.method)}`, 400, 195, { width: 150, align: "right" });
  if (data.payment.reference) {
    doc.text(`Ref: ${data.payment.reference.slice(0, 22)}`, 400, 210, { width: 150, align: "right" });
  }
  if (data.payment.paidAt) {
    doc.text(`Paid ${DATE(data.payment.paidAt)}`, 400, 225, { width: 150, align: "right" });
  }

  // Items table
  const tableTop = 280;
  doc.fillColor(muted).fontSize(9).font("Helvetica-Bold");
  doc.text("DESCRIPTION", 50, tableTop);
  doc.text("PERIOD", 350, tableTop, { width: 100 });
  doc.text("AMOUNT", 450, tableTop, { width: 112, align: "right" });
  doc.moveTo(50, tableTop + 15).lineTo(562, tableTop + 15).strokeColor("#e5e7eb").lineWidth(0.5).stroke();

  const rowY = tableTop + 28;
  doc.fillColor("#1a1a1a").fontSize(11).font("Helvetica");
  doc.text(data.lineItem.description, 50, rowY, { width: 290 });
  doc.text(data.lineItem.periodLabel, 350, rowY, { width: 100 });
  doc.text(USD(data.lineItem.amountCents), 450, rowY, { width: 112, align: "right" });

  // Total row
  const totalY = rowY + 40;
  doc.moveTo(50, totalY).lineTo(562, totalY).strokeColor("#e5e7eb").lineWidth(1).stroke();
  doc.fillColor(muted).fontSize(10).font("Helvetica").text("Subtotal", 350, totalY + 10, { width: 100 });
  doc.fillColor("#1a1a1a").text(USD(data.lineItem.amountCents), 450, totalY + 10, { width: 112, align: "right" });

  doc.fillColor(muted).font("Helvetica").text("Tax", 350, totalY + 28, { width: 100 });
  doc.fillColor("#1a1a1a").text("$0.00", 450, totalY + 28, { width: 112, align: "right" });

  doc
    .fillColor("#1a1a1a")
    .fontSize(13)
    .font("Helvetica-Bold")
    .text("Total", 350, totalY + 50, { width: 100 });
  doc.text(USD(data.lineItem.amountCents), 450, totalY + 50, { width: 112, align: "right" });

  // Footer
  const footerY = 720;
  doc
    .moveTo(50, footerY)
    .lineTo(562, footerY)
    .strokeColor("#e5e7eb")
    .lineWidth(0.5)
    .stroke();
  doc.fillColor(muted).fontSize(9).font("Helvetica");
  doc.text(
    data.provider.email
      ? `Questions? Reply to ${data.provider.email}`
      : `Thank you for your business.`,
    50,
    footerY + 10,
  );
  doc.text("Generated on " + DATE(new Date()), 50, footerY + 25);

  doc.end();
}
