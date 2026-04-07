export interface ParsedVoucherItem {
  fustCode: string;
  description: string;
  quantity: number;
}

export interface ParsedVoucher {
  transactionNumber: string | null;
  type: "uitgifte" | "inname";
  transactionDate: string | null;
  creationDate: string | null;
  location: string | null;
  customerNumber: string | null;
  customerName: string | null;
  transporterName: string | null;
  cardNumber: string | null;
  items: ParsedVoucherItem[];
  _debugLines?: string[];
}

/**
 * Parse quantity string, removing thousand separators (dots/commas).
 */
function parseStuks(value: string): number {
  const cleaned = value.replace(/[.,]/g, "");
  return parseInt(cleaned, 10);
}

/**
 * Extract fust items from text.
 * Format: "520 Bloemendoos 19cm 198" or "520 Bloemendoos 19cm198"
 */
function parseFustItems(text: string): ParsedVoucherItem[] {
  const items: ParsedVoucherItem[] = [];
  const fustRegex = /^(\d{3,4})\s+(.+?)(-?[\d][\d.,]*)$/gm;
  let match;

  while ((match = fustRegex.exec(text)) !== null) {
    items.push({
      fustCode: match[1],
      description: match[2].trim(),
      quantity: parseStuks(match[3]),
    });
  }

  return items;
}

/**
 * Parse an RFH (Royal FloraHolland) issuance voucher PDF using pdfjs-dist.
 *
 * New format (2026+): "Fustbon Uitgifte/Inname" header with labeled fields
 * on the same line (e.g. "Transactienummer 0203120").
 *
 * Uses pdfjs-dist/legacy/build for Vercel serverless compatibility.
 */
export async function parseIssuanceVoucherPdf(
  buffer: Buffer
): Promise<ParsedVoucher> {
  let text = "";
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      verbosity: 0,
    }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let currentLine = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const textItem = item as { str: string; hasEOL?: boolean };
        currentLine += textItem.str;
        if (textItem.hasEOL) {
          lines.push(currentLine.trim());
          currentLine = "";
        }
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
      pages.push(lines.join("\n"));
    }
    text = pages.join("\n");
    await doc.destroy();
  } catch (err) {
    console.error("[VoucherParser] pdfjs-dist text extraction failed:", err);
    return emptyResult();
  }

  if (!text || text.length < 20) return emptyResult();

  const lines = text.split("\n");

  // ─── Type ──────────────────────────────────────────────
  // "Fustbon Uitgifte Dock/Bulk" or "Fustbon Inname ..."
  const type: "uitgifte" | "inname" =
    /inname/i.test(text) ? "inname" : "uitgifte";

  // ─── Transaction number ────────────────────────────────
  // "Transactienummer 0203120"
  let transactionNumber: string | null = null;
  const txMatch = text.match(/Transactienummer\s+(\d{5,10})/);
  if (txMatch) {
    transactionNumber = txMatch[1];
  }

  // ─── Location ──────────────────────────────────────────
  // Standalone line like "Aalsmeer" near the top
  let location: string | null = null;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const l = lines[i].trim();
    if (/^[A-Z][a-z]+$/.test(l) && l.length < 20) {
      location = l;
      break;
    }
  }

  // ─── Transporter ───────────────────────────────────────
  // "Transporteur 40903" → next line is the name
  let transporterName: string | null = null;
  const transporteurIdx = lines.findIndex((l) =>
    /^Transporteur\s+\d+/.test(l.trim())
  );
  if (transporteurIdx >= 0 && transporteurIdx + 1 < lines.length) {
    transporterName = lines[transporteurIdx + 1].trim();
  }

  // ─── Customer number ──────────────────────────────────
  // "61536Naar" (concatenated with "Naar") or "61536Van"
  let customerNumber: string | null = null;
  const custNrMatch = text.match(/(\d{4,10})(?:Naar|Van)\b/);
  if (custNrMatch) {
    customerNumber = custNrMatch[1];
  }

  // ─── Customer name ────────────────────────────────────
  // Line after customer number line (e.g. "My-Peony BV")
  let customerName: string | null = null;
  if (customerNumber) {
    const custLineIdx = lines.findIndex((l) =>
      l.includes(customerNumber + "Naar") || l.includes(customerNumber + "Van")
    );
    if (custLineIdx >= 0 && custLineIdx + 1 < lines.length) {
      customerName = lines[custLineIdx + 1].trim();
    }
  }

  // ─── Transaction date ─────────────────────────────────
  // "Transactiedatum 2 Apr 26 01:15 uur"
  let transactionDate: string | null = null;
  const txDateMatch = text.match(
    /Transactiedatum\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/
  );
  if (txDateMatch) {
    transactionDate = txDateMatch[1];
  }

  // ─── Creation date ────────────────────────────────────
  // "Creatiedatum 1 Apr 26 13:36 uur"
  let creationDate: string | null = null;
  const createMatch = text.match(
    /Creatiedatum\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i
  );
  if (createMatch) {
    creationDate = createMatch[1];
  }

  // ─── Card number ──────────────────────────────────────
  // "Pasnummer F210001600010155"
  let cardNumber: string | null = null;
  const cardMatch = text.match(/Pasnummer\s+(F\S+)/);
  if (cardMatch) {
    cardNumber = cardMatch[1];
  }

  // ─── Items ────────────────────────────────────────────
  const dataSection = text.split("Deze bon is het bewijs")[0] || text;
  const items = parseFustItems(dataSection);

  return {
    transactionNumber,
    type,
    transactionDate,
    creationDate,
    location,
    customerNumber,
    customerName,
    transporterName,
    cardNumber,
    items,
    ...(!transactionNumber && { _debugLines: lines.slice(0, 30) }),
  };
}

function emptyResult(): ParsedVoucher {
  return {
    transactionNumber: null,
    type: "uitgifte",
    transactionDate: null,
    creationDate: null,
    location: null,
    customerNumber: null,
    customerName: null,
    transporterName: null,
    cardNumber: null,
    items: [],
  };
}

/**
 * Parse a date string to a JS Date.
 * Supports: "21-May-25" (old), "2 Apr 26" (new), "20-mei-25"
 */
export function parseRfhDate(dateStr: string): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, mrt: 2, apr: 3, may: 4, mei: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11,
  };

  // Try "D Mon YY" (space-separated, new format)
  const spaceMatch = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/);
  if (spaceMatch) {
    const day = parseInt(spaceMatch[1], 10);
    const month = months[spaceMatch[2].toLowerCase()];
    if (month === undefined) return null;
    let year = parseInt(spaceMatch[3], 10);
    if (year < 100) year += 2000;
    const date = new Date(year, month, day);
    return isNaN(date.getTime()) ? null : date;
  }

  // Try "DD-Mon-YY" (dash-separated, old format)
  const dashMatch = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (dashMatch) {
    const day = parseInt(dashMatch[1], 10);
    const month = months[dashMatch[2].toLowerCase()];
    if (month === undefined) return null;
    let year = parseInt(dashMatch[3], 10);
    if (year < 100) year += 2000;
    const date = new Date(year, month, day);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}
