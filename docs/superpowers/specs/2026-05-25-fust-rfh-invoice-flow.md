# Spec: FUST Refactor — RFH-factuur gedreven flow

> **Date:** 2026-05-25
> **Status:** Draft
> **Author:** Henk Pieter + Claude

---

## Problem Statement

The current FUST portal assumes growers order fust through the portal (webshop flow). In practice, this doesn't happen. Instead, transporters pick up fust on behalf of Coloriginz/MyPeony at the auction, and Royal FloraHolland (RFH) invoices Coloriginz/MyPeony for it. These costs need to be passed on to the respective growers.

The portal should support a new primary flow: processing RFH invoices by linking their vouchers (bonnen) to growers, then invoicing those growers.

## New Flow

```
RFH invoice PDF --> Upload/Email --> Parse --> RfhInvoice + Lines
                                                    |
                                         Match voucher numbers with
                                         existing FustIssuanceVoucher records
                                                    |
                                         Admin/Finance allocates
                                         each voucher to a grower
                                                    |
                                         Invoice status: complete
                                                    |
                                         Grower Invoicing screen
                                         shows outstanding allocated lines
                                                    |
                                         Create FustGrowerInvoice
                                         (reuse existing PDF/XML generation)
```

## Scope

### In scope
- New data model: RFH invoices with line items and voucher allocations
- RFH invoice PDF parser
- Import via manual upload and email (Power Automate)
- Invoice detail screen with per-voucher grower allocation
- Adapted grower invoicing fed by allocated vouchers instead of orders
- Deactivation of the ordering flow (hide navigation, keep code)
- Simplified FustShell navigation

### Out of scope
- XML import (PDF-only; XML not worth the extra handling)
- Automatic grower detection (admin judgment call based on voucher notes, transporter, accountmanager)
- Changes to the voucher email import (stays as-is)
- Deleting existing ordering code (kept latent for potential future use)

---

## Data Model

### New: RfhInvoice

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| invoiceNumber | String, unique | Short number, e.g. "030536" |
| rfhInvoiceNumber | String, unique | Full invoice number, e.g. "030536.PA.2026.0010" |
| invoiceDate | DateTime | Invoice date |
| companyId | FK -> Company | Receiving company (MyPeony, Coloriginz) |
| totalStatiegeld | Decimal(10,2) | Total deposit amount |
| totalFusthuur | Decimal(10,2) | Total rental amount |
| pdfUrl | String | Vercel Blob URL |
| status | String | "open" / "partial" / "complete" / "invoiced" |
| createdAt | DateTime | |
| updatedAt | DateTime | |

**Status logic:**
- `open` — no vouchers allocated to a grower
- `partial` — some vouchers allocated, not all
- `complete` — all vouchers allocated to a grower
- `invoiced` — grower invoices have been created

### New: RfhInvoiceLine

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| rfhInvoiceId | FK -> RfhInvoice | Parent invoice |
| date | DateTime | Line date |
| fustCode | String | Fust type code, e.g. "520" |
| description | String | e.g. "Bloemendoos 19cm" |
| transactionType | String | e.g. "Uitgifte Vast", "Uitgifte Dock/Bulk" |
| location | String | e.g. "Naaldwijk" |
| voucherNumber | String | Bonnummer, e.g. "0281791" |
| quantity | Int | Number of items |
| statiegeldPrice | Decimal(10,2) | Unit deposit price (nullable — NE lines have no statiegeld) |
| statiegeldAmount | Decimal(10,2) | Total deposit amount (nullable) |
| fusthuurPrice | Decimal(10,4) | Unit rental price (nullable — AG lines have no fusthuur) |
| fusthuurAmount | Decimal(10,2) | Total rental amount (nullable) |
| vatCode | String | "AG" (statiegeld) or "NE" (fusthuur) |

**Note:** Each fust type per voucher produces two lines on the invoice: one for statiegeld (vatCode AG) and one for fusthuur (vatCode NE). These are stored as separate lines but grouped by voucherNumber for allocation.

### New: RfhVoucherAllocation

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| rfhInvoiceId | FK -> RfhInvoice | Parent invoice |
| voucherNumber | String | Grouping key (matches RfhInvoiceLine.voucherNumber) |
| voucherId | FK -> FustIssuanceVoucher | Nullable — set when voucher exists in system |
| supplierId | FK -> Supplier | The grower this voucher is allocated to |
| allocatedById | FK -> User | Who performed the allocation |
| allocatedAt | DateTime | When allocation was made |

**Constraints:**
- Unique on (rfhInvoiceId, voucherNumber) — one allocation per voucher per invoice

---

## RFH Invoice PDF Parser

Extracts from RFH invoice PDFs (same pdfjs-dist v4 legacy build as voucher parser).

### Header fields
- **Nummer**: Short invoice number (e.g. "030536")
- **Factuurnummer**: Full invoice number (e.g. "030536.PA.2026.0010")
- **Datum**: Invoice date (e.g. "Woensdag 20.05.2026")
- **Company name**: First line of address block (e.g. "My-Peony BV") — matched to Company entity

### Line items (table "Emballage meermalig")
- Datum, Fustcode, Omschrijving, Transactiesoort, Locatie, Bonnummer, Aantal
- Statiegeld (price + amount) or Fusthuur (price + amount) depending on line type
- BTW huur code (AG / NE)

### Import behavior
- PDF stored in Vercel Blob
- Duplicate check on `rfhInvoiceNumber`
- Voucher numbers from lines matched against existing `FustIssuanceVoucher.transactionNumber`
- Matched vouchers get `voucherId` populated on `RfhVoucherAllocation` (without grower yet)
- Invoice totals calculated from parsed lines

---

## Import Channels

### 1. Manual upload
- Admin/finance uploads PDF via portal UI
- Endpoint: `POST /api/fust/rfh-invoices`
- Multipart form with PDF file
- Parse, create records, store PDF

### 2. Email via Power Automate
- Endpoint: `POST /api/fust/rfh-invoices/import-email`
- Authenticated with `IMPORT_API_KEY`
- Extracts PDF attachment from email payload
- Same parse + store flow as manual upload

---

## API Routes

### New routes

| Route | Methods | Purpose | Auth |
|-------|---------|---------|------|
| `/api/fust/rfh-invoices` | GET, POST | List + upload/import | admin, finance |
| `/api/fust/rfh-invoices/import-email` | POST | Email import (Power Automate) | IMPORT_API_KEY |
| `/api/fust/rfh-invoices/[id]` | GET, DELETE | Detail + delete | admin, finance |
| `/api/fust/rfh-invoices/[id]/allocate` | POST, DELETE | Allocate/deallocate voucher to grower | admin, finance |

### Modified routes

| Route | Change |
|-------|--------|
| `/api/fust/grower-invoices` (POST) | Source becomes `RfhVoucherAllocation` instead of `FustOrder` |
| `/api/fust/grower-invoices/preview` (POST) | Preview based on allocated voucher lines |

---

## UI Components

### New: RfhInvoices (list view)

Table columns:
- Status badge with progress (e.g. "1/2 bonnen")
- Invoice number
- Date
- Company
- Number of vouchers
- Total statiegeld
- Total fusthuur
- Total amount

Features:
- Filter by status (open / partial / complete / invoiced)
- Filter by company
- Sort by date, status
- Upload button for manual PDF import

### New: RfhInvoiceDetail (detail view)

Header section:
- Invoice metadata (number, date, company, totals)
- PDF viewer / download button

Voucher cards — one card per unique voucher number:
- Voucher number + link to voucher PDF (if voucher exists in system)
- Voucher notes (from FustIssuanceVoucher.notes) — displayed as hint for grower identification
- Transporter name (from voucher)
- Fust lines for this voucher (code, description, quantity, statiegeld, fusthuur)
- Grower dropdown (suppliers with fustEnabled = true)
- Allocate / deallocate button
- Visual state: unallocated (neutral) vs allocated (green with grower name)

### Modified: Grower Invoicing

Existing `fust-invoicing.tsx` adapted:
- Data source: `RfhVoucherAllocation` with linked `RfhInvoiceLine` data
- Shows growers with outstanding allocated voucher lines
- Per grower: list of allocated lines with statiegeld + fusthuur amounts
- "Create invoice" generates `FustGrowerInvoice` (existing PDF + XML generation)

---

## Navigation (FustShell)

### Active items (admin/finance)

**Main:**
- RFH Facturen (new) — `/fust/rfh-invoices`
- Bonnen — `/fust/vouchers`
- Grower Facturatie — `/fust/invoicing`
- Activiteit — `/fust/activity`

**Admin section:**
- Emails — `/fust/emails`
- Instellingen — `/fust/settings` (supplier fust access only, no fust types/transporters)

### Hidden items (code kept, nav removed)
- Webshop / Fust Catalogue
- My Orders
- Orders (admin view of grower orders)
- Deliveries
- Pickups
- Transporter Invoices
- Voucher Matching (current order-based version)
- Fust Types (admin)
- Transporters (admin)

### Supplier navigation
- Suppliers with `fustEnabled` do NOT see fust navigation anymore (ordering deactivated)
- The `fustEnabled` flag is repurposed: it means "this supplier can be selected as a grower when allocating vouchers"

### Standalone fust-portal
- The standalone fust-portal (`(fust-portal)`) remains active for admin/finance as a focused fust workspace
- Shows the same simplified nav: RFH Facturen, Bonnen, Grower Facturatie, Activiteit, Emails, Instellingen
- No grower portal navigation visible (dashboard, sales, lots, etc.)
- Transporteur login (`/fust-login`) is deactivated (code kept latent)
- If transporteur access is needed later, it can be re-enabled alongside the ordering flow

---

## Existing System Reuse

| Component | Reuse | Adaptation needed |
|-----------|-------|-------------------|
| FustIssuanceVoucher + import | As-is | None — vouchers keep flowing in via email |
| FustGrowerInvoice model | As-is | Source changes from FustOrder to RfhVoucherAllocation |
| Invoice PDF generation (`invoice-pdf.ts`) | As-is | Line items come from RfhInvoiceLine instead of FustOrderItem |
| Exact Globe XML export (`invoice-xml.ts`) | As-is | Same article codes (2907 deposit, 2908 rental) |
| FustAuditLog | As-is | New event types for RFH invoice actions |
| fust-shell.tsx | Modified | Simplified navigation |
| Voucher parser (`voucher-parser.ts`) | As-is | Unchanged |
| fust-invoicing.tsx | Modified | Data source changes |

---

## Audit Trail

New audit event types for `FustAuditLog`:

| Event | Description |
|-------|-------------|
| `rfh_invoice_imported` | RFH invoice uploaded/imported |
| `rfh_invoice_deleted` | RFH invoice deleted |
| `rfh_voucher_allocated` | Voucher on RFH invoice allocated to grower |
| `rfh_voucher_deallocated` | Voucher allocation removed |

---

## Migration Notes

- New Prisma models added via `prisma db push`
- No data migration needed — this is a new flow alongside existing data
- Existing FustOrder, FustPickup, FustDelivery, FustInvoice data remains untouched
- Navigation changes are UI-only (no API route removal)
