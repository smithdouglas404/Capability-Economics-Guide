import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { readFile } from "./marketplace-storage";

/**
 * Overlay a buyer-identifying watermark on every page of a purchased PDF.
 * Makes leaks attributable — not unbreakable, but raises the cost of sharing
 * and satisfies "this was sold to this specific buyer" claims in a dispute.
 *
 * Watermark format: diagonal "Licensed to {email} — purchased {ISO-date}" at
 * ~30% opacity across each page.
 */
export async function watermarkPdf(fileKey: string, opts: { buyerEmail: string; purchasedAt: Date; purchaseId: number }): Promise<Buffer> {
  const sourceBytes = await readFile(fileKey);
  const pdf = await PDFDocument.load(sourceBytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  const isoDate = opts.purchasedAt.toISOString().slice(0, 10);
  const line1 = `Licensed to ${opts.buyerEmail}`;
  const line2 = `Purchased ${isoDate} · #${opts.purchaseId}`;
  const fullMark = `${line1} — ${line2}`;

  const pages = pdf.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    // Diagonal across the page, at low opacity.
    const fontSize = Math.min(width, height) * 0.035;
    const textWidth = font.widthOfTextAtSize(fullMark, fontSize);
    page.drawText(fullMark, {
      x: (width - textWidth) / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.28,
      rotate: degrees(-30),
    });
    // Subtle footer on every page.
    page.drawText(line1, {
      x: 40,
      y: 24,
      size: 8,
      font,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.55,
    });
    page.drawText(line2, {
      x: width - 40 - font.widthOfTextAtSize(line2, 8),
      y: 24,
      size: 8,
      font,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.55,
    });
  }

  const out = await pdf.save();
  return Buffer.from(out);
}
