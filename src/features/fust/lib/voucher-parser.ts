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
}

/**
 * Extract text lines from a PDF buffer using pdfjs-dist.
 * Groups text items by Y-position into logical lines.
 */
async function extractTextLines(buffer: Buffer): Promise<string[]> {
  // Dynamic import for pdfjs-dist (ESM-only in v5)
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;

  const allLines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let currentLine = "";
    for (const item of content.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textItem = item as any;
      if (!textItem.str && textItem.str !== "") continue;
      const y = textItem.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        allLines.push(currentLine);
        currentLine = "";
      }
      currentLine += (currentLine ? " " : "") + textItem.str;
      lastY = y;
    }
    if (currentLine) allLines.push(currentLine);
  }

  return allLines;
}

/**
 * Parse an RFH (Royal FloraHolland) issuance voucher PDF.
 *
 * Actual pdfjs-dist output structure (lines by Y-position):
 *   0: "21-May-25 02:22 uur"              ← transaction date
 *   1: "BON UITGIFTE"                     ← type (or "BON INNAME" / "FUSTBON")
 *   2: "4244436"                          ← transaction number
 *   3: "Aalsmeer"                         ← location (or customer name for FUSTBON)
 *   4: "61536 Klantnummer"                ← customer number
 *   ...labels (Locatie, Transporteur, etc.)...
 *  10: "Van Straalen De Vries"            ← transporter name
 *  11: "F210001600007116-HYI"             ← card number
 *  12: "Fustcode   Stuks"                 ← header
 *  13: "Klantnaam   My-Peony BV"          ← customer name
 *  15: "Creatiedatum   20-May-25 13:28 uur"
 *  17: "588 Medium container   400"       ← item (may have 1.000 format)
 *  18: "520 Bloemendoos 19cm   264"       ← item
 */
export async function parseIssuanceVoucherPdf(
  buffer: Buffer
): Promise<ParsedVoucher> {
  let lines: string[] = [];
  try {
    lines = await extractTextLines(buffer);
  } catch {
    return emptyResult();
  }

  if (lines.length < 3) return emptyResult();

  const fullText = lines.join("\n");

  // Type: BON UITGIFTE, BON INNAME, or FUSTBON (overboeking)
  const typeLine = lines[1] || "";
  const type: "uitgifte" | "inname" = /INNAME/i.test(typeLine)
    ? "inname"
    : "uitgifte";

  // Transaction number: line 2 (purely numeric)
  const transactionNumber = /^\d{5,10}$/.test(lines[2]?.trim())
    ? lines[2].trim()
    : null;

  // Transaction date: first line matching dd-Mon-yy HH:mm pattern
  let transactionDate: string | null = null;
  const dateMatch = fullText.match(
    /(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+\d{2}:\d{2}/
  );
  if (dateMatch) {
    transactionDate = dateMatch[1];
  }

  // Location: line after transaction number, only if alphabetic (city name)
  let location: string | null = null;
  if (transactionNumber && lines[3]) {
    const candidate = lines[3].trim();
    if (/^[A-Za-z\s-]+$/.test(candidate) && candidate.length < 30) {
      location = candidate;
    }
  }

  // Customer number: digits before "Klantnummer"
  let customerNumber: string | null = null;
  const custMatch = fullText.match(/(\d{4,10})\s+Klantnummer/i);
  if (custMatch) {
    customerNumber = custMatch[1];
  }

  // Customer name: after "Klantnaam" (use the one near Fustcode section, not the label)
  let customerName: string | null = null;
  const nameMatch = fullText.match(/Klantnaam\s{2,}(.+)/i);
  if (nameMatch) {
    customerName = nameMatch[1].trim();
  }

  // Transporter name: line that contains a name (not a label, not a card number)
  // It appears after the labels and before the card number
  let transporterName: string | null = null;
  let cardNumber: string | null = null;

  for (const line of lines) {
    // Card number: starts with F followed by many digits
    if (/^F\d{6,}/.test(line.trim())) {
      cardNumber = line.trim();
    }
  }

  // Transporter is typically the line right before the card number
  const cardIdx = lines.findIndex((l) => /^F\d{6,}/.test(l.trim()));
  if (cardIdx > 0) {
    const candidate = lines[cardIdx - 1].trim();
    // Must not be a known label
    if (
      candidate &&
      !/^(Locatie|Transporteur|Pasnummer|Transactie|Klantnummer|Fustcode)/i.test(candidate) &&
      !/^\d+$/.test(candidate)
    ) {
      transporterName = candidate;
    }
  }

  // If no card number found, look for transporter after "Transactienummer" label
  if (!transporterName) {
    const txLabelIdx = lines.findIndex((l) => /^Transactienummer$/i.test(l.trim()));
    if (txLabelIdx >= 0 && txLabelIdx + 1 < lines.length) {
      const candidate = lines[txLabelIdx + 1].trim();
      if (candidate && !/^(F\d|Fustcode|\d+$)/i.test(candidate)) {
        transporterName = candidate;
      }
    }
  }

  // Creation date: after "Creatiedatum"
  let creationDate: string | null = null;
  const createMatch = fullText.match(
    /Creatiedatum\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i
  );
  if (createMatch) {
    creationDate = createMatch[1];
  }

  // Items: lines matching fust code pattern after "Fustcode" header
  // Format: "588 Medium container   400" or "520 Bloemendoos 19cm   -396"
  // Quantity may have thousand separators: "1.000"
  const items: ParsedVoucherItem[] = [];
  const fustHeaderIdx = lines.findIndex((l) => /Fustcode/i.test(l));

  if (fustHeaderIdx >= 0) {
    for (let i = fustHeaderIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      // Match: code (3-4 digits) + description + quantity (possibly negative, with dots as thousand sep)
      const itemMatch = line.match(
        /^(\d{3,4})\s+(.+?)\s{2,}(-?[\d.]+)$/
      );
      if (itemMatch) {
        // Remove thousand separators (dots) from quantity
        const qtyStr = itemMatch[3].replace(/\./g, "");
        items.push({
          fustCode: itemMatch[1],
          description: itemMatch[2].trim(),
          quantity: parseInt(qtyStr, 10),
        });
      } else if (
        /^(Deze|Door|Paeon|Voor vragen)/i.test(line)
      ) {
        // Footer text — stop parsing
        break;
      }
    }
  }

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
 * Parse a date string like "21-May-25" or "20-mei-25" to a JS Date.
 */
export function parseRfhDate(dateStr: string): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, mrt: 2, apr: 3, may: 4, mei: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11,
  };

  const match = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = months[match[2].toLowerCase()];
  if (month === undefined) return null;
  let year = parseInt(match[3], 10);
  if (year < 100) year += 2000;

  const date = new Date(year, month, day);
  return isNaN(date.getTime()) ? null : date;
}
