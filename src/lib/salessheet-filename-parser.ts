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
  /**
   * Delivery date as YYYY-MM-DD, or null when the filename carries none that
   * can be trusted. Used only as a fallback when the date cannot be read from
   * the PDF itself — see the matching in api/shipments/import-email.
   */
  deliveryDate: string | null;
}

/**
 * Read the delivery date out of the date segment of a filename.
 *
 * The segment looks like "08_01_2026 08_45_00" and is month-first: files such
 * as "07_30_2026" and "07_28_2026" only make sense that way, since 30 and 28
 * are no months. Anything that does not fit that shape, or that describes a
 * day the calendar does not have, yields null — a wrong date here would either
 * refuse a correct link or wave through a wrong one, and no date at all is the
 * safer of the two.
 */
function parseFilenameDate(segment: string): string | null {
  const m = segment.trim().match(/^(\d{2})_(\d{2})_(\d{4})\b/);
  if (!m) return null;

  const [, mm, dd, yyyy] = m;
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Rejects 02_30 and friends: Date rolls those over to the next month, so a
  // round-trip that changes the day means the date never existed.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${yyyy}-${mm}-${dd}`;
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

  return { supplierCode, reference, ourInvoiceNumber, deliveryDate: parseFilenameDate(parts[1]) };
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
