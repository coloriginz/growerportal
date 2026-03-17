export interface ParsedInvoiceData {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  items: Array<{
    fustCode: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  totalAmount: number;
}

export async function parseFustInvoicePdf(
  buffer: Buffer
): Promise<ParsedInvoiceData> {
  let text = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    text = data.text;
  } catch {
    // pdf-parse not installed or parsing failed - return empty result
    return { invoiceNumber: null, invoiceDate: null, items: [], totalAmount: 0 };
  }

  // Parse invoice number
  const invMatch = text.match(
    /(?:Factuurnummer|Invoice|Faktuurnummer)[:\s]*([A-Z0-9-]+)/i
  );
  const invoiceNumber = invMatch?.[1] ?? null;

  // Parse date
  const dateMatch = text.match(
    /(?:Datum|Date)[:\s]*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i
  );
  const invoiceDate = dateMatch?.[1] ?? null;

  // Parse line items - look for fust codes (Fc555, Fc566, 3170, 4100, etc.)
  const items: ParsedInvoiceData["items"] = [];
  const lineRegex =
    /(Fc?\d{3,4})\s+(.+?)\s+(\d+)\s+([\d,.]+)\s+([\d,.]+)/g;
  let match;
  while ((match = lineRegex.exec(text)) !== null) {
    items.push({
      fustCode: match[1],
      description: match[2].trim(),
      quantity: parseInt(match[3]),
      unitPrice: parseFloat(match[4].replace(",", ".")),
      totalPrice: parseFloat(match[5].replace(",", ".")),
    });
  }

  // Total amount
  const totalMatch = text.match(/(?:Totaal|Total)[:\s]*([\d.,]+)/i);
  const totalAmount = totalMatch
    ? parseFloat(totalMatch[1].replace(",", "."))
    : items.reduce((s, i) => s + i.totalPrice, 0);

  return { invoiceNumber, invoiceDate, items, totalAmount };
}
