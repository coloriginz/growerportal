# Sales Sheet PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receive sales sheet PDFs via Power Automate email API, match them to existing SalesSheet records, store as Documents, and make them downloadable from the shipment detail page.

**Architecture:** Power Automate sends email JSON (with base64 PDF attachments) to POST `/api/shipments/import-email`. The API parses the filename to extract a reference number, matches it against `SalesSheet.invoiceNumber`, uploads the PDF to Vercel Blob, creates a Document record, and links it to the SalesSheet. A `SalesSheetIngestion` model logs each import for auditing.

**Tech Stack:** Next.js API route, Prisma, Vercel Blob (`@vercel/blob`), pdfjs-dist (fallback parser), Zod validation

**Spec:** `docs/superpowers/specs/2026-05-20-salessheet-pdf-import-design.md`

---

### Task 1: Schema Changes

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `ourInvoiceNumber` to SalesSheet model**

In `prisma/schema.prisma`, find the SalesSheet model (around line 162). Add the new field after `lastRegistrationDate`:

```prisma
  ourInvoiceNumber    String?  // Our invoice number (e.g. 401546)
```

- [ ] **Step 2: Add SalesSheetIngestion model**

Add after the SalesSheet model (after line 188):

```prisma
model SalesSheetIngestion {
  id              String   @id @default(uuid())
  subject         String?
  fromAddress     String?
  receivedAt      DateTime?
  processedAt     DateTime @default(now())
  status          String   // "PROCESSING" | "PROCESSED" | "PARTIAL" | "ERROR"
  attachmentCount Int      @default(0)
  processedCount  Int      @default(0)
  skippedCount    Int      @default(0)
  details         String?  // JSON: { processed: [...], skipped: [...] }
  errors          String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 3: Push schema and generate client**

Stop the dev server first (Windows EPERM issue), then:

```bash
npx prisma db push
npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add SalesSheetIngestion model and ourInvoiceNumber field"
```

---

### Task 2: Filename Parser

**Files:**
- Create: `src/lib/salessheet-filename-parser.ts`

- [ ] **Step 1: Create the filename parser**

Create `src/lib/salessheet-filename-parser.ts`:

```typescript
/**
 * Parse a sales sheet PDF filename to extract reference and invoice numbers.
 *
 * Expected format:
 *   "COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF"
 *   [supplier] - [date time] - [reference] - [invoiceNumber].PDF
 *
 * The reference number matches SalesSheet.invoiceNumber in the database.
 * The invoice number is the OZ Import/Coloriginz/MyPeony invoice number.
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/salessheet-filename-parser.ts
git commit -m "feat: add sales sheet filename parser"
```

---

### Task 3: PDF Fallback Parser

**Files:**
- Create: `src/lib/salessheet-pdf-parser.ts`

- [ ] **Step 1: Create the PDF fallback parser**

Create `src/lib/salessheet-pdf-parser.ts`:

```typescript
/**
 * Fallback parser: extract reference number from sales sheet PDF content.
 *
 * The reference number and invoice number appear on page 1 of the PDF
 * as standalone values in the header area. The reference is printed
 * just above the invoice number (e.g. "212-28" above "401546").
 *
 * Uses pdfjs-dist legacy build for Vercel serverless compatibility.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ParsedSalesSheetPdf {
  reference: string | null;
  ourInvoiceNumber: string | null;
}

export async function parseSalesSheetPdf(pdfBuffer: Buffer): Promise<ParsedSalesSheetPdf> {
  const data = new Uint8Array(pdfBuffer);
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;

  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items as Array<{ str: string; hasEOL?: boolean }>;

  // Build lines from text items
  const lines: string[] = [];
  let currentLine = "";
  for (const item of items) {
    currentLine += item.str;
    if (item.hasEOL) {
      lines.push(currentLine.trim());
      currentLine = "";
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());

  // Look for "Invoice number" or "Factuurnummer" label — the values appear nearby
  // The reference number is a standalone value (like "212-28" or "5322744")
  // The invoice number is another standalone value (like "401546")
  // They appear near each other in the header area

  let reference: string | null = null;
  let ourInvoiceNumber: string | null = null;

  // Strategy: find the line containing "Invoice number" or "Factuurnummer"
  // The actual values are on adjacent lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/Invoice number|Factuurnummer/i.test(line)) {
      // Search nearby lines for standalone numbers
      // Look backwards and forwards for two number-like values
      const candidates: string[] = [];
      for (let j = Math.max(0, i - 5); j < Math.min(lines.length, i + 5); j++) {
        const l = lines[j].trim();
        // Match patterns like "212-28", "5322744", "401546", "18108"
        if (/^\d[\d-]{1,15}$/.test(l) && !/^\d{1,2}-\d{1,2}-\d{4}$/.test(l)) {
          candidates.push(l);
        }
      }
      // Typically we find two: reference (first) and invoice number (second)
      if (candidates.length >= 2) {
        reference = candidates[0];
        ourInvoiceNumber = candidates[1];
      } else if (candidates.length === 1) {
        reference = candidates[0];
      }
      break;
    }
  }

  await doc.destroy();
  return { reference, ourInvoiceNumber };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/salessheet-pdf-parser.ts
git commit -m "feat: add sales sheet PDF fallback parser"
```

---

### Task 4: API Endpoint

**Files:**
- Create: `src/app/api/shipments/import-email/route.ts`

- [ ] **Step 1: Create the import-email API route**

Create the directory and file `src/app/api/shipments/import-email/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { put, del } from "@vercel/blob";
import { requireImportAuth } from "@/lib/import-auth";
import { parseSalesSheetFilename } from "@/lib/salessheet-filename-parser";
import { parseSalesSheetPdf } from "@/lib/salessheet-pdf-parser";
import { z } from "zod";

const attachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  contentBytes: z.string(),
  size: z.number().optional(),
  isInline: z.boolean().optional(),
});

const importEmailSchema = z.object({
  subject: z.string(),
  from: z.string(),
  receivedDateTime: z.string(),
  body: z.string().optional(),
  bodyHtml: z.string().optional(),
  attachments: z.array(attachmentSchema),
});

interface ProcessedItem {
  fileName: string;
  salesSheetId: string;
  invoiceNumber: string;
  ourInvoiceNumber: string;
  supplierCode: string;
  documentId: string;
}

interface SkippedItem {
  fileName: string;
  reason: string;
}

export async function POST(request: NextRequest) {
  // Auth
  const authError = requireImportAuth(request);
  if (authError) return authError;

  // Parse body
  const rawBody = await request.json();
  const parseResult = importEmailSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { subject, from, receivedDateTime, attachments } = parseResult.data;

  // Create ingestion record
  const ingestion = await prisma.salesSheetIngestion.create({
    data: {
      subject,
      fromAddress: from,
      receivedAt: receivedDateTime ? new Date(receivedDateTime) : null,
      status: "PROCESSING",
      attachmentCount: attachments.length,
    },
  });

  // Filter PDF attachments (skip inline, skip non-PDF)
  const pdfAttachments = attachments.filter(
    (a) => a.contentType.toLowerCase().includes("pdf") && a.isInline !== true
  );

  if (pdfAttachments.length === 0) {
    await prisma.salesSheetIngestion.update({
      where: { id: ingestion.id },
      data: {
        status: "ERROR",
        errors: "No PDF attachments found",
        skippedCount: attachments.length,
      },
    });
    return NextResponse.json(
      { error: "No PDF attachments found", ingestionId: ingestion.id },
      { status: 422 }
    );
  }

  const processed: ProcessedItem[] = [];
  const skipped: SkippedItem[] = [];

  for (const attachment of pdfAttachments) {
    const result = await processAttachment(attachment);
    if (result.ok) {
      processed.push(result.data);
    } else {
      skipped.push({ fileName: attachment.name, reason: result.reason });
    }
  }

  // Also count non-PDF attachments as skipped
  for (const a of attachments) {
    if (!a.contentType.toLowerCase().includes("pdf") || a.isInline === true) {
      skipped.push({ fileName: a.name, reason: "not_pdf" });
    }
  }

  // Determine final status
  const status =
    processed.length === 0
      ? "ERROR"
      : skipped.filter((s) => s.reason !== "not_pdf").length > 0
        ? "PARTIAL"
        : "PROCESSED";

  await prisma.salesSheetIngestion.update({
    where: { id: ingestion.id },
    data: {
      status,
      processedCount: processed.length,
      skippedCount: skipped.length,
      details: JSON.stringify({ processed, skipped }),
    },
  });

  return NextResponse.json(
    { ingestionId: ingestion.id, processed, skipped },
    { status: 201 }
  );
}

async function processAttachment(
  attachment: z.infer<typeof attachmentSchema>
): Promise<{ ok: true; data: ProcessedItem } | { ok: false; reason: string }> {
  const pdfBuffer = Buffer.from(attachment.contentBytes, "base64");

  // Step 1: Try filename parsing
  let reference: string | null = null;
  let ourInvoiceNumber: string | null = null;

  const parsed = parseSalesSheetFilename(attachment.name);
  if (parsed) {
    reference = parsed.reference;
    ourInvoiceNumber = parsed.ourInvoiceNumber;
  }

  // Step 2: Try matching by filename reference
  let salesSheet = reference
    ? await prisma.salesSheet.findUnique({
        where: { invoiceNumber: reference },
        include: { supplier: { select: { id: true, code: true } } },
      })
    : null;

  // Step 3: Fallback — parse PDF content
  if (!salesSheet) {
    try {
      const pdfParsed = await parseSalesSheetPdf(pdfBuffer);
      if (pdfParsed.reference) {
        reference = pdfParsed.reference;
        ourInvoiceNumber = ourInvoiceNumber || pdfParsed.ourInvoiceNumber;
        salesSheet = await prisma.salesSheet.findUnique({
          where: { invoiceNumber: pdfParsed.reference },
          include: { supplier: { select: { id: true, code: true } } },
        });
      }
    } catch {
      // PDF parsing failed — continue with no match
    }
  }

  if (!salesSheet) {
    return { ok: false, reason: reference ? `no_match:${reference}` : "no_reference" };
  }

  // Step 4: Handle duplicate — delete old document if exists
  if (salesSheet.pdfDocumentId) {
    const oldDoc = await prisma.document.findUnique({
      where: { id: salesSheet.pdfDocumentId },
    });
    if (oldDoc) {
      try {
        await del(oldDoc.fileUrl);
      } catch {
        // Blob deletion failed — not critical
      }
      await prisma.document.delete({ where: { id: oldDoc.id } });
    }
  }

  // Step 5: Upload to Vercel Blob
  const blob = await put(
    `salessheets/${Date.now()}-${attachment.name}`,
    pdfBuffer,
    { access: "public", contentType: "application/pdf" }
  );

  // Step 6: Create Document record
  const document = await prisma.document.create({
    data: {
      supplierId: salesSheet.supplierId,
      type: "salessheet",
      name: `Sales Sheet ${salesSheet.invoiceNumber}`,
      fileName: attachment.name,
      fileUrl: blob.url,
      fileSize: pdfBuffer.length,
      mimeType: "application/pdf",
    },
  });

  // Step 7: Update SalesSheet — link document + store invoice number
  await prisma.salesSheet.update({
    where: { id: salesSheet.id },
    data: {
      pdfDocumentId: document.id,
      ourInvoiceNumber: ourInvoiceNumber || undefined,
    },
  });

  return {
    ok: true,
    data: {
      fileName: attachment.name,
      salesSheetId: salesSheet.id,
      invoiceNumber: salesSheet.invoiceNumber,
      ourInvoiceNumber: ourInvoiceNumber || "",
      supplierCode: salesSheet.supplier.code,
      documentId: document.id,
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shipments/import-email/route.ts
git commit -m "feat: add sales sheet email import API endpoint"
```

---

### Task 5: Shipment Detail — PDF Download Button

**Files:**
- Modify: `src/app/(portal)/shipments/[id]/page.tsx`
- Modify: `src/app/(portal)/shipments/[id]/shipment-detail.tsx`

- [ ] **Step 1: Pass pdfDocument data from server page**

In `src/app/(portal)/shipments/[id]/page.tsx`, add `pdfDocument` to the Prisma include. Change the `findUnique` call (around line 15) to also select the PDF document:

Find:
```typescript
    include: {
      supplier: { select: { id: true, code: true, name: true } },
```

Replace with:
```typescript
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      pdfDocument: { select: { id: true, fileUrl: true, fileName: true } },
```

- [ ] **Step 2: Add pdfDocument to ShipmentDetail interface and render download button**

In `src/app/(portal)/shipments/[id]/shipment-detail.tsx`, add `RiFileDownloadLine` to the Remix icon imports:

Find:
```typescript
import { RiArrowLeftLine, RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
```

Replace with:
```typescript
import { RiArrowLeftLine, RiArrowDownSLine, RiArrowRightSLine, RiFileDownloadLine } from "@remixicon/react";
```

Then update the `ShipmentDetailProps` interface to include `pdfDocument` and `ourInvoiceNumber`. Find:

```typescript
interface ShipmentDetailProps {
  shipment: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    deliveryDate: string;
    totalTurnover: string;
    totalCosts: string;
    netResult: string;
    supplier: { id: string; code: string; name: string };
    lots: Lot[];
    costs: Cost[];
  };
}
```

Replace with:

```typescript
interface ShipmentDetailProps {
  shipment: {
    id: string;
    invoiceNumber: string;
    ourInvoiceNumber: string | null;
    invoiceDate: string;
    deliveryDate: string;
    totalTurnover: string;
    totalCosts: string;
    netResult: string;
    supplier: { id: string; code: string; name: string };
    pdfDocument: { id: string; fileUrl: string; fileName: string } | null;
    lots: Lot[];
    costs: Cost[];
  };
}
```

Then add a download button in the header area. Find (around line 127):

```typescript
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/shipments?supplierId=${shipment.supplier.id}`}>
          <Button variant="ghost" size="icon" className="shrink-0">
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("shipments.details")}: {shipment.invoiceNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("shipments.deliveryDate")}: {formatDate(shipment.deliveryDate)}
          </p>
        </div>
      </div>
```

Replace with:

```typescript
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/shipments?supplierId=${shipment.supplier.id}`}>
          <Button variant="ghost" size="icon" className="shrink-0">
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("shipments.details")}: {shipment.invoiceNumber}
            {shipment.ourInvoiceNumber && (
              <span className="ml-2 text-base font-normal text-muted-foreground">({shipment.ourInvoiceNumber})</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("shipments.deliveryDate")}: {formatDate(shipment.deliveryDate)}
          </p>
        </div>
        {shipment.pdfDocument && (
          <a href={shipment.pdfDocument.fileUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="gap-2">
              <RiFileDownloadLine className="h-4 w-4" />
              Sales Sheet
            </Button>
          </a>
        )}
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/(portal)/shipments/[id]/page.tsx" "src/app/(portal)/shipments/[id]/shipment-detail.tsx"
git commit -m "feat: show sales sheet PDF download on shipment detail page"
```

---

### Task 6: TypeScript Check & Push

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. If there are errors, fix them.

- [ ] **Step 2: Commit any fixes and push**

```bash
git push origin develop
```

---

### Task 7: Manual Test with Sample PDFs

**Files:** None (testing only)

- [ ] **Step 1: Test with a local curl/script**

Create a quick test by base64-encoding one of the sample PDFs and sending it to the local dev server:

```bash
# Start dev server first, then in another terminal:
cd /c/HPProjects/growerportal2

# Base64 encode the first sample PDF
B64=$(base64 -w 0 "private_input/salessheets/COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF")

# Send to API (replace API_KEY with the actual IMPORT_API_KEY value)
curl -X POST http://localhost:3000/api/shipments/import-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_IMPORT_API_KEY" \
  -d "{
    \"subject\": \"Sales sheet COLCICE\",
    \"from\": \"test@example.com\",
    \"receivedDateTime\": \"2026-05-20T12:00:00Z\",
    \"attachments\": [{
      \"name\": \"COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF\",
      \"contentType\": \"application/pdf\",
      \"contentBytes\": \"$B64\"
    }]
  }"
```

Expected response (201):
```json
{
  "ingestionId": "...",
  "processed": [{
    "fileName": "COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF",
    "salesSheetId": "...",
    "invoiceNumber": "212-28",
    "ourInvoiceNumber": "401546",
    "supplierCode": "COLCICE",
    "documentId": "..."
  }],
  "skipped": []
}
```

- [ ] **Step 2: Verify in the portal**

1. Navigate to the shipment detail page for COLCICE's delivery 212-28
2. Verify the "Sales Sheet" download button appears in the header
3. Verify the PDF opens correctly
4. Check the documents page — the sales sheet should appear with type "salessheet"

- [ ] **Step 3: Verify the ingestion log**

Check the database for the SalesSheetIngestion record:

```bash
npx tsx -e "
import { PrismaClient } from './src/generated/prisma/index.js';
const p = new PrismaClient();
const records = await p.salesSheetIngestion.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
console.log(JSON.stringify(records, null, 2));
process.exit(0);
"
```

Expected: one record with status "PROCESSED", processedCount 1, skippedCount 0.
