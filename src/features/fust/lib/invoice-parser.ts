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
  } catch {
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
