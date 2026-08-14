/**
 * Fallback parser: extract reference number from sales sheet PDF content.
 *
 * The reference number and invoice number appear on page 1 of the PDF
 * as standalone values in the header area.
 *
 * Also extracts the delivery date, which is used to verify that a PDF is
 * linked to the right sales sheet. Sales sheet numbers are recycled per
 * year, so the number alone is not enough to identify a delivery.
 *
 * Uses pdfjs-dist legacy build for Vercel serverless compatibility.
 */

export interface ParsedSalesSheetPdf {
  reference: string | null;
  ourInvoiceNumber: string | null;
  /** Delivery date printed on the PDF, as "YYYY-MM-DD". Null if unreadable. */
  deliveryDate: string | null;
}

/** Convert a Dutch "DD-MM-YYYY" or "DD-MM-YY" date to "YYYY-MM-DD". */
function parseDutchDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function parseSalesSheetPdf(pdfBuffer: Buffer): Promise<ParsedSalesSheetPdf> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(pdfBuffer);
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;

  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items as Array<{
    str: string;
    hasEOL?: boolean;
    transform?: number[];
  }>;

  // Positioned items, used to read the value printed to the right of a label.
  // Header fields sit in a two-column layout, so a line-based read would glue
  // unrelated values together.
  const positioned = items
    .filter((i) => i.str.trim() && Array.isArray(i.transform))
    .map((i) => ({
      text: i.str.trim(),
      x: Math.round(i.transform![4]),
      y: Math.round(i.transform![5]),
    }));

  const valueRightOf = (label: RegExp): string | null => {
    const labelItem = positioned.find((i) => label.test(i.text));
    if (!labelItem) return null;
    const right = positioned
      .filter((i) => Math.abs(i.y - labelItem.y) <= 4 && i.x > labelItem.x)
      .sort((a, b) => a.x - b.x)[0];
    return right ? right.text : null;
  };

  // English template: "Deliverydate". Dutch template: "Datum levering".
  const deliveryDate = parseDutchDate(
    valueRightOf(/^(Delivery\s?date|Datum\s+levering|Leverdatum)\s*:?$/i)
  );

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
      // Search nearby lines for standalone numbers (wide range for varied layouts)
      const candidates: string[] = [];
      for (let j = Math.max(0, i - 15); j < Math.min(lines.length, i + 5); j++) {
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
  return { reference, ourInvoiceNumber, deliveryDate };
}
