# Sales Sheet PDF Import via Email — Design Spec

**Date:** 2026-05-20
**Status:** Approved

---

## Context

Sales sheets (afrekeningsfacturen) worden per email verstuurd naar leveranciers. Power Automate vangt deze emails op en stuurt ze door naar onze API. De PDF-bijlage moet worden opgeslagen als Document en gekoppeld aan de bestaande SalesSheet (levering) in de database.

We hebben eerder vastgesteld dat het referentienummer in de bestandsnaam overeenkomt met `SalesSheet.invoiceNumber` in de database:

| Bestandsnaam (3e veld) | SalesSheet.invoiceNumber | Leverancier |
|------------------------|--------------------------|-------------|
| 212-28 | 212-28 | COLCICE |
| 5322744 | 5322744 | COLLATZC |
| 18108 | 18108 | COLXGREE |
| 2700354 | 2700354 | COLXLNFW |

Het 4e veld in de bestandsnaam is het echte factuurnummer (bijv. 401546) — dat slaan we op als `ourInvoiceNumber`.

## API Endpoint

**`POST /api/shipments/import-email`**

### Authentication

`Authorization: Bearer <IMPORT_API_KEY>` — via bestaande `requireImportAuth()` helper. Zelfde key als de DAX-query import endpoints.

### Request Body

```typescript
{
  subject: string,
  from: string,
  receivedDateTime: string,  // ISO date
  body?: string,
  bodyHtml?: string,
  attachments: [{
    name: string,            // "COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF"
    contentType: string,     // "application/pdf"
    contentBytes: string,    // base64-encoded PDF
    size?: number,
    isInline?: boolean,
  }]
}
```

Validated via Zod. Attachments array is required but may contain non-PDF items (txt, htm) which are filtered out.

### Response

**201 Created:**
```typescript
{
  ingestionId: string,
  processed: [{
    fileName: string,
    salesSheetId: string,
    invoiceNumber: string,     // referentienummer (SalesSheet.invoiceNumber)
    ourInvoiceNumber: string,  // factuurnummer (bijv. 401546)
    supplierCode: string,
    documentId: string,
  }],
  skipped: [{
    fileName: string,
    reason: string,            // "no_match" | "not_pdf" | "parse_error" | "no_reference"
  }]
}
```

**401:** Invalid or missing API key
**400:** Invalid request body (Zod validation)

## Processing Flow

Per email:

1. Validate auth via `requireImportAuth()`
2. Create `SalesSheetIngestion` record (status: "PROCESSING")
3. Filter attachments: only `contentType` containing "pdf" and `isInline !== true`
4. Per PDF attachment:
   a. **Parse bestandsnaam**: Split op ` - `, extract reference (3rd field) and invoice number (4th field minus extension)
   b. **Match**: `SalesSheet.findUnique({ where: { invoiceNumber: reference } })`
   c. **Fallback** (if filename parse fails or no match): decode base64, parse PDF text with pdfjs-dist, search for reference number in PDF content
   d. **No match**: add to `skipped` array, continue to next attachment
   e. **Upload PDF**: Vercel Blob at `salessheets/{timestamp}-{fileName}`
   f. **Create Document**: type "salessheet", linked to SalesSheet's supplier
   g. **Update SalesSheet**: set `pdfDocumentId` and `ourInvoiceNumber`
5. Update `SalesSheetIngestion` with results

### Filename Pattern

```
COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF
  [0]       [1]                  [2]      [3]

[0] = Supplier code
[1] = Date + time
[2] = Reference number (= SalesSheet.invoiceNumber)
[3] = Our invoice number (without .PDF extension)
```

Split on ` - ` (space-dash-space), take fields by index.

### PDF Fallback Parser

If filename parsing fails or doesn't match a SalesSheet:

1. Decode base64 to Buffer
2. Load with pdfjs-dist (legacy build)
3. Extract text from page 1
4. The reference number and invoice number appear in the header area of page 1 as standalone values
5. Try matching extracted numbers against SalesSheet.invoiceNumber

### Duplicate Handling

If a SalesSheet already has a `pdfDocumentId`:
- Delete the old Document record (cascade removes Blob via cleanup, or delete Blob explicitly)
- Replace with the new PDF

Sales sheets can be regenerated, so re-upload should overwrite.

## Schema Changes

### SalesSheet — new field

```prisma
ourInvoiceNumber String?  // Our invoice number (e.g. 401546)
```

### New model: SalesSheetIngestion

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
  details         String?  // JSON string: { processed: [...], skipped: [...] }
  errors          String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

Status values:
- **PROCESSING**: ingestion started
- **PROCESSED**: all PDF attachments matched and stored
- **PARTIAL**: some matched, some skipped
- **ERROR**: unrecoverable error (invalid body, no attachments, etc.)

## UI Changes

### Shipment Detail (`/shipments/[id]`)

If the SalesSheet has a linked `pdfDocument`:
- Show a "Sales Sheet" download button/link in the header area
- Display `ourInvoiceNumber` if available (next to the reference number)

### Documents Page

No changes needed — Documents with type "salessheet" already appear when filtering by type. The Document record is created with:
- `type: "salessheet"`
- `name: fileName` (original PDF filename)
- `supplierId`: from the matched SalesSheet

## Files to Create/Modify

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add `ourInvoiceNumber` to SalesSheet, add `SalesSheetIngestion` model |
| `src/app/api/shipments/import-email/route.ts` | **New** — API endpoint |
| `src/lib/salessheet-filename-parser.ts` | **New** — parse filename, extract reference + invoice number |
| `src/lib/salessheet-pdf-parser.ts` | **New** — fallback PDF text parser |
| `src/app/(portal)/shipments/[id]/shipment-detail.tsx` | Add PDF download button + ourInvoiceNumber display |

## Out of Scope

- Admin UI for viewing SalesSheetIngestion records (can be added later to admin overview)
- Bulk re-processing of failed ingestions
- Email notification on processing failure
- Parsing of sales sheet content (costs, lots, amounts) from the PDF — data comes from Fabric sync
