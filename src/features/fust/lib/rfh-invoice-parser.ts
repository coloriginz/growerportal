export interface ParsedRfhInvoiceLine {
  date: string; // "19.05.2026"
  fustCode: string; // "520"
  description: string; // "Bloemendoos 19cm"
  transactionType: string; // "Uitgifte Vast"
  location: string; // "Naaldwijk"
  voucherNumber: string; // "0281791"
  quantity: number; // 99
  statiegeldPrice: number | null;
  statiegeldAmount: number | null;
  fusthuurPrice: number | null;
  fusthuurAmount: number | null;
  vatCode: string; // "AG" | "NE"
}

export interface ParsedRfhInvoice {
  companyName: string | null;
  invoiceNumber: string | null; // "030536"
  rfhInvoiceNumber: string | null; // "030536.PA.2026.0010"
  invoiceDate: string | null; // "20.05.2026"
  lines: ParsedRfhInvoiceLine[];
  totalStatiegeld: number | null;
  totalFusthuur: number | null;
  _debugLines?: string[];
}

/**
 * Parse a Dutch-format number string (dots as thousands, comma as decimal).
 * E.g. "1.600,00" -> 1600.00, "0,22" -> 0.22
 */
function parseNlNumber(str: string): number | null {
  if (!str || str.trim() === "") return null;
  const cleaned = str.trim().replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse an RFH invoice date string "DD.MM.YYYY" to a JS Date.
 * E.g. "20.05.2026" -> Date(2026, 4, 20)
 */
export function parseRfhDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // 0-indexed
  const year = parseInt(match[3], 10);
  const date = new Date(year, month, day);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Extract text lines from all pages of a PDF buffer using pdfjs-dist.
 * Uses the same pattern as voucher-parser.ts for Vercel serverless compatibility.
 */
async function extractTextLines(buffer: Buffer): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  const allLines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let currentLine = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const textItem = item as { str: string; hasEOL?: boolean };
      currentLine += textItem.str;
      if (textItem.hasEOL) {
        allLines.push(currentLine.trim());
        currentLine = "";
      }
    }
    if (currentLine.trim()) allLines.push(currentLine.trim());
  }

  await doc.destroy();
  return allLines;
}

/**
 * Parse header fields from text lines.
 * Looks for: Nummer, Factuurnummer, Datum, and company name (first non-empty line).
 */
function parseHeader(lines: string[]): {
  companyName: string | null;
  invoiceNumber: string | null;
  rfhInvoiceNumber: string | null;
  invoiceDate: string | null;
} {
  let companyName: string | null = null;
  let invoiceNumber: string | null = null;
  let rfhInvoiceNumber: string | null = null;
  let invoiceDate: string | null = null;

  const fullText = lines.join("\n");

  // Company name: first non-empty line that looks like a company name
  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim();
    if (trimmed && /[A-Z]/.test(trimmed) && !trimmed.startsWith("Postbus") && !trimmed.match(/^\d/)) {
      companyName = trimmed;
      break;
    }
  }

  // Nummer (short invoice number)
  const nummerMatch = fullText.match(/Nummer\s+(\d{4,10})/);
  if (nummerMatch) {
    invoiceNumber = nummerMatch[1];
  }

  // Factuurnummer (full RFH invoice number like "030536.PA.2026.0010")
  const factuurMatch = fullText.match(/Factuurnummer\s+([\w.]+)/);
  if (factuurMatch) {
    rfhInvoiceNumber = factuurMatch[1];
  }

  // Datum - look for date in format DD.MM.YYYY
  const datumMatch = fullText.match(/Datum\s+\w+\s+(\d{2}\.\d{2}\.\d{4})/);
  if (datumMatch) {
    invoiceDate = datumMatch[1];
  } else {
    // Fallback: just look for date after "Datum"
    const datumFallback = fullText.match(/Datum\s+.*?(\d{2}\.\d{2}\.\d{4})/);
    if (datumFallback) {
      invoiceDate = datumFallback[1];
    }
  }

  return { companyName, invoiceNumber, rfhInvoiceNumber, invoiceDate };
}

/**
 * Try to parse a table data line. Returns a parsed line or null if not a data line.
 *
 * Expected format (columns may be concatenated by pdfjs):
 * "19.05.2026  520  Bloemendoos 19cm  Uitgifte Vast  Naaldwijk  0281791  99  5,00  495,00  AG"
 * "19.05.2026  520  Bloemendoos 19cm  Uitgifte Vast  Naaldwijk  0281791  99  0,22  21,78  NE"
 *
 * AG lines: statiegeld columns filled, fusthuur empty
 * NE lines: fusthuur columns filled, statiegeld empty
 */
function parseTableLine(line: string): ParsedRfhInvoiceLine | null {
  // Must start with a date pattern DD.MM.YYYY
  const dateMatch = line.match(/^(\d{2}\.\d{2}\.\d{4})/);
  if (!dateMatch) return null;

  const date = dateMatch[1];
  const rest = line.slice(date.length).trim();

  // Extract VAT code at the end (AG or NE)
  const vatMatch = rest.match(/\s+(AG|NE)\s*$/);
  if (!vatMatch) return null;
  const vatCode = vatMatch[1];
  const beforeVat = rest.slice(0, vatMatch.index).trim();

  // Extract fust code (3-4 digits) at the beginning of the remaining text
  const fustMatch = beforeVat.match(/^(\d{3,4})\s+/);
  if (!fustMatch) return null;
  const fustCode = fustMatch[1];
  const afterFust = beforeVat.slice(fustMatch[0].length);

  // Extract bonnummer (voucher number): sequence of 5-10 digits that appears before quantity/amounts
  // Strategy: find all number groups and identify the bonnummer vs quantities/amounts
  // The bonnummer is typically 6-7 digits, quantities are 1-5 digits, amounts have commas

  // Work from the right side to extract numeric fields (amounts and quantity)
  // Pattern for NE lines (fusthuur): quantity  [empty statiegeld]  fusthuurPrice  fusthuurAmount
  // Pattern for AG lines (statiegeld): quantity  statiegeldPrice  statiegeldAmount  [empty fusthuur]

  // Split the text into a descriptive part and a numeric part
  // The descriptive part contains: description, transaction type, location, bonnummer
  // The numeric part contains: quantity, price(s), amount(s)

  // Find the bonnummer - it's a 5-10 digit number that appears after the location
  // and before the quantity/price fields
  const bonnummerMatch = afterFust.match(/(\d{5,10})(?=\s+\d)/);
  if (!bonnummerMatch) return null;

  const bonnummerIdx = afterFust.indexOf(bonnummerMatch[0]);
  const textPart = afterFust.slice(0, bonnummerIdx).trim();
  const voucherNumber = bonnummerMatch[1];
  const numericPart = afterFust.slice(bonnummerIdx + bonnummerMatch[0].length).trim();

  // Parse the text part to extract description, transaction type, and location
  // Known transaction types
  const txTypes = [
    "Uitgifte Vast",
    "Uitgifte Dock/Bulk",
    "Uitgifte Dock",
    "Uitgifte Bulk",
    "Inname Vast",
    "Inname Dock/Bulk",
    "Inname Dock",
    "Inname Bulk",
  ];

  let description = "";
  let transactionType = "";
  let location = "";

  // Try to find a known transaction type in the text
  let txFound = false;
  for (const tx of txTypes) {
    const txIdx = textPart.indexOf(tx);
    if (txIdx >= 0) {
      description = textPart.slice(0, txIdx).trim();
      transactionType = tx;
      location = textPart.slice(txIdx + tx.length).trim();
      txFound = true;
      break;
    }
  }

  if (!txFound) {
    // Fallback: try regex for "Uitgifte/Inname + word"
    const txRegex = /(Uitgifte|Inname)\s+\S+/;
    const txMatch2 = textPart.match(txRegex);
    if (txMatch2) {
      const txIdx = textPart.indexOf(txMatch2[0]);
      description = textPart.slice(0, txIdx).trim();
      transactionType = txMatch2[0];
      location = textPart.slice(txIdx + txMatch2[0].length).trim();
    } else {
      // Cannot determine transaction type, put everything in description
      description = textPart;
    }
  }

  // Parse numeric part: extract all Dutch-format numbers
  const numbers: string[] = [];
  const numRegex = /-?[\d]+(?:\.[\d]{3})*(?:,[\d]{1,2})?/g;
  let numMatch;
  while ((numMatch = numRegex.exec(numericPart)) !== null) {
    numbers.push(numMatch[0]);
  }

  // Expected patterns:
  // AG line (statiegeld): [quantity, statiegeldPrice, statiegeldAmount]
  // NE line (fusthuur):   [quantity, fusthuurPrice, fusthuurAmount]
  // Some lines might have both or more/fewer numbers

  if (numbers.length < 1) return null;

  const quantity = parseNlNumber(numbers[0]) ?? 0;

  let statiegeldPrice: number | null = null;
  let statiegeldAmount: number | null = null;
  let fusthuurPrice: number | null = null;
  let fusthuurAmount: number | null = null;

  if (vatCode === "AG" && numbers.length >= 3) {
    statiegeldPrice = parseNlNumber(numbers[1]);
    statiegeldAmount = parseNlNumber(numbers[2]);
  } else if (vatCode === "NE" && numbers.length >= 3) {
    fusthuurPrice = parseNlNumber(numbers[1]);
    fusthuurAmount = parseNlNumber(numbers[2]);
  } else if (numbers.length >= 2) {
    // Fallback: try to assign based on vatCode
    if (vatCode === "AG") {
      statiegeldPrice = parseNlNumber(numbers[1]);
      statiegeldAmount = numbers.length >= 3 ? parseNlNumber(numbers[2]) : null;
    } else {
      fusthuurPrice = parseNlNumber(numbers[1]);
      fusthuurAmount = numbers.length >= 3 ? parseNlNumber(numbers[2]) : null;
    }
  }

  return {
    date,
    fustCode,
    description,
    transactionType,
    location,
    voucherNumber,
    quantity: Math.round(quantity),
    statiegeldPrice,
    statiegeldAmount,
    fusthuurPrice,
    fusthuurAmount,
    vatCode,
  };
}

/**
 * Parse totals from the "Totaal" line.
 * Expected format: "Totaal  2.095,00  149,78"
 * or variations with whitespace/labels.
 */
function parseTotals(lines: string[]): {
  totalStatiegeld: number | null;
  totalFusthuur: number | null;
} {
  let totalStatiegeld: number | null = null;
  let totalFusthuur: number | null = null;

  for (const line of lines) {
    if (!/^Totaal/i.test(line.trim())) continue;

    const afterTotaal = line.replace(/^Totaal/i, "").trim();
    const numRegex = /-?[\d]+(?:\.[\d]{3})*(?:,[\d]{1,2})?/g;
    const numbers: string[] = [];
    let match;
    while ((match = numRegex.exec(afterTotaal)) !== null) {
      numbers.push(match[0]);
    }

    // Typically: [totalStatiegeld, totalFusthuur] or just one total
    if (numbers.length >= 2) {
      totalStatiegeld = parseNlNumber(numbers[0]);
      totalFusthuur = parseNlNumber(numbers[1]);
    } else if (numbers.length === 1) {
      // Single total - could be either; assume statiegeld if large
      totalStatiegeld = parseNlNumber(numbers[0]);
    }
    break;
  }

  return { totalStatiegeld, totalFusthuur };
}

/**
 * Parse an RFH (Royal FloraHolland) invoice PDF.
 *
 * Extracts header information (company, invoice number, date) and
 * line items from the "Emballage meermalig" table section.
 *
 * Uses pdfjs-dist/legacy/build for Vercel serverless compatibility.
 */
export async function parseRfhInvoicePdf(
  buffer: Buffer
): Promise<ParsedRfhInvoice> {
  let lines: string[];
  try {
    lines = await extractTextLines(buffer);
  } catch (err) {
    console.error("[RfhInvoiceParser] pdfjs-dist text extraction failed:", err);
    return emptyResult();
  }

  if (!lines.length || lines.join("").length < 20) {
    return emptyResult();
  }

  // Parse header
  const header = parseHeader(lines);

  // Find table section start - look for the table header row
  const tableHeaderPatterns = [
    /Bonnummer/i,
    /Emballage\s+meermalig/i,
    /Fustcode/i,
  ];
  let tableStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (tableHeaderPatterns.some((p) => p.test(lines[i]))) {
      tableStartIdx = i + 1;
      break;
    }
  }

  // Parse table lines
  const parsedLines: ParsedRfhInvoiceLine[] = [];
  const startIdx = tableStartIdx > 0 ? tableStartIdx : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Stop at totals or footer
    if (/^Totaal/i.test(line)) break;
    if (/^Pagina\s+\d/i.test(line)) continue; // Page number, skip
    if (/^Datum\s+Fustcode/i.test(line)) continue; // Repeated table header

    const parsed = parseTableLine(line);
    if (parsed) {
      parsedLines.push(parsed);
    }
  }

  // Parse totals from the "Totaal" line, then validate/fallback using line sums
  const totals = parseTotals(lines);

  // Calculate totals from parsed lines as fallback
  let calcStatiegeld = 0;
  let calcFusthuur = 0;
  for (const pl of parsedLines) {
    calcStatiegeld += pl.statiegeldAmount ?? 0;
    calcFusthuur += pl.fusthuurAmount ?? 0;
  }

  // Use calculated totals if parsed totals are missing or zero but lines have data
  const totalStatiegeld = (totals.totalStatiegeld != null && totals.totalStatiegeld !== 0)
    ? totals.totalStatiegeld
    : calcStatiegeld || totals.totalStatiegeld;
  const totalFusthuur = (totals.totalFusthuur != null && totals.totalFusthuur !== 0)
    ? totals.totalFusthuur
    : calcFusthuur || totals.totalFusthuur;

  // If no lines parsed successfully, include debug info
  const result: ParsedRfhInvoice = {
    ...header,
    lines: parsedLines,
    totalStatiegeld,
    totalFusthuur,
  };

  if (parsedLines.length === 0 && lines.length > 0) {
    result._debugLines = lines.slice(0, 50);
  }

  return result;
}

function emptyResult(): ParsedRfhInvoice {
  return {
    companyName: null,
    invoiceNumber: null,
    rfhInvoiceNumber: null,
    invoiceDate: null,
    lines: [],
    totalStatiegeld: null,
    totalFusthuur: null,
  };
}
