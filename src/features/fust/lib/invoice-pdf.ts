import type { TDocumentDefinitions, Content, TableCell } from "pdfmake/interfaces";

// pdfmake server-side entry point (singleton). No type declarations for server API.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfmake = require("pdfmake/js/index.js") as {
  setFonts: (fonts: Record<string, Record<string, string>>) => void;
  setUrlAccessPolicy: (callback: ((url: string) => boolean) | undefined) => void;
  virtualfs: {
    writeFileSync: (filename: string, content: Buffer) => void;
  };
  createPdf: (docDefinition: TDocumentDefinitions) => {
    getBuffer: () => Promise<Buffer>;
  };
};

// Load Roboto fonts from pdfmake's own font container (uses __dirname internally,
// which works because pdfmake is in serverExternalPackages and not webpack-bundled).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontContainer = require("pdfmake/js/browser-extensions/fonts/Roboto") as {
  vfs: Record<string, { data: string; encoding: BufferEncoding }>;
  fonts: Record<string, Record<string, string>>;
};

// Write fonts into pdfmake's virtual file system
for (const [name, entry] of Object.entries(fontContainer.vfs)) {
  pdfmake.virtualfs.writeFileSync(name, Buffer.from(entry.data, entry.encoding));
}
pdfmake.setFonts(fontContainer.fonts);

// Suppress "No URL access policy defined" warning — we only use local font files.
pdfmake.setUrlAccessPolicy(() => false);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string; // formatted as "dd-mm-yyyy"
  supplier: {
    code: string;
    name: string;
    company: string | null;
    street: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
  };
  items: Array<{
    articleCode: string;
    description: string;
    quantity: number;
    unitPrice: number; // in EUR
    totalPrice: number; // in EUR
  }>;
  subtotalExVat: number;
  vatRate: number; // e.g. 21
  vatAmount: number;
  totalInclVat: number;
  notes: string | null;
  branding: {
    companyName: string;
    logoBase64: string;
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a monetary value in Dutch style: comma as decimal, dot as thousands.
 * Always shows 2 decimal places, no currency symbol.
 */
function formatAmount(value: number): string {
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a monetary value with euro sign prefix.
 */
function formatCurrency(value: number): string {
  return `\u20AC ${formatAmount(value)}`;
}

// ---------------------------------------------------------------------------
// Colours & constants
// ---------------------------------------------------------------------------

const PRIMARY_COLOR = "#2D6A4F";
const HEADER_BG = "#2D6A4F";
const HEADER_TEXT = "#FFFFFF";
const ROW_ALT_BG = "#F5F5F5";
const BORDER_COLOR = "#CCCCCC";
const LIGHT_GRAY = "#999999";

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

/**
 * Generate a professional fust invoice PDF and return the result as a Buffer.
 *
 * Uses pdfmake server-side (PdfPrinter) with bundled Roboto fonts.
 */
export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  // ------- Build document definition -------
  const docDefinition = buildDocDefinition(data);

  const outputDoc = pdfmake.createPdf(docDefinition);
  return outputDoc.getBuffer();
}

// ---------------------------------------------------------------------------
// Document definition builder
// ---------------------------------------------------------------------------

function buildDocDefinition(data: InvoicePdfData): TDocumentDefinitions {
  const { supplier, branding, items } = data;

  // Supplier address lines (skip null values)
  const supplierAddressLines: string[] = [supplier.name];
  if (supplier.company) supplierAddressLines.push(supplier.company);
  if (supplier.street) supplierAddressLines.push(supplier.street);
  const cityLine = [supplier.postalCode, supplier.city].filter(Boolean).join("  ");
  if (cityLine) supplierAddressLines.push(cityLine);
  if (supplier.country) supplierAddressLines.push(supplier.country);

  // Logo as data-URI for pdfmake
  const logoDataUri = `data:image/png;base64,${branding.logoBase64}`;

  // ------- Table rows -------
  const tableHeader: TableCell[] = [
    { text: "Code", style: "tableHeader" },
    { text: "Omschrijving", style: "tableHeader" },
    { text: "Aantal", style: "tableHeader", alignment: "right" },
    { text: "Prijs", style: "tableHeader", alignment: "right" },
    { text: "Bedrag", style: "tableHeader", alignment: "right" },
  ];

  const tableBody: TableCell[][] = items.map((item, idx) => {
    const fill = idx % 2 === 1 ? ROW_ALT_BG : undefined;
    return [
      { text: item.articleCode, fillColor: fill },
      { text: item.description, fillColor: fill },
      { text: item.quantity.toString(), alignment: "right" as const, fillColor: fill },
      { text: formatAmount(item.unitPrice), alignment: "right" as const, fillColor: fill },
      { text: formatAmount(item.totalPrice), alignment: "right" as const, fillColor: fill },
    ];
  });

  // ------- Totals block -------
  const totalsRows: TableCell[][] = [
    [
      { text: "Subtotaal excl. BTW", alignment: "right" as const, colSpan: 4, bold: false },
      {},
      {},
      {},
      { text: formatCurrency(data.subtotalExVat), alignment: "right" as const },
    ],
    [
      { text: `BTW ${data.vatRate}%`, alignment: "right" as const, colSpan: 4, bold: false },
      {},
      {},
      {},
      { text: formatCurrency(data.vatAmount), alignment: "right" as const },
    ],
    [
      {
        text: "Factuurtotaal",
        alignment: "right" as const,
        colSpan: 4,
        bold: true,
        fontSize: 11,
      },
      {},
      {},
      {},
      {
        text: formatCurrency(data.totalInclVat),
        alignment: "right" as const,
        bold: true,
        fontSize: 11,
      },
    ],
  ];

  // ------- Content -------
  const content: Content[] = [
    // ---- Header: logo + "FACTUUR" ----
    {
      columns: [
        {
          image: logoDataUri,
          width: 140,
        },
        {
          text: "FACTUUR",
          style: "invoiceTitle",
          alignment: "right",
          margin: [0, 10, 0, 0],
        },
      ],
      margin: [0, 0, 0, 20],
    },

    // ---- Company details + debtor ----
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: branding.companyName, style: "companyName" },
            { text: "P.O. Box 1076", style: "companyDetail" },
            { text: "1430 BB  Aalsmeer", style: "companyDetail" },
            { text: "The Netherlands", style: "companyDetail" },
          ],
        },
        {
          width: "auto",
          stack: [
            { text: "Debiteur", style: "sectionLabel" },
            { text: `Code: ${supplier.code}`, style: "debtorDetail", margin: [0, 4, 0, 0] },
            ...supplierAddressLines.map((line) => ({
              text: line,
              style: "debtorDetail" as const,
            })),
          ],
          alignment: "right" as const,
        },
      ],
      margin: [0, 0, 0, 20],
    },

    // ---- Invoice meta ----
    {
      columns: [
        {
          width: "*",
          text: "",
        },
        {
          width: "auto",
          stack: [
            {
              columns: [
                { text: "Factuurdatum:", width: 100, bold: true },
                { text: data.invoiceDate, width: "auto" },
              ],
            },
            {
              columns: [
                { text: "Factuurnr.:", width: 100, bold: true },
                { text: data.invoiceNumber, width: "auto" },
              ],
              margin: [0, 2, 0, 0],
            },
          ],
          alignment: "right" as const,
        },
      ],
      margin: [0, 0, 0, 20],
    },

    // ---- Separator ----
    {
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: 515,
          y2: 0,
          lineWidth: 1,
          lineColor: PRIMARY_COLOR,
        },
      ],
      margin: [0, 0, 0, 15],
    },

    // ---- Items table ----
    {
      table: {
        headerRows: 1,
        widths: [65, "*", 55, 70, 80],
        body: [tableHeader, ...tableBody],
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: TableCell[][] } }) =>
          i === 0 || i === 1 || i === node.table.body.length ? 1 : 0,
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 0 || i === 1 ? PRIMARY_COLOR : BORDER_COLOR),
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 5,
        paddingBottom: () => 5,
        fillColor: (rowIndex: number) => {
          if (rowIndex === 0) return HEADER_BG;
          return null;
        },
      },
      margin: [0, 0, 0, 10],
    },

    // ---- Totals ----
    {
      table: {
        widths: [65, "*", 55, 70, 80],
        body: totalsRows,
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: TableCell[][] } }) =>
          i === node.table.body.length ? 2 : i === node.table.body.length - 1 ? 1 : 0,
        vLineWidth: () => 0,
        hLineColor: () => PRIMARY_COLOR,
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
      margin: [0, 0, 0, 25],
    },
  ];

  // Optional notes
  if (data.notes) {
    content.push({
      stack: [
        { text: "Opmerkingen", style: "sectionLabel", margin: [0, 0, 0, 4] },
        { text: data.notes, fontSize: 9 },
      ],
      margin: [0, 0, 0, 20],
    });
  }

  // ---- Footer text ----
  content.push({
    text: "Op al onze transacties zijn de Voorwaarden van de VGB van toepassing.",
    style: "footerNote",
    margin: [0, 10, 0, 15],
  });

  // ---- Company registration info ----
  content.push({
    canvas: [
      {
        type: "line",
        x1: 0,
        y1: 0,
        x2: 515,
        y2: 0,
        lineWidth: 0.5,
        lineColor: BORDER_COLOR,
      },
    ],
    margin: [0, 0, 0, 8],
  });

  content.push({
    columns: [
      {
        width: "*",
        stack: [
          { text: "KvK: 34110415", style: "registrationInfo" },
          { text: "BTW: NL808953857B01", style: "registrationInfo" },
        ],
      },
      {
        width: "*",
        stack: [
          { text: "Bank: Rabobank", style: "registrationInfo", alignment: "center" },
          { text: "IBAN: NL22 RABO 0305 2825 63", style: "registrationInfo", alignment: "center" },
        ],
      },
      {
        width: "*",
        stack: [
          { text: `${branding.companyName}`, style: "registrationInfo", alignment: "right" },
          { text: "Aalsmeer, The Netherlands", style: "registrationInfo", alignment: "right" },
        ],
      },
    ],
  });

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 40],
    content,
    styles: {
      invoiceTitle: {
        fontSize: 26,
        bold: true,
        color: PRIMARY_COLOR,
      },
      companyName: {
        fontSize: 12,
        bold: true,
        color: PRIMARY_COLOR,
        margin: [0, 0, 0, 4],
      },
      companyDetail: {
        fontSize: 9,
        color: LIGHT_GRAY,
        margin: [0, 1, 0, 0],
      },
      sectionLabel: {
        fontSize: 10,
        bold: true,
        color: PRIMARY_COLOR,
      },
      debtorDetail: {
        fontSize: 9,
        margin: [0, 1, 0, 0],
      },
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: HEADER_TEXT,
      },
      footerNote: {
        fontSize: 8,
        italics: true,
        color: LIGHT_GRAY,
      },
      registrationInfo: {
        fontSize: 8,
        color: LIGHT_GRAY,
      },
    },
    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
    },
  };
}
