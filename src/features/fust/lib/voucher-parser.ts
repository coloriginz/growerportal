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
 * Format: "520 Bloemendoos 19cm726" (quantity concatenated) or "588 Medium container   400" (with spaces)
 */
function parseFustItems(text: string): ParsedVoucherItem[] {
  const items: ParsedVoucherItem[] = [];
  // Pattern: 3-4 digit code + description + quantity (possibly concatenated, possibly negative)
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
 * Parse an RFH (Royal FloraHolland) issuance voucher PDF using pdf-parse.
 *
 * pdf-parse produces text where labels and values are often concatenated:
 *   "BON UITGIFTE\n4244436\nAalsmeer\n61536\nKlantnummer\n..."
 *   "KlantnaamMy-Peony BV"
 *   "Creatiedatum20-May-25 13:28 uur"
 *   "520 Bloemendoos 19cm726"
 */
export async function parseIssuanceVoucherPdf(
  buffer: Buffer
): Promise<ParsedVoucher> {
  let text = "";
  try {
    const { PDFParse } = await import("pdf-parse");
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParse({ data: uint8 });
    const result = await parser.getText();
    text = result.text;
    await parser.destroy();
  } catch (err) {
    console.error("[VoucherParser] pdf-parse failed:", err);
    return emptyResult();
  }

  if (!text || text.length < 20) return emptyResult();

  const lines = text.split("\n");

  console.log("[VoucherParser] Lines (first 15):", JSON.stringify(lines.slice(0, 15)));

  // Detect document type
  const isBonUitgifte = text.includes("BON UITGIFTE");
  const isBonInname = text.includes("BON INNAME");
  const isFustbon = text.includes("FUSTBON");

  const type: "uitgifte" | "inname" = isBonInname ? "inname" : "uitgifte";

  // Transaction number: line after the document type line
  let transactionNumber: string | null = null;
  const typeKeyword = isBonUitgifte
    ? "BON UITGIFTE"
    : isBonInname
      ? "BON INNAME"
      : isFustbon
        ? "FUSTBON"
        : null;

  if (typeKeyword) {
    const typeLineIdx = lines.findIndex((l) => l.trim() === typeKeyword);
    if (typeLineIdx >= 0 && typeLineIdx + 1 < lines.length) {
      const candidate = lines[typeLineIdx + 1]?.trim();
      if (candidate && /^\d{5,10}$/.test(candidate)) {
        transactionNumber = candidate;
      }
    }
  }

  // Fallback: search for standalone 7-digit number in first 10 lines
  if (!transactionNumber) {
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const m = lines[i].trim().match(/^(\d{7})$/);
      if (m) {
        transactionNumber = m[1];
        break;
      }
    }
  }

  console.log("[VoucherParser] Transaction number:", transactionNumber);

  // Location: line after transaction number (for BON types)
  let location: string | null = null;
  if (transactionNumber && !isFustbon) {
    const txLineIdx = lines.findIndex((l) => l.trim() === transactionNumber);
    if (txLineIdx >= 0 && txLineIdx + 1 < lines.length) {
      const candidate = lines[txLineIdx + 1].trim();
      if (/^[A-Za-z\s-]+$/.test(candidate) && candidate.length < 30) {
        location = candidate;
      }
    }
  }

  // Customer number: line before "Klantnummer" label
  let customerNumber: string | null = null;
  const klantnummerIdx = lines.findIndex((l) => l.trim() === "Klantnummer");
  if (klantnummerIdx > 0) {
    const candidate = lines[klantnummerIdx - 1]?.trim();
    if (candidate && /^\d{4,10}$/.test(candidate)) {
      customerNumber = candidate;
    }
  }

  // Customer name: "KlantnaamXXX" (concatenated, no space)
  let customerName: string | null = null;
  const klantnaamMatch = text.match(/Klantnaam(.+)/);
  if (klantnaamMatch) {
    customerName = klantnaamMatch[1].trim();
  }

  // Transporter: line after "Transactienummer" label
  let transporterName: string | null = null;
  const txLabelIdx = lines.findIndex((l) => l.trim() === "Transactienummer");
  if (txLabelIdx >= 0 && txLabelIdx + 1 < lines.length) {
    const candidate = lines[txLabelIdx + 1]?.trim();
    if (
      candidate &&
      candidate !== "FustcodeStuks" &&
      !candidate.startsWith("Klantnaam") &&
      !/^\d+$/.test(candidate)
    ) {
      transporterName = candidate;
    }
  }

  // Card number: F + digits pattern
  let cardNumber: string | null = null;
  const cardMatch = text.match(/(F\d{10,}-\S+)/);
  if (cardMatch) {
    cardNumber = cardMatch[1];
  }

  // Transaction date: first date pattern in text
  let transactionDate: string | null = null;
  const dateMatch = text.match(
    /(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+\d{2}:\d{2}/
  );
  if (dateMatch) {
    transactionDate = dateMatch[1];
  }

  // Creation date: "CreatiedatumDD-Mon-YY HH:MM uur" (concatenated)
  let creationDate: string | null = null;
  const createMatch = text.match(
    /Creatiedatum\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i
  );
  if (createMatch) {
    creationDate = createMatch[1];
  }

  // Fust items: from data section (before disclaimer text)
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
    // Include debug lines when parsing fails so we can diagnose
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
