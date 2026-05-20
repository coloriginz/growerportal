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
