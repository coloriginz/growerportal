/**
 * Fallback parser: extract reference number from sales sheet PDF content.
 *
 * The reference number and invoice number appear on page 1 of the PDF
 * as standalone values in the header area.
 *
 * Uses pdfjs-dist legacy build for Vercel serverless compatibility.
 */

export interface ParsedSalesSheetPdf {
  reference: string | null;
  ourInvoiceNumber: string | null;
}

export async function parseSalesSheetPdf(pdfBuffer: Buffer): Promise<ParsedSalesSheetPdf> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(pdfBuffer);
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;

  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items as Array<{ str: string; hasEOL?: boolean }>;

  // Build lines from text items
  const lines: string[] = [];
  let currentLine = "";
  for (const item of items) {
    currentLine += item.str;
    if (item.hasEOL) {
      lines.push(currentLine.trim());
      currentLine = "";
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());

  // Look for "Invoice number" or "Factuurnummer" label — the values appear nearby
  let reference: string | null = null;
  let ourInvoiceNumber: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/Invoice number|Factuurnummer/i.test(line)) {
      // Search nearby lines for standalone numbers
      const candidates: string[] = [];
      for (let j = Math.max(0, i - 5); j < Math.min(lines.length, i + 5); j++) {
        const l = lines[j].trim();
        // Match patterns like "212-28", "5322744", "401546", "18108"
        // Exclude date patterns like "01-01-2026"
        if (/^\d[\d-]{1,15}$/.test(l) && !/^\d{1,2}-\d{1,2}-\d{4}$/.test(l)) {
          candidates.push(l);
        }
      }
      // Typically we find two: reference (first) and invoice number (second)
      if (candidates.length >= 2) {
        reference = candidates[0];
        ourInvoiceNumber = candidates[1];
      } else if (candidates.length === 1) {
        reference = candidates[0];
      }
      break;
    }
  }

  await doc.destroy();
  return { reference, ourInvoiceNumber };
}
