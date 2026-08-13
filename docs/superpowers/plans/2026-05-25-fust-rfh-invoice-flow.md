# FUST RFH Invoice Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the grower ordering flow with an RFH invoice-driven flow where admin/finance imports auction invoices, allocates vouchers to growers, and generates grower invoices.

**Architecture:** New Prisma models (RfhInvoice, RfhInvoiceLine, RfhVoucherAllocation) with a PDF parser for RFH invoices. New API routes for CRUD + allocation. New UI components for list/detail views. Existing grower invoicing adapted to use allocated voucher data instead of order data. FustShell navigation simplified to remove ordering flow items.

**Tech Stack:** Next.js 15, Prisma 6, pdfjs-dist v4 (legacy build), Vercel Blob, Zod, shadcn/ui, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-05-25-fust-rfh-invoice-flow.md`

**Note:** This project has no automated test infrastructure. Verification steps use `npm run build` and manual runtime checks.

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/features/fust/lib/rfh-invoice-parser.ts` | Parse RFH invoice PDFs into structured data |
| `src/app/api/fust/rfh-invoices/route.ts` | GET list + POST upload/import |
| `src/app/api/fust/rfh-invoices/[id]/route.ts` | GET detail + DELETE |
| `src/app/api/fust/rfh-invoices/[id]/allocate/route.ts` | POST allocate + DELETE deallocate |
| `src/app/api/fust/rfh-invoices/import-email/route.ts` | POST email import (Power Automate) |
| `src/features/fust/components/rfh-invoices.tsx` | RFH invoice list UI |
| `src/features/fust/components/rfh-invoice-detail.tsx` | RFH invoice detail + allocation UI |
| `src/app/(portal)/fust/rfh-invoices/page.tsx` | Main portal page wrapper |
| `src/app/(portal)/fust/rfh-invoices/[id]/page.tsx` | Main portal detail page wrapper |
| `src/app/(fust-portal)/fust-portal/rfh-invoices/page.tsx` | Standalone portal page wrapper |
| `src/app/(fust-portal)/fust-portal/rfh-invoices/[id]/page.tsx` | Standalone portal detail page wrapper |

### Modified files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add RfhInvoice, RfhInvoiceLine, RfhVoucherAllocation models |
| `src/lib/fust-audit.ts` | Add 4 new audit actions |
| `src/features/fust/components/fust-shell.tsx` | Simplify navigation |
| `src/features/fust/components/fust-invoicing.tsx` | Data source: allocations instead of orders |
| `src/app/api/fust/grower-invoices/route.ts` | POST handler: build from allocations |
| `src/i18n/en.json` | Add translation keys |
| `src/i18n/nl.json` | Add translation keys |

---

## Task 1: Prisma Schema — New Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add RfhInvoice model**

Add after the existing FustGrowerInvoiceItem model (around line 670):

```prisma
model RfhInvoice {
  id                String   @id @default(uuid())
  invoiceNumber     String   @unique           // Short: "030536"
  rfhInvoiceNumber  String   @unique           // Full: "030536.PA.2026.0010"
  invoiceDate       DateTime
  companyId         String?
  company           Company? @relation(fields: [companyId], references: [id])
  totalStatiegeld   Decimal  @db.Decimal(10, 2)
  totalFusthuur     Decimal  @db.Decimal(10, 2)
  pdfUrl            String?
  status            String   @default("open")  // open | partial | complete | invoiced
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  lines       RfhInvoiceLine[]
  allocations RfhVoucherAllocation[]

  @@index([status])
  @@index([companyId])
  @@index([invoiceDate])
}
```

- [ ] **Step 2: Add RfhInvoiceLine model**

```prisma
model RfhInvoiceLine {
  id              String     @id @default(uuid())
  rfhInvoiceId    String
  rfhInvoice      RfhInvoice @relation(fields: [rfhInvoiceId], references: [id], onDelete: Cascade)
  date            DateTime
  fustCode        String
  description     String
  transactionType String
  location        String
  voucherNumber   String
  quantity        Int
  statiegeldPrice Decimal?   @db.Decimal(10, 2)
  statiegeldAmount Decimal?  @db.Decimal(10, 2)
  fusthuurPrice   Decimal?   @db.Decimal(10, 4)
  fusthuurAmount  Decimal?   @db.Decimal(10, 2)
  vatCode         String     // "AG" | "NE"

  @@index([rfhInvoiceId])
  @@index([voucherNumber])
}
```

- [ ] **Step 3: Add RfhVoucherAllocation model**

```prisma
model RfhVoucherAllocation {
  id             String               @id @default(uuid())
  rfhInvoiceId   String
  rfhInvoice     RfhInvoice           @relation(fields: [rfhInvoiceId], references: [id], onDelete: Cascade)
  voucherNumber  String
  voucherId      String?
  voucher        FustIssuanceVoucher?  @relation(fields: [voucherId], references: [id])
  supplierId     String?
  supplier       Supplier?            @relation(fields: [supplierId], references: [id])
  allocatedById  String?
  allocatedBy    User?                @relation("RfhAllocations", fields: [allocatedById], references: [id])
  allocatedAt    DateTime?

  @@unique([rfhInvoiceId, voucherNumber])
  @@index([rfhInvoiceId])
  @@index([voucherId])
  @@index([supplierId])
}
```

- [ ] **Step 4: Add relation fields to existing models**

Add to the `Company` model:
```prisma
  rfhInvoices RfhInvoice[]
```

Add to the `FustIssuanceVoucher` model:
```prisma
  rfhAllocations RfhVoucherAllocation[]
```

Add to the `Supplier` model:
```prisma
  rfhAllocations RfhVoucherAllocation[]
```

Add to the `User` model:
```prisma
  rfhAllocations RfhVoucherAllocation[] @relation("RfhAllocations")
```

- [ ] **Step 5: Stop dev server and push schema**

```bash
npx kill-port 3000
npx prisma db push
npx prisma generate
```

Verify: no errors from push or generate.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add RfhInvoice, RfhInvoiceLine, RfhVoucherAllocation models"
```

---

## Task 2: Audit Actions

**Files:**
- Modify: `src/lib/fust-audit.ts`

- [ ] **Step 1: Add RFH invoice audit actions**

Add to the `FUST_AUDIT_ACTIONS` array (before the closing `] as const`):

```typescript
  // RFH Invoice
  "rfh_invoice_imported",
  "rfh_invoice_deleted",
  "rfh_voucher_allocated",
  "rfh_voucher_deallocated",
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fust-audit.ts
git commit -m "feat: add RFH invoice audit actions"
```

---

## Task 3: RFH Invoice PDF Parser

**Files:**
- Create: `src/features/fust/lib/rfh-invoice-parser.ts`
- Reference: `src/features/fust/lib/voucher-parser.ts` (same pdfjs-dist pattern)

- [ ] **Step 1: Create the parser with types and extraction logic**

```typescript
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ParsedRfhInvoice {
  companyName: string | null;
  invoiceNumber: string | null;       // "030536"
  rfhInvoiceNumber: string | null;    // "030536.PA.2026.0010"
  invoiceDate: string | null;         // "20.05.2026"
  lines: ParsedRfhInvoiceLine[];
  totalStatiegeld: number | null;
  totalFusthuur: number | null;
}

export interface ParsedRfhInvoiceLine {
  date: string;              // "19.05.2026"
  fustCode: string;          // "520"
  description: string;       // "Bloemendoos 19cm"
  transactionType: string;   // "Uitgifte Vast"
  location: string;          // "Naaldwijk"
  voucherNumber: string;     // "0281791"
  quantity: number;          // 99
  statiegeldPrice: number | null;
  statiegeldAmount: number | null;
  fusthuurPrice: number | null;
  fusthuurAmount: number | null;
  vatCode: string;           // "AG" | "NE"
}

export async function parseRfhInvoicePdf(
  buffer: Buffer
): Promise<ParsedRfhInvoice> {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  const allLines: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let currentLine = "";
    for (const item of content.items) {
      if ("str" in item) {
        currentLine += item.str;
        if ("hasEOL" in item && item.hasEOL) {
          allLines.push(currentLine.trim());
          currentLine = "";
        }
      }
    }
    if (currentLine.trim()) {
      allLines.push(currentLine.trim());
    }
  }

  await doc.destroy();

  const text = allLines.join("\n");

  // Header extraction
  const companyName = extractCompanyName(allLines);
  const invoiceNumber = extractField(text, /Nummer\s+(\d{4,10})/);
  const rfhInvoiceNumber = extractField(
    text,
    /Factuurnummer\s+([\d.A-Z]+)/
  );
  const invoiceDate = extractField(
    text,
    /Datum\s+\w+\s+(\d{2}\.\d{2}\.\d{4})/
  );

  // Line items extraction
  const lines = extractLineItems(allLines);

  // Totals from parsed lines
  const totalStatiegeld = lines.reduce(
    (sum, l) => sum + (l.statiegeldAmount ?? 0),
    0
  );
  const totalFusthuur = lines.reduce(
    (sum, l) => sum + (l.fusthuurAmount ?? 0),
    0
  );

  return {
    companyName,
    invoiceNumber,
    rfhInvoiceNumber,
    invoiceDate,
    lines,
    totalStatiegeld: totalStatiegeld || null,
    totalFusthuur: totalFusthuur || null,
  };
}

function extractField(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match ? match[1] : null;
}

function extractCompanyName(lines: string[]): string | null {
  // Company name is the first non-empty line (before address lines)
  for (const line of lines.slice(0, 5)) {
    if (line && !line.match(/^(Postbus|Nederland|\d{4})/i)) {
      return line;
    }
  }
  return null;
}

function extractLineItems(lines: string[]): ParsedRfhInvoiceLine[] {
  const results: ParsedRfhInvoiceLine[] = [];

  // Find the start of the table (after "Emballage meermalig" or column header)
  let tableStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Bonnummer") || lines[i].includes("Emballage")) {
      tableStart = i + 1;
      break;
    }
  }
  if (tableStart === -1) return results;

  // Parse lines until "Totaal" or end
  // Line pattern: DD.MM.YYYY  CODE  Description  TransType  Location  BonNr  Qty  [Stat.Price  Stat.Amount]  [Huur.Price  Huur.Amount]  VatCode
  const lineRegex =
    /^(\d{2}\.\d{2}\.\d{4})\s+(\d{3,4})\s+(.+?)\s+(Uitgifte\s+\S+(?:\s+\S+)?)\s+(\S+)\s+(\d{4,10})\s+(\d[\d.,]*)\s+([\d.,]*)\s*([\d.,]*)\s*([\d.,]*)\s*([\d.,]*)\s*(NE|AG)\s*$/;

  for (let i = tableStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("Totaal")) break;
    if (!line || line.length < 20) continue;

    const match = line.match(lineRegex);
    if (match) {
      const vatCode = match[12];
      const qty = parseNlNumber(match[7]) ?? 0;

      // AG lines have statiegeld, NE lines have fusthuur
      let statiegeldPrice: number | null = null;
      let statiegeldAmount: number | null = null;
      let fusthuurPrice: number | null = null;
      let fusthuurAmount: number | null = null;

      if (vatCode === "AG") {
        statiegeldPrice = parseNlNumber(match[8]);
        statiegeldAmount = parseNlNumber(match[9]);
      } else if (vatCode === "NE") {
        fusthuurPrice = parseNlNumber(match[10]);
        fusthuurAmount = parseNlNumber(match[11]);
      }

      results.push({
        date: match[1],
        fustCode: match[2],
        description: match[3].trim(),
        transactionType: match[4].trim(),
        location: match[5],
        voucherNumber: match[6],
        quantity: qty,
        statiegeldPrice,
        statiegeldAmount,
        fusthuurPrice,
        fusthuurAmount,
        vatCode,
      });
    }
  }

  return results;
}

function parseNlNumber(str: string): number | null {
  if (!str || str.trim() === "") return null;
  // Dutch format: 1.234,56 → 1234.56
  const cleaned = str.replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse "20.05.2026" → Date */
export function parseRfhDate(dateStr: string): Date | null {
  const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return new Date(
    parseInt(match[3]),
    parseInt(match[2]) - 1,
    parseInt(match[1])
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: no TypeScript errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/features/fust/lib/rfh-invoice-parser.ts
git commit -m "feat: add RFH invoice PDF parser"
```

**Important:** This parser is based on the two sample PDFs provided. After testing with the bulk PDFs in "Private input/Rfh-facturen/grote bulk/", the regex patterns may need tuning. The structure (regex-based line extraction from pdfjs-dist text) is the same proven approach used in `voucher-parser.ts`.

---

## Task 4: Translation Keys

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/nl.json`

- [ ] **Step 1: Add English translations**

Add to `en.json` under appropriate sections:

```json
{
  "nav.rfhInvoices": "RFH Invoices",
  "rfh.title": "RFH Invoices",
  "rfh.uploadInvoice": "Upload Invoice",
  "rfh.invoiceNumber": "Invoice Number",
  "rfh.rfhInvoiceNumber": "RFH Invoice Number",
  "rfh.invoiceDate": "Invoice Date",
  "rfh.company": "Company",
  "rfh.vouchers": "Vouchers",
  "rfh.statiegeld": "Deposit",
  "rfh.fusthuur": "Rental",
  "rfh.total": "Total",
  "rfh.status": "Status",
  "rfh.statusOpen": "Open",
  "rfh.statusPartial": "Partial",
  "rfh.statusComplete": "Complete",
  "rfh.statusInvoiced": "Invoiced",
  "rfh.vouchersAllocated": "{count}/{total} vouchers",
  "rfh.allocateToGrower": "Allocate to grower",
  "rfh.deallocate": "Remove allocation",
  "rfh.selectGrower": "Select grower",
  "rfh.allocated": "Allocated",
  "rfh.unallocated": "Unallocated",
  "rfh.voucherNotes": "Notes",
  "rfh.transporter": "Transporter",
  "rfh.fustLines": "Fust items",
  "rfh.viewPdf": "View PDF",
  "rfh.viewVoucherPdf": "View voucher",
  "rfh.noInvoices": "No RFH invoices found",
  "rfh.importSuccess": "Invoice imported successfully",
  "rfh.importError": "Failed to import invoice",
  "rfh.duplicateInvoice": "Invoice already exists",
  "rfh.allocationSaved": "Allocation saved",
  "rfh.allocationRemoved": "Allocation removed",
  "rfh.deleteConfirm": "Delete this RFH invoice?",
  "rfh.deleted": "Invoice deleted",
  "rfh.filterStatus": "Filter by status",
  "rfh.filterCompany": "Filter by company",
  "rfh.allStatuses": "All statuses",
  "rfh.allCompanies": "All companies"
}
```

- [ ] **Step 2: Add Dutch translations**

Add to `nl.json`:

```json
{
  "nav.rfhInvoices": "RFH Facturen",
  "rfh.title": "RFH Facturen",
  "rfh.uploadInvoice": "Factuur uploaden",
  "rfh.invoiceNumber": "Factuurnummer",
  "rfh.rfhInvoiceNumber": "RFH Factuurnummer",
  "rfh.invoiceDate": "Factuurdatum",
  "rfh.company": "Bedrijf",
  "rfh.vouchers": "Bonnen",
  "rfh.statiegeld": "Statiegeld",
  "rfh.fusthuur": "Fusthuur",
  "rfh.total": "Totaal",
  "rfh.status": "Status",
  "rfh.statusOpen": "Open",
  "rfh.statusPartial": "Gedeeltelijk",
  "rfh.statusComplete": "Compleet",
  "rfh.statusInvoiced": "Gefactureerd",
  "rfh.vouchersAllocated": "{count}/{total} bonnen",
  "rfh.allocateToGrower": "Koppelen aan grower",
  "rfh.deallocate": "Koppeling verwijderen",
  "rfh.selectGrower": "Selecteer grower",
  "rfh.allocated": "Gekoppeld",
  "rfh.unallocated": "Niet gekoppeld",
  "rfh.voucherNotes": "Opmerkingen",
  "rfh.transporter": "Transporteur",
  "rfh.fustLines": "Fust regels",
  "rfh.viewPdf": "PDF bekijken",
  "rfh.viewVoucherPdf": "Bon bekijken",
  "rfh.noInvoices": "Geen RFH facturen gevonden",
  "rfh.importSuccess": "Factuur succesvol geimporteerd",
  "rfh.importError": "Factuur importeren mislukt",
  "rfh.duplicateInvoice": "Factuur bestaat al",
  "rfh.allocationSaved": "Koppeling opgeslagen",
  "rfh.allocationRemoved": "Koppeling verwijderd",
  "rfh.deleteConfirm": "Deze RFH factuur verwijderen?",
  "rfh.deleted": "Factuur verwijderd",
  "rfh.filterStatus": "Filter op status",
  "rfh.filterCompany": "Filter op bedrijf",
  "rfh.allStatuses": "Alle statussen",
  "rfh.allCompanies": "Alle bedrijven"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.json src/i18n/nl.json
git commit -m "feat: add RFH invoice translation keys (EN/NL)"
```

---

## Task 5: API Route — RFH Invoice List + Upload

**Files:**
- Create: `src/app/api/fust/rfh-invoices/route.ts`

- [ ] **Step 1: Create GET + POST route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { put } from "@vercel/blob";
import {
  parseRfhInvoicePdf,
  parseRfhDate,
} from "@/features/fust/lib/rfh-invoice-parser";
import { logFustEvent } from "@/lib/fust-audit";

export async function GET(request: NextRequest) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const companyId = searchParams.get("companyId");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (companyId) where.companyId = companyId;

  const invoices = await prisma.rfhInvoice.findMany({
    where,
    include: {
      company: { select: { id: true, name: true, slug: true } },
      allocations: {
        select: { id: true, voucherNumber: true, supplierId: true },
      },
      _count: { select: { lines: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });

  // Compute distinct voucher count and allocated count per invoice
  const result = invoices.map((inv) => {
    const voucherNumbers = [
      ...new Set(inv.allocations.map((a) => a.voucherNumber)),
    ];
    const allocatedCount = inv.allocations.filter(
      (a) => a.supplierId !== null
    ).length;
    return {
      ...inv,
      voucherCount: voucherNumbers.length,
      allocatedCount,
    };
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file || !file.name.endsWith(".pdf")) {
    return NextResponse.json(
      { error: "PDF file required" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Parse PDF
  let parsed;
  try {
    parsed = await parseRfhInvoicePdf(buffer);
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to parse PDF", details: String(e) },
      { status: 422 }
    );
  }

  if (!parsed.invoiceNumber || !parsed.rfhInvoiceNumber) {
    return NextResponse.json(
      { error: "Could not extract invoice number from PDF" },
      { status: 422 }
    );
  }

  // Duplicate check
  const existing = await prisma.rfhInvoice.findFirst({
    where: {
      OR: [
        { invoiceNumber: parsed.invoiceNumber },
        { rfhInvoiceNumber: parsed.rfhInvoiceNumber },
      ],
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Invoice already exists", invoiceId: existing.id },
      { status: 409 }
    );
  }

  // Match company by name
  let companyId: string | null = null;
  if (parsed.companyName) {
    const company = await prisma.company.findFirst({
      where: {
        name: { contains: parsed.companyName.split(" ")[0], mode: "insensitive" },
      },
    });
    companyId = company?.id ?? null;
  }

  // Upload PDF to Vercel Blob
  const blob = await put(
    `rfh-invoices/${parsed.rfhInvoiceNumber}.pdf`,
    buffer,
    { access: "public", contentType: "application/pdf" }
  );

  // Parse invoice date
  const invoiceDate = parsed.invoiceDate
    ? parseRfhDate(parsed.invoiceDate)
    : new Date();

  // Find matching vouchers for each unique voucher number in lines
  const voucherNumbers = [
    ...new Set(parsed.lines.map((l) => l.voucherNumber)),
  ];
  const existingVouchers = await prisma.fustIssuanceVoucher.findMany({
    where: { transactionNumber: { in: voucherNumbers } },
    select: { id: true, transactionNumber: true },
  });
  const voucherMap = new Map(
    existingVouchers.map((v) => [v.transactionNumber, v.id])
  );

  // Create invoice + lines + allocations in transaction
  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.rfhInvoice.create({
      data: {
        invoiceNumber: parsed.invoiceNumber!,
        rfhInvoiceNumber: parsed.rfhInvoiceNumber!,
        invoiceDate: invoiceDate ?? new Date(),
        companyId,
        totalStatiegeld: parsed.totalStatiegeld ?? 0,
        totalFusthuur: parsed.totalFusthuur ?? 0,
        pdfUrl: blob.url,
        status: "open",
        lines: {
          create: parsed.lines.map((line) => ({
            date: parseRfhDate(line.date) ?? new Date(),
            fustCode: line.fustCode,
            description: line.description,
            transactionType: line.transactionType,
            location: line.location,
            voucherNumber: line.voucherNumber,
            quantity: line.quantity,
            statiegeldPrice: line.statiegeldPrice,
            statiegeldAmount: line.statiegeldAmount,
            fusthuurPrice: line.fusthuurPrice,
            fusthuurAmount: line.fusthuurAmount,
            vatCode: line.vatCode,
          })),
        },
        allocations: {
          create: voucherNumbers.map((vn) => ({
            voucherNumber: vn,
            voucherId: voucherMap.get(vn) ?? null,
          })),
        },
      },
      include: {
        company: { select: { id: true, name: true } },
        lines: true,
        allocations: true,
      },
    });

    await logFustEvent({
      entityType: "rfh_invoice",
      entityId: inv.id,
      action: "rfh_invoice_imported",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: {
        invoiceNumber: inv.invoiceNumber,
        lineCount: parsed.lines.length,
        voucherCount: voucherNumbers.length,
        matchedVouchers: existingVouchers.length,
      },
      tx,
    });

    return inv;
  });

  return NextResponse.json(invoice, { status: 201 });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/fust/rfh-invoices/route.ts
git commit -m "feat: add RFH invoice list + upload API route"
```

---

## Task 6: API Route — RFH Invoice Detail + Delete

**Files:**
- Create: `src/app/api/fust/rfh-invoices/[id]/route.ts`

- [ ] **Step 1: Create GET + DELETE route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;

  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, slug: true } },
      lines: { orderBy: [{ voucherNumber: "asc" }, { vatCode: "asc" }] },
      allocations: {
        include: {
          voucher: {
            select: {
              id: true,
              transactionNumber: true,
              notes: true,
              transporterName: true,
              customerName: true,
              pdfUrl: true,
            },
          },
          supplier: {
            select: { id: true, code: true, name: true },
          },
          allocatedBy: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(invoice);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;

  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    select: { id: true, invoiceNumber: true, status: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (invoice.status === "invoiced") {
    return NextResponse.json(
      { error: "Cannot delete an invoiced RFH invoice" },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    // Cascade deletes lines + allocations
    await tx.rfhInvoice.delete({ where: { id } });

    await logFustEvent({
      entityType: "rfh_invoice",
      entityId: id,
      action: "rfh_invoice_deleted",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: { invoiceNumber: invoice.invoiceNumber },
      tx,
    });
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/fust/rfh-invoices/[id]/route.ts
git commit -m "feat: add RFH invoice detail + delete API route"
```

---

## Task 7: API Route — Voucher Allocation

**Files:**
- Create: `src/app/api/fust/rfh-invoices/[id]/allocate/route.ts`

- [ ] **Step 1: Create POST + DELETE route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { logFustEvent } from "@/lib/fust-audit";

const allocateSchema = z.object({
  voucherNumber: z.string().min(1),
  supplierId: z.string().uuid(),
});

const deallocateSchema = z.object({
  voucherNumber: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const result = allocateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid input", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { voucherNumber, supplierId } = result.data;

  // Verify invoice exists and is not invoiced
  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (invoice.status === "invoiced") {
    return NextResponse.json(
      { error: "Cannot modify an invoiced invoice" },
      { status: 400 }
    );
  }

  // Verify supplier exists and has fustEnabled
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, code: true, fustEnabled: true },
  });
  if (!supplier) {
    return NextResponse.json(
      { error: "Supplier not found" },
      { status: 404 }
    );
  }

  // Update allocation
  const allocation = await prisma.$transaction(async (tx) => {
    const alloc = await tx.rfhVoucherAllocation.update({
      where: {
        rfhInvoiceId_voucherNumber: { rfhInvoiceId: id, voucherNumber },
      },
      data: {
        supplierId,
        allocatedById: session!.user.id,
        allocatedAt: new Date(),
      },
    });

    // Recalculate invoice status
    const allAllocations = await tx.rfhVoucherAllocation.findMany({
      where: { rfhInvoiceId: id },
      select: { supplierId: true },
    });
    const allocatedCount = allAllocations.filter(
      (a) => a.supplierId !== null
    ).length;
    const newStatus =
      allocatedCount === 0
        ? "open"
        : allocatedCount === allAllocations.length
          ? "complete"
          : "partial";

    await tx.rfhInvoice.update({
      where: { id },
      data: { status: newStatus },
    });

    await logFustEvent({
      entityType: "rfh_invoice",
      entityId: id,
      action: "rfh_voucher_allocated",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: {
        voucherNumber,
        supplierId,
        supplierName: supplier.name,
        supplierCode: supplier.code,
      },
      tx,
    });

    return alloc;
  });

  return NextResponse.json(allocation);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth(["admin", "finance"]);
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const result = deallocateSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid input", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { voucherNumber } = result.data;

  const invoice = await prisma.rfhInvoice.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (invoice.status === "invoiced") {
    return NextResponse.json(
      { error: "Cannot modify an invoiced invoice" },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.rfhVoucherAllocation.update({
      where: {
        rfhInvoiceId_voucherNumber: { rfhInvoiceId: id, voucherNumber },
      },
      data: {
        supplierId: null,
        allocatedById: null,
        allocatedAt: null,
      },
    });

    // Recalculate status
    const allAllocations = await tx.rfhVoucherAllocation.findMany({
      where: { rfhInvoiceId: id },
      select: { supplierId: true },
    });
    const allocatedCount = allAllocations.filter(
      (a) => a.supplierId !== null
    ).length;
    const newStatus =
      allocatedCount === 0
        ? "open"
        : allocatedCount === allAllocations.length
          ? "complete"
          : "partial";

    await tx.rfhInvoice.update({
      where: { id },
      data: { status: newStatus },
    });

    await logFustEvent({
      entityType: "rfh_invoice",
      entityId: id,
      action: "rfh_voucher_deallocated",
      actorId: session!.user.id,
      actorName: session!.user.name,
      metadata: { voucherNumber },
      tx,
    });
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/fust/rfh-invoices/[id]/allocate/route.ts
git commit -m "feat: add voucher allocation/deallocation API route"
```

---

## Task 8: API Route — Email Import

**Files:**
- Create: `src/app/api/fust/rfh-invoices/import-email/route.ts`
- Reference: `src/app/api/fust/vouchers/import-email/route.ts` (same pattern)

- [ ] **Step 1: Create email import endpoint**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { put } from "@vercel/blob";
import {
  parseRfhInvoicePdf,
  parseRfhDate,
} from "@/features/fust/lib/rfh-invoice-parser";
import { logFustEvent } from "@/lib/fust-audit";

const importEmailSchema = z.object({
  subject: z.string(),
  from: z.string().optional(),
  receivedDateTime: z.string().optional(),
  attachments: z.array(
    z.object({
      name: z.string(),
      contentType: z.string(),
      contentBytes: z.string(), // base64
    })
  ),
});

export async function POST(request: NextRequest) {
  // API key auth (same as voucher import)
  const apiKey = process.env.IMPORT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Import API key not configured" },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? "";
  if (token !== apiKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const body = await request.json();
  const result = importEmailSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: result.error.flatten() },
      { status: 400 }
    );
  }

  const { attachments } = result.data;

  // Find PDF attachments
  const pdfAttachments = attachments.filter(
    (a) =>
      a.contentType === "application/pdf" ||
      a.name.toLowerCase().endsWith(".pdf")
  );

  if (pdfAttachments.length === 0) {
    return NextResponse.json(
      { error: "No PDF attachments found" },
      { status: 422 }
    );
  }

  const results: Array<{
    filename: string;
    success: boolean;
    invoiceId?: string;
    error?: string;
  }> = [];

  for (const attachment of pdfAttachments) {
    try {
      const buffer = Buffer.from(attachment.contentBytes, "base64");
      const parsed = await parseRfhInvoicePdf(buffer);

      if (!parsed.invoiceNumber || !parsed.rfhInvoiceNumber) {
        results.push({
          filename: attachment.name,
          success: false,
          error: "Could not extract invoice number",
        });
        continue;
      }

      // Duplicate check
      const existing = await prisma.rfhInvoice.findFirst({
        where: {
          OR: [
            { invoiceNumber: parsed.invoiceNumber },
            { rfhInvoiceNumber: parsed.rfhInvoiceNumber },
          ],
        },
      });
      if (existing) {
        results.push({
          filename: attachment.name,
          success: false,
          error: "Duplicate invoice",
          invoiceId: existing.id,
        });
        continue;
      }

      // Match company
      let companyId: string | null = null;
      if (parsed.companyName) {
        const company = await prisma.company.findFirst({
          where: {
            name: {
              contains: parsed.companyName.split(" ")[0],
              mode: "insensitive",
            },
          },
        });
        companyId = company?.id ?? null;
      }

      // Upload PDF
      const blob = await put(
        `rfh-invoices/${parsed.rfhInvoiceNumber}.pdf`,
        buffer,
        { access: "public", contentType: "application/pdf" }
      );

      const invoiceDate = parsed.invoiceDate
        ? parseRfhDate(parsed.invoiceDate)
        : new Date();

      // Match vouchers
      const voucherNumbers = [
        ...new Set(parsed.lines.map((l) => l.voucherNumber)),
      ];
      const existingVouchers = await prisma.fustIssuanceVoucher.findMany({
        where: { transactionNumber: { in: voucherNumbers } },
        select: { id: true, transactionNumber: true },
      });
      const voucherMap = new Map(
        existingVouchers.map((v) => [v.transactionNumber, v.id])
      );

      const invoice = await prisma.$transaction(async (tx) => {
        const inv = await tx.rfhInvoice.create({
          data: {
            invoiceNumber: parsed.invoiceNumber!,
            rfhInvoiceNumber: parsed.rfhInvoiceNumber!,
            invoiceDate: invoiceDate ?? new Date(),
            companyId,
            totalStatiegeld: parsed.totalStatiegeld ?? 0,
            totalFusthuur: parsed.totalFusthuur ?? 0,
            pdfUrl: blob.url,
            status: "open",
            lines: {
              create: parsed.lines.map((line) => ({
                date: parseRfhDate(line.date) ?? new Date(),
                fustCode: line.fustCode,
                description: line.description,
                transactionType: line.transactionType,
                location: line.location,
                voucherNumber: line.voucherNumber,
                quantity: line.quantity,
                statiegeldPrice: line.statiegeldPrice,
                statiegeldAmount: line.statiegeldAmount,
                fusthuurPrice: line.fusthuurPrice,
                fusthuurAmount: line.fusthuurAmount,
                vatCode: line.vatCode,
              })),
            },
            allocations: {
              create: voucherNumbers.map((vn) => ({
                voucherNumber: vn,
                voucherId: voucherMap.get(vn) ?? null,
              })),
            },
          },
        });

        await logFustEvent({
          entityType: "rfh_invoice",
          entityId: inv.id,
          action: "rfh_invoice_imported",
          metadata: {
            invoiceNumber: inv.invoiceNumber,
            source: "email",
            filename: attachment.name,
            lineCount: parsed.lines.length,
            voucherCount: voucherNumbers.length,
          },
          tx,
        });

        return inv;
      });

      results.push({
        filename: attachment.name,
        success: true,
        invoiceId: invoice.id,
      });
    } catch (e) {
      results.push({
        filename: attachment.name,
        success: false,
        error: String(e),
      });
    }
  }

  const allSuccess = results.every((r) => r.success);
  return NextResponse.json(
    { results },
    { status: allSuccess ? 201 : 207 }
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/fust/rfh-invoices/import-email/route.ts
git commit -m "feat: add RFH invoice email import API route"
```

---

## Task 9: FustShell Navigation Simplification

**Files:**
- Modify: `src/features/fust/components/fust-shell.tsx`

- [ ] **Step 1: Read current fust-shell.tsx**

Read `src/features/fust/components/fust-shell.tsx` to find exact navItems and adminItems arrays.

- [ ] **Step 2: Replace navItems array**

Replace the existing `navItems` array (lines ~58-69) with:

```typescript
const navItems: NavItem[] = [
  { href: fustHref("/rfh-invoices"), labelKey: "nav.rfhInvoices", icon: RiFileTextLine, roles: ["admin", "finance"] },
  { href: fustHref("/vouchers"), labelKey: "nav.fustVouchers", icon: RiCouponLine, roles: ["admin", "finance"] },
  { href: fustHref("/invoices"), labelKey: "nav.fustInvoices", icon: RiReceiptLine, roles: ["admin", "finance"] },
  { href: fustHref("/activity"), labelKey: "nav.fustActivity", icon: RiHistoryLine, roles: ["admin", "finance"] },
];
```

Note: Check the existing code for the exact `fustHref` helper or path construction pattern. If there's no `fustHref` helper, the paths should use the existing pattern for switching between `/fust-portal` and `/fust` depending on standalone vs main portal context.

- [ ] **Step 3: Replace adminItems array**

Replace the existing `adminItems` array (lines ~71-77) with:

```typescript
const adminItems: NavItem[] = [
  { href: fustHref("/emails"), labelKey: "nav.fustEmails", icon: RiMailLine, roles: ["admin", "finance"] },
  { href: fustHref("/settings?tab=suppliers"), labelKey: "fust.supplierAccess", icon: RiGroupLine, roles: ["admin"] },
];
```

- [ ] **Step 4: Remove supplier and transporteur role filtering**

In the `filteredNav` computation, remove the `fustEnabled` check for suppliers since suppliers no longer see fust navigation:

```typescript
const filteredNav = navItems.filter(
  (item) => item.roles?.includes(userRole)
);
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/features/fust/components/fust-shell.tsx
git commit -m "refactor: simplify FustShell navigation for RFH invoice flow"
```

---

## Task 10: Page Files

**Files:**
- Create: `src/app/(portal)/fust/rfh-invoices/page.tsx`
- Create: `src/app/(portal)/fust/rfh-invoices/[id]/page.tsx`
- Create: `src/app/(fust-portal)/fust-portal/rfh-invoices/page.tsx`
- Create: `src/app/(fust-portal)/fust-portal/rfh-invoices/[id]/page.tsx`

- [ ] **Step 1: Create main portal list page**

File: `src/app/(portal)/fust/rfh-invoices/page.tsx`

```tsx
import { Suspense } from "react";
import { RfhInvoices } from "@/features/fust/components/rfh-invoices";

export default function RfhInvoicesPage() {
  return (
    <Suspense>
      <RfhInvoices />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create main portal detail page**

File: `src/app/(portal)/fust/rfh-invoices/[id]/page.tsx`

```tsx
import { Suspense } from "react";
import { RfhInvoiceDetail } from "@/features/fust/components/rfh-invoice-detail";

export default async function RfhInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <RfhInvoiceDetail invoiceId={id} />
    </Suspense>
  );
}
```

- [ ] **Step 3: Create standalone portal list page**

File: `src/app/(fust-portal)/fust-portal/rfh-invoices/page.tsx`

```tsx
import { Suspense } from "react";
import { RfhInvoices } from "@/features/fust/components/rfh-invoices";

export default function RfhInvoicesPage() {
  return (
    <Suspense>
      <RfhInvoices />
    </Suspense>
  );
}
```

- [ ] **Step 4: Create standalone portal detail page**

File: `src/app/(fust-portal)/fust-portal/rfh-invoices/[id]/page.tsx`

```tsx
import { Suspense } from "react";
import { RfhInvoiceDetail } from "@/features/fust/components/rfh-invoice-detail";

export default async function RfhInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <RfhInvoiceDetail invoiceId={id} />
    </Suspense>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/(portal)/fust/rfh-invoices/ src/app/(fust-portal)/fust-portal/rfh-invoices/
git commit -m "feat: add RFH invoice page files for both portals"
```

---

## Task 11: UI Component — RFH Invoice List

**Files:**
- Create: `src/features/fust/components/rfh-invoices.tsx`

- [ ] **Step 1: Create the list component**

```tsx
"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFetch } from "@/hooks/use-fetch";
import { useLanguage } from "@/components/providers/language-provider";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { RiUploadLine, RiLoader4Line } from "@remixicon/react";

interface RfhInvoiceListItem {
  id: string;
  invoiceNumber: string;
  rfhInvoiceNumber: string;
  invoiceDate: string;
  totalStatiegeld: string;
  totalFusthuur: string;
  status: string;
  pdfUrl: string | null;
  company: { id: string; name: string; slug: string } | null;
  voucherCount: number;
  allocatedCount: number;
}

interface Company {
  id: string;
  name: string;
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  open: "destructive",
  partial: "secondary",
  complete: "default",
  invoiced: "outline",
};

export function RfhInvoices() {
  const { t } = useLanguage();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (companyFilter !== "all") params.set("companyId", companyFilter);
    return `/api/fust/rfh-invoices?${params.toString()}`;
  }, [statusFilter, companyFilter]);

  const { data: invoices, loading, refetch } = useFetch<RfhInvoiceListItem[]>(url);
  const { data: companies } = useFetch<Company[]>("/api/companies");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/fust/rfh-invoices", {
        method: "POST",
        body: formData,
      });

      if (res.status === 409) {
        toast.error(t("rfh.duplicateInvoice"));
      } else if (res.ok) {
        toast.success(t("rfh.importSuccess"));
        refetch();
      } else {
        const data = await res.json();
        toast.error(data.error || t("rfh.importError"));
      }
    } catch {
      toast.error(t("rfh.importError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("rfh.title")}</h1>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RiUploadLine className="mr-2 h-4 w-4" />
            )}
            {t("rfh.uploadInvoice")}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("rfh.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("rfh.allStatuses")}</SelectItem>
            <SelectItem value="open">{t("rfh.statusOpen")}</SelectItem>
            <SelectItem value="partial">{t("rfh.statusPartial")}</SelectItem>
            <SelectItem value="complete">{t("rfh.statusComplete")}</SelectItem>
            <SelectItem value="invoiced">{t("rfh.statusInvoiced")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("rfh.filterCompany")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("rfh.allCompanies")}</SelectItem>
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !invoices?.length ? (
        <p className="text-center text-muted-foreground py-8">
          {t("rfh.noInvoices")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("rfh.status")}</TableHead>
              <TableHead>{t("rfh.invoiceNumber")}</TableHead>
              <TableHead>{t("rfh.invoiceDate")}</TableHead>
              <TableHead>{t("rfh.company")}</TableHead>
              <TableHead>{t("rfh.vouchers")}</TableHead>
              <TableHead className="text-right">{t("rfh.statiegeld")}</TableHead>
              <TableHead className="text-right">{t("rfh.fusthuur")}</TableHead>
              <TableHead className="text-right">{t("rfh.total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => {
              const total =
                parseFloat(inv.totalStatiegeld) +
                parseFloat(inv.totalFusthuur);
              return (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`rfh-invoices/${inv.id}`)}
                >
                  <TableCell>
                    <Badge variant={statusVariant[inv.status] ?? "outline"}>
                      {inv.allocatedCount}/{inv.voucherCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {inv.invoiceNumber}
                  </TableCell>
                  <TableCell>{formatDate(new Date(inv.invoiceDate))}</TableCell>
                  <TableCell>{inv.company?.name ?? "-"}</TableCell>
                  <TableCell>
                    {inv.voucherCount}{" "}
                    {inv.voucherCount === 1 ? "bon" : "bonnen"}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(parseFloat(inv.totalStatiegeld))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(parseFloat(inv.totalFusthuur))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(total)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/features/fust/components/rfh-invoices.tsx
git commit -m "feat: add RFH invoice list UI component"
```

---

## Task 12: UI Component — RFH Invoice Detail + Allocation

**Files:**
- Create: `src/features/fust/components/rfh-invoice-detail.tsx`

- [ ] **Step 1: Create the detail component**

```tsx
"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useFetch } from "@/hooks/use-fetch";
import { useLanguage } from "@/components/providers/language-provider";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  RiArrowLeftLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFilePdfLine,
  RiLoader4Line,
  RiCheckLine,
  RiCloseLine,
} from "@remixicon/react";

interface RfhInvoiceData {
  id: string;
  invoiceNumber: string;
  rfhInvoiceNumber: string;
  invoiceDate: string;
  totalStatiegeld: string;
  totalFusthuur: string;
  status: string;
  pdfUrl: string | null;
  company: { id: string; name: string; slug: string } | null;
  lines: Array<{
    id: string;
    date: string;
    fustCode: string;
    description: string;
    transactionType: string;
    location: string;
    voucherNumber: string;
    quantity: number;
    statiegeldPrice: string | null;
    statiegeldAmount: string | null;
    fusthuurPrice: string | null;
    fusthuurAmount: string | null;
    vatCode: string;
  }>;
  allocations: Array<{
    id: string;
    voucherNumber: string;
    voucherId: string | null;
    supplierId: string | null;
    allocatedAt: string | null;
    voucher: {
      id: string;
      transactionNumber: string;
      notes: string | null;
      transporterName: string | null;
      customerName: string | null;
      pdfUrl: string | null;
    } | null;
    supplier: {
      id: string;
      code: string;
      name: string;
    } | null;
    allocatedBy: {
      id: string;
      name: string;
    } | null;
  }>;
}

interface SupplierOption {
  id: string;
  code: string;
  name: string;
  fustEnabled: boolean;
}

export function RfhInvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { t } = useLanguage();
  const router = useRouter();

  const { data: invoice, loading, refetch } = useFetch<RfhInvoiceData>(
    `/api/fust/rfh-invoices/${invoiceId}`
  );
  const { data: suppliers } = useFetch<SupplierOption[]>("/api/suppliers");

  const fustSuppliers = useMemo(
    () => suppliers?.filter((s) => s.fustEnabled) ?? [],
    [suppliers]
  );

  // Group lines by voucher number
  const voucherGroups = useMemo(() => {
    if (!invoice) return [];
    const groups = new Map<
      string,
      {
        voucherNumber: string;
        allocation: RfhInvoiceData["allocations"][0] | null;
        lines: RfhInvoiceData["lines"];
      }
    >();

    for (const line of invoice.lines) {
      if (!groups.has(line.voucherNumber)) {
        const allocation =
          invoice.allocations.find(
            (a) => a.voucherNumber === line.voucherNumber
          ) ?? null;
        groups.set(line.voucherNumber, {
          voucherNumber: line.voucherNumber,
          allocation,
          lines: [],
        });
      }
      groups.get(line.voucherNumber)!.lines.push(line);
    }

    return Array.from(groups.values());
  }, [invoice]);

  const handleAllocate = async (
    voucherNumber: string,
    supplierId: string
  ) => {
    const res = await fetch(
      `/api/fust/rfh-invoices/${invoiceId}/allocate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherNumber, supplierId }),
      }
    );
    if (res.ok) {
      toast.success(t("rfh.allocationSaved"));
      refetch();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error");
    }
  };

  const handleDeallocate = async (voucherNumber: string) => {
    const res = await fetch(
      `/api/fust/rfh-invoices/${invoiceId}/allocate`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherNumber }),
      }
    );
    if (res.ok) {
      toast.success(t("rfh.allocationRemoved"));
      refetch();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error");
    }
  };

  const handleDelete = async () => {
    const res = await fetch(`/api/fust/rfh-invoices/${invoiceId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success(t("rfh.deleted"));
      router.back();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!invoice) {
    return <p className="text-center text-muted-foreground py-8">Not found</p>;
  }

  const total =
    parseFloat(invoice.totalStatiegeld) + parseFloat(invoice.totalFusthuur);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {t("rfh.invoiceNumber")} {invoice.invoiceNumber}
            </h1>
            <p className="text-sm text-muted-foreground">
              {invoice.rfhInvoiceNumber} &middot;{" "}
              {formatDate(new Date(invoice.invoiceDate))} &middot;{" "}
              {invoice.company?.name ?? "-"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {invoice.pdfUrl && (
            <Button variant="outline" asChild>
              <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">
                <RiFilePdfLine className="mr-2 h-4 w-4" />
                {t("rfh.viewPdf")}
              </a>
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                disabled={invoice.status === "invoiced"}
              >
                <RiDeleteBinLine className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("rfh.deleteConfirm")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {invoice.invoiceNumber} — {invoice.rfhInvoiceNumber}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("rfh.statiegeld")}</CardDescription>
            <CardTitle>{formatCurrency(parseFloat(invoice.totalStatiegeld))}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("rfh.fusthuur")}</CardDescription>
            <CardTitle>{formatCurrency(parseFloat(invoice.totalFusthuur))}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("rfh.total")}</CardDescription>
            <CardTitle>{formatCurrency(total)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Voucher cards */}
      <div className="space-y-4">
        {voucherGroups.map((group) => (
          <VoucherCard
            key={group.voucherNumber}
            group={group}
            suppliers={fustSuppliers}
            onAllocate={handleAllocate}
            onDeallocate={handleDeallocate}
            isInvoiced={invoice.status === "invoiced"}
          />
        ))}
      </div>
    </div>
  );
}

function VoucherCard({
  group,
  suppliers,
  onAllocate,
  onDeallocate,
  isInvoiced,
}: {
  group: {
    voucherNumber: string;
    allocation: RfhInvoiceData["allocations"][0] | null;
    lines: RfhInvoiceData["lines"];
  };
  suppliers: SupplierOption[];
  onAllocate: (voucherNumber: string, supplierId: string) => void;
  onDeallocate: (voucherNumber: string) => void;
  isInvoiced: boolean;
}) {
  const { t } = useLanguage();
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const isAllocated = !!group.allocation?.supplierId;
  const voucher = group.allocation?.voucher;

  // Aggregate line totals for this voucher
  const totalStatiegeld = group.lines.reduce(
    (sum, l) => sum + (l.statiegeldAmount ? parseFloat(l.statiegeldAmount) : 0),
    0
  );
  const totalFusthuur = group.lines.reduce(
    (sum, l) => sum + (l.fusthuurAmount ? parseFloat(l.fusthuurAmount) : 0),
    0
  );

  // Deduplicate lines by fustCode (combine AG + NE into one display row)
  const fustSummary = new Map<
    string,
    { fustCode: string; description: string; quantity: number; statiegeld: number; fusthuur: number }
  >();
  for (const line of group.lines) {
    const existing = fustSummary.get(line.fustCode);
    if (existing) {
      existing.statiegeld += line.statiegeldAmount
        ? parseFloat(line.statiegeldAmount)
        : 0;
      existing.fusthuur += line.fusthuurAmount
        ? parseFloat(line.fusthuurAmount)
        : 0;
    } else {
      fustSummary.set(line.fustCode, {
        fustCode: line.fustCode,
        description: line.description,
        quantity: line.quantity,
        statiegeld: line.statiegeldAmount
          ? parseFloat(line.statiegeldAmount)
          : 0,
        fusthuur: line.fusthuurAmount ? parseFloat(line.fusthuurAmount) : 0,
      });
    }
  }

  return (
    <Card className={isAllocated ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">
              Bon {group.voucherNumber}
            </CardTitle>
            {isAllocated ? (
              <Badge variant="default" className="gap-1">
                <RiCheckLine className="h-3 w-3" />
                {group.allocation!.supplier!.code} —{" "}
                {group.allocation!.supplier!.name}
              </Badge>
            ) : (
              <Badge variant="secondary">{t("rfh.unallocated")}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {voucher?.pdfUrl && (
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={voucher.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <RiExternalLinkLine className="mr-1 h-3 w-3" />
                  {t("rfh.viewVoucherPdf")}
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Hints from voucher */}
        {voucher && (
          <div className="text-sm text-muted-foreground space-y-0.5 mt-1">
            {voucher.notes && (
              <p>
                <span className="font-medium">{t("rfh.voucherNotes")}:</span>{" "}
                {voucher.notes}
              </p>
            )}
            {voucher.transporterName && (
              <p>
                <span className="font-medium">{t("rfh.transporter")}:</span>{" "}
                {voucher.transporterName}
              </p>
            )}
            {voucher.customerName && (
              <p>
                <span className="font-medium">Klant:</span>{" "}
                {voucher.customerName}
              </p>
            )}
          </div>
        )}
        {!voucher && (
          <p className="text-sm text-muted-foreground italic mt-1">
            Bon niet gevonden in systeem
          </p>
        )}
      </CardHeader>

      <CardContent>
        {/* Fust lines */}
        <div className="rounded-md border mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">Code</th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("rfh.fustLines")}
                </th>
                <th className="px-3 py-2 text-right font-medium">Aantal</th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("rfh.statiegeld")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("rfh.fusthuur")}
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from(fustSummary.values()).map((fust) => (
                <tr key={fust.fustCode} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono">{fust.fustCode}</td>
                  <td className="px-3 py-2">{fust.description}</td>
                  <td className="px-3 py-2 text-right">{fust.quantity}</td>
                  <td className="px-3 py-2 text-right">
                    {fust.statiegeld ? formatCurrency(fust.statiegeld) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fust.fusthuur ? formatCurrency(fust.fusthuur) : "-"}
                  </td>
                </tr>
              ))}
              <tr className="bg-muted/30 font-medium">
                <td className="px-3 py-2" colSpan={3}>
                  {t("rfh.total")}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(totalStatiegeld)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatCurrency(totalFusthuur)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Allocation controls */}
        {!isInvoiced && (
          <div className="flex items-center gap-2">
            {isAllocated ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDeallocate(group.voucherNumber)}
              >
                <RiCloseLine className="mr-1 h-4 w-4" />
                {t("rfh.deallocate")}
              </Button>
            ) : (
              <>
                <Select
                  value={selectedSupplierId}
                  onValueChange={setSelectedSupplierId}
                >
                  <SelectTrigger className="w-72">
                    <SelectValue placeholder={t("rfh.selectGrower")} />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!selectedSupplierId}
                  onClick={() => {
                    onAllocate(group.voucherNumber, selectedSupplierId);
                    setSelectedSupplierId("");
                  }}
                >
                  {t("rfh.allocateToGrower")}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/features/fust/components/rfh-invoice-detail.tsx
git commit -m "feat: add RFH invoice detail + allocation UI component"
```

---

## Task 13: Grower Invoicing Adaptation

**Files:**
- Modify: `src/features/fust/components/fust-invoicing.tsx`
- Modify: `src/app/api/fust/grower-invoices/route.ts`

This task adapts the grower invoicing to work from allocated RFH invoice vouchers instead of delivered orders.

- [ ] **Step 1: Read current fust-invoicing.tsx**

Read `src/features/fust/components/fust-invoicing.tsx` to understand the full component structure, especially the data fetching, order selection, and invoice generation flow.

- [ ] **Step 2: Read current grower-invoices route**

Read `src/app/api/fust/grower-invoices/route.ts` to understand the POST handler (invoice creation from orders).

- [ ] **Step 3: Add new API endpoint for allocated voucher data**

Add a GET handler query parameter to `src/app/api/fust/grower-invoices/route.ts` that returns allocated-but-not-invoiced voucher data grouped by supplier. In the existing GET handler, add a `source=rfh` parameter branch:

```typescript
// Inside existing GET handler, add after auth check:
const source = searchParams.get("source");

if (source === "rfh") {
  // Return allocated voucher data grouped by supplier
  const allocations = await prisma.rfhVoucherAllocation.findMany({
    where: {
      supplierId: { not: null },
      rfhInvoice: { status: { in: ["complete"] } },
    },
    include: {
      rfhInvoice: {
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          status: true,
          lines: true,
        },
      },
      supplier: {
        select: { id: true, code: true, name: true, company: { select: { name: true } } },
      },
      voucher: {
        select: { id: true, transactionNumber: true },
      },
    },
  });

  return NextResponse.json(allocations);
}
```

- [ ] **Step 4: Modify POST handler to accept RFH allocation source**

In the POST handler, add support for creating invoices from RFH allocations. Add an alternative schema and flow:

```typescript
const createFromRfhSchema = z.object({
  supplierId: z.string().uuid(),
  rfhInvoiceIds: z.array(z.string().uuid()).min(1),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional().nullable(),
});
```

When `rfhInvoiceIds` is present in the body (instead of `orderIds`):
1. Load all `RfhVoucherAllocation` records for the given invoice IDs + supplierId
2. Load the associated `RfhInvoiceLine` records
3. Build invoice items from the line data (statiegeld + fusthuur per fust code)
4. Generate PDF + XML using existing `generateInvoicePdf` / `generateExactXml`
5. Create `FustGrowerInvoice` + items in transaction
6. Update `RfhInvoice.status` to `"invoiced"` for fully processed invoices
7. Audit log

The invoice line items map RFH data to the existing `InvoicePdfData` format:
- Article code 2907 for statiegeld lines
- Article code 2908 for fusthuur lines
- Quantity and amounts from `RfhInvoiceLine`

- [ ] **Step 5: Update fust-invoicing.tsx data source**

Modify the component to fetch from the new `?source=rfh` endpoint and adapt the UI:
- Replace order selection with RFH invoice/allocation selection
- Group by supplier (same as current)
- Show allocated voucher lines instead of order items
- "Generate invoice" sends `rfhInvoiceIds` instead of `orderIds`

This is a significant UI change. The core table structure and invoice generation dialog can be preserved, but the data binding changes throughout.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/features/fust/components/fust-invoicing.tsx src/app/api/fust/grower-invoices/route.ts
git commit -m "feat: adapt grower invoicing to use RFH voucher allocations"
```

---

## Task 14: Final Integration + Cleanup

- [ ] **Step 1: Update fust component barrel export**

Read `src/features/fust/components/index.ts` and add the new exports:

```typescript
export { RfhInvoices } from "./rfh-invoices";
export { RfhInvoiceDetail } from "./rfh-invoice-detail";
```

- [ ] **Step 2: Verify the /api/suppliers endpoint returns fustEnabled**

Read `src/app/api/suppliers/route.ts` and verify that the GET response includes `fustEnabled` in the select. If not, add it so the RFH invoice detail component can filter fust-enabled suppliers.

- [ ] **Step 3: Full build verification**

```bash
npm run build
```

Fix any TypeScript errors.

- [ ] **Step 4: Manual smoke test**

Start dev server and verify:
1. Navigate to fust portal — simplified navigation visible
2. Upload an RFH invoice PDF — parses and creates records
3. View invoice detail — voucher cards with allocation controls
4. Allocate a voucher to a grower — status updates
5. Grower invoicing screen shows allocated data

```bash
npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete RFH invoice flow integration"
```

---

## Execution Notes

### Parser Tuning
The PDF parser (Task 3) is built from two sample PDFs. After testing with the bulk PDFs, the regex patterns will likely need adjustment. Common issues:
- Multi-page invoices with page headers repeating
- Different table formats ("Specificatie Klokfactuur" vs "Emballage meermalig")
- Edge cases in number formatting

### Migration Safety
- All new models are additive — no existing tables modified
- `prisma db push` is safe (no destructive changes)
- Navigation changes are UI-only
- Existing API routes remain functional (just hidden from nav)

### Rollback
If the refactor needs to be rolled back:
1. Revert the FustShell navigation changes
2. All existing ordering flow code is intact and functional
3. New models/routes don't interfere with existing functionality
