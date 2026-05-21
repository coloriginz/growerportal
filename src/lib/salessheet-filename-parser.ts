/**
 * Parse a sales sheet PDF filename to extract reference and invoice numbers.
 *
 * Expected format:
 *   "COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF"
 *   [supplier] - [date time] - [reference] - [invoiceNumber].PDF
 *
 * The reference number matches SalesSheet.invoiceNumber in the database.
 * The invoice number is our own invoice number (OZ Import/Coloriginz/MyPeony).
 */
export interface ParsedFilename {
  supplierCode: string;
  reference: string;
  ourInvoiceNumber: string;
}

export function parseSalesSheetFilename(filename: string): ParsedFilename | null {
  // Remove extension
  const name = filename.replace(/\.[^.]+$/, "");

  // Split on " - " (space-dash-space)
  const parts = name.split(" - ");

  // We need at least 4 parts: supplier, date, reference, invoiceNumber
  if (parts.length < 4) return null;

  const supplierCode = parts[0].trim();
  const reference = parts[parts.length - 2].trim();
  const ourInvoiceNumber = parts[parts.length - 1].trim();

  if (!supplierCode || !reference || !ourInvoiceNumber) return null;

  return { supplierCode, reference, ourInvoiceNumber };
}

/**
 * Fallback: parse a simple filename like "135-23-380914.pdf"
 * where the last segment (after final hyphen) is the invoice number
 * and everything before is the reference.
 *
 * Pattern: REFERENCE-INVOICENUMBER.pdf (e.g., "135-23-380914.pdf")
 */
export function parseSalesSheetFilenameSimple(filename: string): { reference: string; ourInvoiceNumber: string } | null {
  const name = filename.replace(/\.[^.]+$/, "");

  // Must contain at least one hyphen and consist of digits/hyphens only
  if (!/^\d[\d-]+\d$/.test(name)) return null;

  const lastDash = name.lastIndexOf("-");
  if (lastDash <= 0) return null;

  const reference = name.slice(0, lastDash);
  const ourInvoiceNumber = name.slice(lastDash + 1);

  if (!reference || !ourInvoiceNumber) return null;

  return { reference, ourInvoiceNumber };
}
