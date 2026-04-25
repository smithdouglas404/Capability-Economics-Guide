import PDFDocument from "pdfkit";

/**
 * Streams a pdfkit document into a Buffer. Use for one-shot PDF generation
 * where we send the binary back to the client in a single response.
 */
export function buildPdf(builder: (doc: PDFKit.PDFDocument) => void | Promise<void>): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    Promise.resolve()
      .then(() => builder(doc))
      .then(() => doc.end())
      .catch(reject);
  });
}

/** Cover page with title, subtitle, brand mark, and footer date. */
export function coverPage(doc: PDFKit.PDFDocument, opts: {
  title: string;
  subtitle?: string;
  brand?: string;
  meta?: Array<{ label: string; value: string }>;
}) {
  const { title, subtitle, brand = "Capability Economics", meta = [] } = opts;
  const w = doc.page.width;
  const h = doc.page.height;

  // Brand mark band
  doc.save();
  doc.rect(0, 0, w, 110).fill("#0f172a");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14).text(brand, 54, 48);
  doc.font("Helvetica").fontSize(10).fillColor("#94a3b8").text("Diligence Pack · confidential", 54, 70);
  doc.restore();

  // Title block, vertically centered
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(34).text(title, 54, h * 0.32, { width: w - 108 });
  if (subtitle) {
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(14).fillColor("#475569").text(subtitle, { width: w - 108 });
  }

  // Meta block
  if (meta.length) {
    let y = h * 0.62;
    doc.moveTo(54, y - 12).lineTo(w - 54, y - 12).strokeColor("#e2e8f0").lineWidth(1).stroke();
    for (const m of meta) {
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(m.label.toUpperCase(), 54, y);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(m.value, 54 + 140, y - 1);
      y += 22;
    }
  }

  // Footer
  doc.font("Helvetica").fontSize(9).fillColor("#94a3b8")
    .text(`Generated ${new Date().toISOString().slice(0, 10)}`, 54, h - 72, { align: "left" });
  doc.addPage();
}

/** Section heading with rule below. */
export function sectionHeading(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text(text);
  const y = doc.y + 4;
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor("#0f172a").lineWidth(1).stroke();
  doc.moveDown(0.6);
}

/** Body paragraph with sensible defaults. */
export function body(doc: PDFKit.PDFDocument, text: string) {
  doc.font("Helvetica").fontSize(10.5).fillColor("#1e293b").text(text, { align: "left", paragraphGap: 6 });
}

/**
 * Horizontal-bar chart drawn with pdfkit primitives — each row labeled, value
 * shown right-aligned. `max` defaults to 100 so it doubles as a 0–100 score
 * chart; pass `max=Math.max(...values)` for raw values.
 */
export function hbarChart(doc: PDFKit.PDFDocument, opts: {
  rows: Array<{ label: string; value: number; sub?: string; color?: string }>;
  max?: number;
  width?: number;
  rowHeight?: number;
  labelWidth?: number;
}) {
  const max = opts.max ?? 100;
  const totalWidth = opts.width ?? (doc.page.width - doc.page.margins.left - doc.page.margins.right);
  const labelWidth = opts.labelWidth ?? 180;
  const rowHeight = opts.rowHeight ?? 22;
  const barAreaWidth = totalWidth - labelWidth - 60;
  const left = doc.page.margins.left;
  let y = doc.y + 4;

  for (const r of opts.rows) {
    // Label
    doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a").text(r.label, left, y + 4, { width: labelWidth - 8, ellipsis: true });
    if (r.sub) {
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(r.sub, left, y + 14, { width: labelWidth - 8, ellipsis: true });
    }
    // Bar background
    doc.rect(left + labelWidth, y + 6, barAreaWidth, rowHeight - 12).fill("#e2e8f0");
    // Bar fill
    const w = Math.max(0, Math.min(barAreaWidth, (r.value / max) * barAreaWidth));
    doc.rect(left + labelWidth, y + 6, w, rowHeight - 12).fill(r.color ?? "#0ea5e9");
    // Value text
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a")
      .text(r.value.toFixed(1), left + labelWidth + barAreaWidth + 8, y + 4, { width: 50, align: "right" });
    y += rowHeight;
  }
  doc.y = y + 4;
}

/** Two-column key-value table for metric summaries. */
export function kvTable(doc: PDFKit.PDFDocument, rows: Array<{ k: string; v: string }>) {
  const left = doc.page.margins.left;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const kw = 180;
  let y = doc.y;
  for (const { k, v } of rows) {
    doc.font("Helvetica").fontSize(9.5).fillColor("#64748b").text(k, left, y, { width: kw - 8 });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(v, left + kw, y, { width: totalWidth - kw, ellipsis: true });
    y += 16;
  }
  doc.y = y + 4;
}

/** Footer applied to all rendered pages — call after content is fully written. */
export function applyPageNumbers(doc: PDFKit.PDFDocument, label: string) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const w = doc.page.width;
    const h = doc.page.height;
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text(label, doc.page.margins.left, h - 32, { width: w / 2, align: "left" });
    doc.text(`${i + 1} / ${range.count}`, w / 2, h - 32, { width: w / 2 - doc.page.margins.right, align: "right" });
  }
}
