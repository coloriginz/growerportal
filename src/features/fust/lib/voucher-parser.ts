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
 * Parse an RFH (Royal FloraHolland) issuance voucher PDF.
 *
 * Expected text structure:
 *   21-May-25 02:22 uur
 *   BON UITGIFTE
 *   4244436
 *   Aalsmeer
 *   61536        Klantnummer
 *   Van Straalen De Vries
 *   F210001600007116-HYI
 *   Klantnaam My-Peony BV
 *   Creatiedatum 20-May-25 13:28
 *   Fustcode Stuks:
 *     588 Medium container 400
 *     520 Bloemendoos 19cm 264
 */
export async function parseIssuanceVoucherPdf(
  buffer: Buffer
): Promise<ParsedVoucher> {
  let text = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    text = data.text;
  } catch {
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

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Type: BON UITGIFTE or BON INNAME
  const type: "uitgifte" | "inname" = /BON\s+INNAME/i.test(text)
    ? "inname"
    : "uitgifte";

  // Transaction number: line after BON UITGIFTE/INNAME that is purely numeric
  let transactionNumber: string | null = null;
  const bonIdx = lines.findIndex((l) => /^BON\s+(UITGIFTE|INNAME)$/i.test(l));
  if (bonIdx >= 0) {
    for (let i = bonIdx + 1; i < Math.min(bonIdx + 3, lines.length); i++) {
      if (/^\d{5,10}$/.test(lines[i])) {
        transactionNumber = lines[i];
        break;
      }
    }
  }

  // Transaction date: first line matching dd-Mon-yy HH:mm pattern
  let transactionDate: string | null = null;
  const dateMatch = text.match(
    /(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+\d{2}:\d{2}/
  );
  if (dateMatch) {
    transactionDate = dateMatch[1];
  }

  // Location: line after transaction number (e.g., "Aalsmeer", "Naaldwijk")
  let location: string | null = null;
  if (transactionNumber) {
    const txIdx = lines.indexOf(transactionNumber);
    if (txIdx >= 0 && txIdx + 1 < lines.length) {
      const nextLine = lines[txIdx + 1];
      if (/^[A-Za-z\s]+$/.test(nextLine) && nextLine.length < 30) {
        location = nextLine;
      }
    }
  }

  // Customer number: digits before "Klantnummer"
  let customerNumber: string | null = null;
  const custMatch = text.match(/(\d{4,10})\s+Klantnummer/i);
  if (custMatch) {
    customerNumber = custMatch[1];
  }

  // Customer name: after "Klantnaam"
  let customerName: string | null = null;
  const nameMatch = text.match(/Klantnaam\s+(.+)/i);
  if (nameMatch) {
    customerName = nameMatch[1].trim();
  }

  // Transporter name: line between customer number line and card number line
  // Card number pattern: F followed by digits and dash
  let transporterName: string | null = null;
  let cardNumber: string | null = null;

  const custLineIdx = lines.findIndex((l) => /Klantnummer/i.test(l));
  const cardLineIdx = lines.findIndex((l) => /^F\d{6,}/.test(l));

  if (cardLineIdx >= 0) {
    cardNumber = lines[cardLineIdx];
    // Transporter is between customer number and card number
    if (custLineIdx >= 0 && cardLineIdx > custLineIdx + 1) {
      transporterName = lines[custLineIdx + 1];
    } else if (custLineIdx >= 0 && cardLineIdx === custLineIdx + 1) {
      // Card right after customer — look for transporter elsewhere
    }
  }

  // Creation date: after "Creatiedatum"
  let creationDate: string | null = null;
  const createMatch = text.match(
    /Creatiedatum\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+\d{2}:\d{2}/i
  );
  if (createMatch) {
    creationDate = createMatch[1];
  }

  // Items: after "Fustcode Stuks:" or "Fustcode" header
  // Format: 588 Medium container 400
  // or: 520 Bloemendoos 19cm 264
  const items: ParsedVoucherItem[] = [];
  const fustHeaderIdx = lines.findIndex((l) =>
    /Fustcode/i.test(l)
  );

  if (fustHeaderIdx >= 0) {
    for (let i = fustHeaderIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      // Match: code (3-4 digits) + description + quantity (possibly negative)
      const itemMatch = line.match(/^(\d{3,4})\s+(.+?)\s+(-?\d+)$/);
      if (itemMatch) {
        items.push({
          fustCode: itemMatch[1],
          description: itemMatch[2].trim(),
          quantity: parseInt(itemMatch[3], 10),
        });
      } else if (items.length > 0 && !/^\d/.test(line)) {
        // No more items — stop parsing
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

/**
 * Parse a date string like "21-May-25" or "20-May-25" to a JS Date.
 */
export function parseRfhDate(dateStr: string): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
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
