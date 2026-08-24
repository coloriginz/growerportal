# Grower Portal - Project Documentation

> **Document purpose:** Single source of truth for project context, architecture, design decisions, and operational rules. Intended audience: developers, product owners, and AI coding assistants working on this codebase.
>
> **How to maintain:** Update this file when you add a major feature, change architecture, or discover a new business rule. Keep it factual and concise. Do not duplicate what is already expressed in code (schema, route files, type definitions) — instead, reference the relevant files. Remove outdated information rather than accumulating historical notes.

---

## Overview

Multi-tenant web portal for **Coloriginz** (OZ Import BV), a Dutch flower trading company based in Aalsmeer that works on consignment with growers worldwide. Suppliers (leveranciers) use this portal to track sales, lots, quality issues, documents, and shipment forecasts. Internal users (commercie/admin) manage suppliers and view aggregate insights. Transporteurs manage fust pickups and deliveries. Finance handles fust invoicing and voucher matching.

**Domain:** Cut flower trade (consignment model). Growers ship flowers to the Netherlands, Coloriginz sells at Dutch flower auctions and via direct sales, then settles via salessheets. Fust (containers/crates) is tracked separately: suppliers order fust, transporteurs pick up and deliver, finance reconciles via invoices and issuance vouchers.

**Data source:** Microsoft Fabric (intern). Sales data (suppliers, lots, transactions, costs) is synced from Fabric via a Power Automate-driven import pipeline. Salessheet PDFs are imported separately via email or bulk upload.

**Replaces:** Legacy Qlik dashboard that gave growers limited visibility into their sales performance.

---

## Terminology

The codebase uses specific terminology that maps to the business domain:

| Code term | Business term (NL) | Meaning |
|-----------|-------------------|---------|
| **Supplier** | Leverancier | The login entity. A company that ships flowers to Coloriginz. Has portal access. |
| **Grower** | Kweker | A farm/grower sub-entity under a Supplier. One supplier can have multiple growers. |
| **SalesSheet** | Afrekening / Levering | Invoice grouping lots from a single shipment (maps to `parthdr_id` in Fabric). |
| **Lot** | Partij | A batch of flowers within a shipment (maps to `part_id` in Fabric). |
| **Transaction** | Orderregel | Individual sale from a lot (maps to `ordreg_id` in Fabric). |
| **LotCorrection** | Partijcorrectie | Volume/colli adjustment on a lot (shortage, damage, etc.). |

**Historical note:** The codebase was renamed from "Grower" to "Supplier" for the main entity. The term "Grower" was reused for the kweker sub-entity. URLs, API routes, and database columns all use "supplier" for the login entity.

---

## Goals and Scope

### Goals
1. Give consignment suppliers worldwide self-service visibility into sales, costs, and net yield per stem
2. Replace WhatsApp/Excel workflows for shipment forecasting with structured weekly grids
3. Digitize the full fust (container) lifecycle: ordering, pickup, delivery, invoicing, voucher reconciliation
4. Support multi-company branding (Coloriginz, OZ Import, MyPeony) from a single codebase
5. Enable internal users (commercie, finance) to manage supplier relationships and fust operations efficiently

### In scope
- Supplier-facing: dashboard, sales analytics, lot tracking, quality issues, documents, forecasts, fust ordering
- Internal: supplier management, user management, fust operations (pickups, deliveries, invoicing, voucher matching), audit trail, data import monitoring
- Two portals: main portal (all roles) and standalone fust portal (transporteurs)
- Email notifications in supplier/transporter preferred language (EN/NL)
- Multi-company branding (logos, email from-addresses, footer text per company entity)
- Data import pipeline from Microsoft Fabric (suppliers, lots, orders, costs, growers)
- Salessheet PDF import and matching

### Out of scope
- Financial reporting or accounting integration (Exact Globe XML invoice export is partial)
- SSO / Azure AD — currently credentials-only authentication
- Mobile app — responsive web only
- Real-time data / websockets — polling via `useFetch` with manual refresh
- Languages beyond EN/NL (Spanish, Portuguese planned but not yet implemented)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Database | PostgreSQL via Neon (serverless) |
| ORM | Prisma 6, plain `PrismaClient` (no driver adapter, despite what older notes said) |
| Auth | NextAuth.js v5 beta (JWT strategy, Credentials provider) |
| UI | Tailwind CSS 4 + shadcn/ui (Base UI primitives) |
| Icons | Remix Icons (`@remixicon/react`) |
| Charts | Recharts 3 |
| Toasts | Sonner |
| Validation | Zod |
| i18n | Custom JSON-based system (EN/NL) |
| Email | Nodemailer (Ethereal dev, Resend prod) |
| File Storage | Vercel Blob |
| PDF Parsing | pdfjs-dist v4 (legacy build for Vercel serverless) |
| Deployment | Vercel (test + production targets) |

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout with Providers
│   ├── page.tsx                      # Root redirect
│   ├── globals.css                   # Tailwind CSS
│   ├── icon.svg                      # Favicon (SVG leaf)
│   ├── login/page.tsx                # Public login page
│   ├── fust-login/page.tsx           # Fust portal login page
│   ├── activate/                     # Account activation flow
│   ├── forgot-password/              # Password reset request
│   ├── reset-password/               # Password reset with token
│   ├── (portal)/                     # Protected route group (supplier/commercie/admin/finance)
│   │   ├── layout.tsx                # AppShell wrapper (auth check)
│   │   ├── dashboard/                # Dashboard (supplier + aggregate)
│   │   ├── sales/                    # Sales analytics + trends
│   │   ├── lots/                     # Lot overview + detail
│   │   ├── shipments/                # Salessheet overview + detail
│   │   ├── quality/                  # Quality issues
│   │   ├── documents/                # Document management
│   │   ├── forecasts/                # Shipment forecasts (weekly grid)
│   │   ├── fust/                     # Fust pages (orders, pickups, deliveries, vouchers, invoices, activity, emails)
│   │   ├── profile/                  # Supplier profile
│   │   ├── suppliers/                # Supplier management (admin/commercie)
│   │   └── admin/                    # User management + import monitoring (admin)
│   ├── (fust-portal)/                # Standalone fust portal (transporteur login)
│   │   └── fust-portal/             # FustShell layout + pages (my-orders, pickups, deliveries, etc.)
│   └── api/                          # API routes (see below)
├── components/
│   ├── layout/                       # AppShell, SupplierSelector, TestBanner, etc.
│   ├── charts/                       # Recharts wrappers
│   ├── providers/                    # LanguageProvider, SessionProvider
│   ├── ui/                           # shadcn/ui primitives
│   ├── language-switcher.tsx
│   └── theme-switcher.tsx
├── hooks/
│   └── use-fetch.ts                  # Generic data fetching hook (with AbortController)
├── i18n/
│   ├── index.ts                      # Translation system
│   ├── en.json                       # English translations
│   └── nl.json                       # Dutch translations
├── features/
│   └── fust/                         # Fust feature module
│       ├── components/               # Fust UI (orders, pickups, deliveries, invoices, vouchers, audit, settings)
│       ├── lib/                      # Voucher/invoice PDF parsers
│       └── navigation/               # Fust nav config
├── lib/
│   ├── auth.ts                       # NextAuth configuration
│   ├── db.ts                         # Prisma client singleton
│   ├── api-helpers.ts                # requireAuth(), resolveSupplierId(), buildSupplierScope()
│   ├── import-auth.ts                # requireImportAuth() for import API key validation
│   ├── format.ts                     # Currency, number, date formatting (nl-NL)
│   ├── export-csv.ts                 # CSV export utility
│   ├── email.ts                      # Nodemailer setup
│   ├── email-templates.ts            # HTML email templates (activation, reset, fust approved, fust delivered)
│   ├── fust-notifications.ts        # Fust email triggers
│   ├── fust-audit.ts                # Audit trail helper: logFustEvent()
│   ├── company-config.ts            # Multi-company branding config
│   ├── company-logos.ts             # Base64 logos per company
│   ├── company-helpers.ts           # getSupplierEmailBranding()
│   ├── quality-codes.ts             # Quality code mappings
│   ├── chart-colors.ts              # Recharts color palette
│   ├── supplier-context.ts          # Server-side supplier context
│   ├── season.ts                     # Season start/end calculation (configurable per supplier)
│   ├── salessheet-filename-parser.ts # Parse supplier code + reference from PDF filenames
│   ├── salessheet-pdf-parser.ts      # Extract reference + invoice number from salessheet PDFs
│   ├── env.ts                        # Environment helpers (isTest)
│   └── utils.ts                      # clsx/cn utility
├── types/
│   ├── index.ts                      # Domain enums (Role, LotStatus, SalesType, etc.)
│   └── next-auth.d.ts               # Session type extensions
└── generated/prisma/                 # Prisma generated client (do not edit)

prisma/
├── schema.prisma                     # Database schema
└── seed.ts                           # Test data seeder (legacy, not used with Fabric data)
```

---

## Authentication & Authorization

### Roles
- **supplier**: Can only see own data. Linked to a single Supplier record via `user.supplierId`.
- **commercie**: Account manager. Can view any supplier's data by passing `?supplierId=` in URL. Sees aggregate dashboard when no supplier selected. Scoped to assigned companies via `user.companies`.
- **admin**: Full access. Same multi-tenant view as commercie, plus user management and import monitoring.
- **transporteur**: Fust portal only. Manages pickups and deliveries. Linked to a Transporter record via `user.transporterId`.
- **finance**: Fust invoicing and voucher matching. Same nav as commercie in main portal, plus fust finance pages.

### Key Patterns
```typescript
// API route pattern: check auth, resolve supplier, query data
const { error, session } = await requireAuth();
if (error) return error;
const supplierId = resolveSupplierId(session!, requestedSupplierId);

// Scoped access for commercie/finance (only suppliers in their assigned companies)
const scope = buildSupplierScope(session!);
```

### Session Shape
```typescript
session.user = {
  id: string;
  name: string;
  email: string;
  role: "supplier" | "commercie" | "admin" | "transporteur" | "finance";
  supplierId: string | null;       // only set for supplier users
  supplierCode: string | null;     // supplier code (e.g. "PCFUP")
  transporterId: string | null;    // only set for transporteur users
  kbtCode: string | null;          // KBT identifier for account linking
  companyIds: string[];            // company IDs this user can access
}
```

### Test Mode
Role switching, supplier switching, and transporter switching are only available in test/development environments (`isTest` from `src/lib/env.ts`). These operations modify the JWT token but are guarded by `isTest` check in the JWT callback (`src/lib/auth.ts`).

---

## Database Schema (Key Models)

### Core Sales Entities
- **Supplier** — Login entity (leverancier). Has code, name, fabricId, feature toggles, season config, fust settings.
- **Grower** — Farm sub-entity under Supplier (kweker). Has fabricId, name, code, country, city. Linked to Lots.
- **SalesSheet** — Invoice/shipment grouping (levering). Maps to `parthdr_id` in Fabric. Has totalTurnover, totalCosts, netResult, optional PDF link.
- **SalesSheetCost** — Individual cost line on a salessheet. Maps to `shkost_id` in Fabric. Has description, amount, costTypeCode.
- **Lot** — Batch of flowers (partij). Maps to `part_id` in Fabric. Has productName, articleGroup, stemLength, totalStems, quality codes (s1/s2/s3), correction fields.
- **LotCorrection** — Volume/colli correction on a lot. Links to CorrectionReasonCode. Has facttypeSub ("correctie"/"productiecorrectie").
- **CorrectionReasonCode** — Lookup table for correction reasons from Fabric. Has code, Dutch/English names, type.
- **Transaction** — Individual sale (orderregel). Maps to `ordreg_id` in Fabric. Has salesType (VMP/Aurora/Veilen/Persoonlijk), stems, pricePerStem, amount.

### Data Import Entities
- **ImportBatch** — Tracks each sync run. Has endpoint, status, record counts, duration, error message.
- **SalesSheetIngestion** — Tracks salessheet PDF email imports. Has attachment count, processed/skipped counts.
- **FabricRelation** — Staging table for all Fabric relations (rel_id). Used for supplier matching.
- **StagingKbtPartij** — Raw lot data from Fabric (partijen).
- **StagingKbtOrder** — Raw transaction data from Fabric (orders/orderregels).
- **StagingKbtShcost** — Raw salessheet cost data from Fabric.
- **SyncJob** — One endpoint over one window, optionally scoped to a supplier. Carries `runId`/`sequence` (chain order, unique together), `status`, `attempts`, `importBatchId`.
- **SyncSchedule** — Two rows, `intraday` and `nightly`. Interval or time of day, endpoints, window, and per-endpoint window overrides.
- **Record provenance** — `Lot`, `Transaction`, `Grower`, `SalesSheetCost` and `LotCorrection` carry `lastImportBatchId`, so the import screen can click through to what a run touched. It holds only the *last* run: a later run takes the origin over, and the screen says so rather than showing an unexplained empty list. `Supplier` carries no origin. A lots run counts lots and lot corrections together in `recordsCreated`, and the records dialog lists both — lots first, corrections behind them.

### Other Entities
- **Company** — Multi-tenant company entity (Coloriginz, OZ Import, MyPeony). Determines branding.
- **User** — Authentication. Has role, optional supplierId/transporterId, kbtCode, company access.
- **Transporter** — Logistics partner for fust operations.
- **Document** — Uploaded files (salessheet PDFs, contracts, growing plans).
- **QualityIssue** — Quality problems on lots (code + stems affected).
- **ShipmentForecast** — Weekly forecast per product per supplier.
- **Certificate** — Supplier certifications (GlobalGAP, MPS).
- **ChangeRequest** — Supplier profile change requests.
- **Setting** — Key-value config store.

### Fust Entities
- **FustType** — Container type catalog with deposit and rental prices.
- **FustOrder** — Supplier orders fust. Status flow: pending -> approved -> scheduled -> in_transit -> delivered. Soft delete (deletedAt).
- **FustOrderItem** — Line items per order (fustType + quantity + deliveredQuantity).
- **FustPickup** — Transporter groups approved orders for pickup.
- **FustDelivery** — 1:1 with FustOrder. Tracks delivery status and actual quantities.
- **FustInvoice** — Transporter invoice (PDF upload + parsed items).
- **FustIssuanceVoucher** — Auction voucher matched to orders for reconciliation.
- **FustGrowerInvoice** — Invoice sent to supplier with deposit and rental line items.
- **FustGrowerCharge** — Charge allocated to supplier from transporter invoice.
- **FustAuditLog** — Centralized audit trail (19 action types). Denormalized orderId for timeline queries.
- **FustEmailIngestion** — Tracks voucher PDF email imports.
- **FustVoucherOrderLink** — Many-to-many link between vouchers and orders.

### Key Relationships
```
Supplier -> has many -> Growers (kweker farms)
Supplier -> has many -> Lots -> has many -> Transactions
Supplier -> has many -> SalesSheets -> has many -> Lots
Supplier -> has many -> SalesSheets -> has many -> SalesSheetCosts
Lot -> has many -> LotCorrections -> links to -> CorrectionReasonCode
Supplier -> belongs to -> Company (branding)
Supplier -> has many -> FustOrders -> has one -> FustDelivery
```

### Important Constraints
- `Lot.lotNumber + Lot.supplierId` is unique
- `Transaction.fabricOrdregId + Transaction.lotId` is unique (same ordreg can span lots)
- `SalesSheet.invoiceNumber` is unique
- `Supplier.code` is unique
- `Supplier.fabricId` is unique (nullable)
- UUIDs as primary keys throughout

---

## Data Import Pipeline

Sales data flows from Microsoft Fabric via Power Automate into the portal through 5 import endpoints. All are authenticated with `IMPORT_API_KEY` via `requireImportAuth()`.

### Import Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/import/suppliers` | POST | Upsert Supplier records from Fabric relations |
| `/api/import/growers` | POST | Upsert Grower (kweker) records from Fabric |
| `/api/import/lots` | POST | Upsert Lots + SalesSheets from Fabric partijen data |
| `/api/import/orders` | POST | Upsert Transactions from Fabric orderregels |
| `/api/import/costs` | POST | Upsert SalesSheetCosts + recalculate SalesSheet totals |

### Data Flow
```
Fabric DAX query -> Power Automate -> POST /api/import/* (JSON array)
    -> Staging tables (raw data, with importBatchId)
    -> Portal models (Supplier, Lot, Transaction, SalesSheet, etc.)
    -> ImportBatch record (tracking: counts, duration, errors)
```

### Key Behaviors
- **The portal only carries consignment.** Fabric delivers partijen with an `inkooptype_code`: `CONS` (consignment), `FOB` and `CIF` (purchase). The lots import drops everything that is not consignment, and it does so *before* the missing-supplier check — otherwise purchase relations end up in `details.skippedSuppliers` and the import screen invites you to create exactly the wrong suppliers. The set of accepted codes lives in `CONSIGNMENT_PURCHASE_TYPES` (`src/lib/sync/purchase-type.ts`); `details.skippedPurchaseTypes` counts what was dropped per code, which is the check on that set. Transactions follow by themselves: the orders import skips an orderregel whose lot is not in the portal
- All imports use **upsert** (INSERT ON CONFLICT UPDATE) via Prisma or raw SQL
- Fabric IDs (`fabricId`, `fabricPartId`, `fabricParthdrId`, `fabricOrdregId`, `fabricShkostId`) are used as match keys
- Costs import recalculates SalesSheet totals (totalTurnover from lots, totalCosts from cost lines, netResult = turnover - costs) via raw SQL CTE
- Column names are matched case- and separator-insensitively by `normalizeImportKeys()` in `import-auth.ts`, so every route accepts DAX output (`[Naam]`), raw SQL warehouse columns (`kost_naam`) and the XML-escaped form the SQL Server connector produces for names with spaces (`Shkost_x0020_ID`). Fields whose name differs beyond spelling get an explicit alias per route
- Dutch decimal format in Fabric ("42,39") — parsed with `parseFloat(str.replace(",", "."))`
- Each import creates an ImportBatch record for monitoring

### Portal-driven sync (replaces the Power Automate schedule)

The portal decides when to sync and builds the SQL itself; Power Automate only executes it.

```
Vercel Cron (every 5 min) -> POST /api/sync/tick
   reads SyncSchedule, queues SyncJobs in chain order, dispatches one at a time
   -> POST <PA_WEBHOOK_FETCH_URL> { env, endpoint, batchId, query }   -> 202
      PA runs the SQL, posts rows to <base for env>/api/import/<endpoint>
   -> the import route reuses batchId, marks the SyncJob done, and dispatches
      the next job itself -> the chain runs to the end without waiting for a tick
```

**The chain is self-propelling.** `completeJobForBatch()` in `src/lib/sync/runner.ts` is
what the import route calls when a job lands; it flips the job to `done` and immediately
dispatches the next one. Without it a tick moves the queue exactly one step, so a nightly
round of five endpoints takes 25 minutes on production and stands still on test, where
Vercel Cron never fires. A tick (or the "Advance queue" button) still *starts* a round —
it is the only thing that queues one — but it no longer has to walk it. A failed import
cancels the rest of its own run and lets the queue continue with what is left; without
that the successors sit on `pending` forever, since a job is only claimable once its
predecessor is `done`.

- **Chain order `suppliers -> growers -> lots -> orders -> costs` is enforced by the queue**, not by convention. The lots import silently drops partijen whose supplier does not exist; that is how COLXROOD and COLXBAK lost 317 salessheets.
- **Two schedules**, rows in `SyncSchedule`: `intraday` (lots+orders, 2-day window, every 6h) and `nightly` (all five, 7 days, `windowOverrides: {costs: 28}`). Costs need a wider window because settlement runs weeks behind delivery — after one week only 45% of cost lines exist, after three weeks all of them.
- **`windowDays` is how long the sync may be broken before data is missed for good.** The window slides past unfetched deliveries and they do not come back; a backfill is the only repair.
- **Two Power Automate flows.** `PA_WEBHOOK_ASK_URL` answers small questions synchronously (`MIN(levering_datum)`, row counts); `PA_WEBHOOK_FETCH_URL` moves data and returns 202. Both URLs are secrets and live only in env vars. The `env` field decides which portal PA posts back to and is derived from `NEXT_PUBLIC_APP_ENV`, never from the request.
- **Query builders live in `src/lib/sync/queries/`** as typed functions, not `.sql` files — a Vercel function cannot read arbitrary files off disk.
- **All five import routes share `runImport()` in `src/lib/import-batch.ts`** and accept an optional `batchId`. Without one they open their own batch, so the old DAX flows keep working.

### Querying Fabric

- **The marts change shape without warning, and a fetch-flow failure is silent.** On 21 August 2026 `marts.fct_salesheets_costs` lost `levering_datum` (now `_datum_key_levering`) and its three descriptive cost columns moved to `marts.dim_kost` as `kost_naam` / `kosttype_code` / `kosttype_naam` — note the missing underscore. The costs sync broke that day and nothing said so: `PA_WEBHOOK_FETCH_URL` answers 202 the moment the flow starts, so a SQL error never reaches the portal and the job sits on `dispatched` until the reaper kills it 15 minutes later. When an endpoint goes quiet, check its columns with `SELECT TOP 1 *` through the ask flow before looking anywhere else — a query against a column that no longer exists comes back as a 502 in under a second, which is far too fast to be a timeout.
- **Do not trust a Fabric column because its name fits.** Three were wrong in one day: `leverancier_contact_inkoper` is not the account manager (`leverancier_verantwoordelijke` is), `vor_omzet` is not the settlement turnover (it is `vor_aantal * afrekenprijs_per_steel`), and `inkoopfust_volume` is a trolley fraction, not the stem count (`inkoop_factuur_aantal` is). Check candidate columns against data the portal already holds.
- **System views fail through the SQL connector**: `INFORMATION_SCHEMA.COLUMNS` and `.TABLES` both return 502. Discover columns with `SELECT TOP 1 *` and read the keys.
- **The ask flow is for cheap questions.** A `COUNT(*)` over a full fact table times out at 504; scope every question to a supplier or a period.
- `marts.fct_salesheets_costs` has no `rel_id_leverancier`; scope it through `parthdr_id IN (SELECT parthdr_id FROM marts.fct_partijen WHERE rel_id_leverancier = ?)`.
- `marts.fct_orders` holds rows with all four keys null (6% over eight days, mostly `verkooptype = "Script aanpassen"`). The portal cannot place them; the query filters them out.

### Salessheet PDF Import

Salessheet PDFs are imported via `POST /api/shipments/import-email`, also authenticated with `IMPORT_API_KEY`. PDFs are matched to existing SalesSheet records by:
1. Filename parsing (`salessheet-filename-parser.ts`) — extracts reference number
2. PDF content parsing (`salessheet-pdf-parser.ts`) — extracts reference from PDF text
3. Match against `SalesSheet.invoiceNumber`

Matched PDFs are uploaded to Vercel Blob and linked via `SalesSheet.pdfDocumentId -> Document`. A link is only made when the delivery date printed on the PDF matches the candidate exactly — the reference alone is not enough, since sales sheet numbers recycle per year.

The filename parser knows three shapes, tried in order: the rich Power Automate form (`COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF`), the digits-only form (`135-23-380914.pdf`), and the loose form (`C002 Blom-371364.pdf`) where anything after the final hyphen is our invoice number if it is four digits or more. Covered by `scripts/checks/salessheet-filename.ts`.

The local archive in `private_input/salessheets` is pushed through this same route by `scripts/link-salessheet-pdfs.ts` (dry-run by default). See `docs/salessheet-pdfs-koppelen.md`.

---

## API Routes

### Portal Routes (session-authenticated)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth endpoints |
| `/api/auth/switch-role` | POST | Test mode: switch user role (isTest only) |
| `/api/dashboard` | GET | Dashboard data (supplier-specific or aggregate) |
| `/api/dashboard/chart` | GET | Dashboard chart data (monthly breakdown) |
| `/api/sales` | GET | Sales data with period/product/channel/length/grower filters |
| `/api/sales/filters` | GET | Available filter options for sales |
| `/api/sales/trends` | GET | Price trends, stem length breakdown, channel distribution |
| `/api/lots` | GET | Lots with pagination and filters |
| `/api/shipments` | GET | Salessheets with pagination |
| `/api/shipments/ingestions` | GET | Salessheet PDF import log |
| `/api/quality` | GET | Quality issues |
| `/api/documents` | GET, POST | Document list and upload |
| `/api/documents/[id]` | GET, DELETE | Download and delete document |
| `/api/forecasts` | GET, POST, DELETE | Forecast CRUD |
| `/api/forecasts/copy` | POST | Copy week data to subsequent weeks |
| `/api/profile` | GET, PUT | User profile |
| `/api/profile/password` | PUT | Change password |
| `/api/suppliers` | GET | Suppliers list (for selector) |
| `/api/suppliers/[id]` | GET, PUT | Supplier detail and update |
| `/api/suppliers/[id]/activate` | POST | Send activation email |
| `/api/admin/users` | GET, POST | User management |
| `/api/admin/users/[id]` | GET, PUT, DELETE | User CRUD |
| `/api/admin/settings` | GET, PUT | Admin settings (test env only) |
| `/api/admin/commercie` | GET | Commercie/admin users list |
| `/api/admin/suppliers` | GET | Supplier management with aggregates |
| `/api/admin/import-batches` | GET | Import batch history |
| `/api/admin/import-batches/[id]/records` | GET | The records one run created or updated, paginated |
| `/api/admin/import-batches/[id]/skipped` | GET | The relations one run dropped, split into growers and internal bookings |
| `/api/admin/fabric-relations` | GET, POST | Fabric relation staging data; POST activates one as a Supplier |
| `/api/activate` | POST | Account activation (set password) |
| `/api/forgot-password` | POST | Request password reset email |
| `/api/reset-password` | POST | Reset password with token |
| `/api/change-requests` | GET, POST | Supplier change requests |
| `/api/companies` | GET | Company list |
| `/api/transporters` | GET | Transporter list |

### Fust Routes (session-authenticated)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/fust/types` | GET | Fust types catalog |
| `/api/fust/settings` | GET, PUT | Fust settings |
| `/api/fust/dashboard` | GET | Fust dashboard KPIs |
| `/api/fust/orders` | GET, POST | Fust orders (soft-delete filtered) |
| `/api/fust/orders/[id]` | GET, PATCH, DELETE | Order detail, approve/reject/cancel, soft delete |
| `/api/fust/pickups` | GET, POST | Pickup management |
| `/api/fust/pickups/[id]` | GET, PATCH | Pickup status + link orders |
| `/api/fust/deliveries/[id]` | PATCH | Confirm delivery |
| `/api/fust/invoices` | GET, POST | Invoice list and PDF upload |
| `/api/fust/invoices/[id]` | PATCH | Invoice status change |
| `/api/fust/invoices/[id]/charges` | POST | Create charges from invoice |
| `/api/fust/grower-invoices` | GET, POST | Supplier fust invoices |
| `/api/fust/grower-invoices/[id]` | GET, PATCH | Invoice detail and status |
| `/api/fust/grower-invoices/[id]/send` | POST | Send invoice to supplier via email |
| `/api/fust/grower-invoices/preview` | POST | Preview invoice before creation |
| `/api/fust/vouchers` | GET, POST | Issuance voucher list and PDF upload |
| `/api/fust/vouchers/[id]/match` | POST, DELETE | Match/unmatch voucher to orders |
| `/api/fust/vouchers/import-email` | POST | Import voucher from email (Power Automate) |
| `/api/fust/email-ingestions` | GET | Voucher email ingestion log |
| `/api/fust/email-ingestions/[id]` | GET, PATCH | Ingestion detail and update |
| `/api/fust/email-ingestions/[id]/reprocess` | POST | Reprocess failed ingestion |
| `/api/fust/audit` | GET | Audit log (filterable, paginated, role-scoped) |

### Import Routes (API key-authenticated)

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/import/suppliers` | POST | Bulk upsert suppliers from Fabric |
| `/api/import/growers` | POST | Bulk upsert growers from Fabric |
| `/api/import/lots` | POST | Bulk upsert lots + salessheets from Fabric |
| `/api/import/orders` | POST | Bulk upsert transactions from Fabric |
| `/api/import/costs` | POST | Bulk upsert salessheet costs + recalculate totals |
| `/api/sync/tick` | GET, POST | Cron entrypoint: reap stale jobs, queue due rounds, dispatch the next job (`CRON_SECRET` bearer) |
| `/api/sync/jobs/[id]/reset` | POST | Put a job that hangs on `dispatched` back in the queue and send it again, without waiting out the 15-minute stale window (admin session) |
| `/api/shipments/import-email` | POST | Import salessheet PDFs |

### API Conventions
- All session routes use `requireAuth()` for session check
- Import routes use `requireImportAuth()` for API key validation
- `resolveSupplierId()` for multi-tenant data access
- `buildSupplierScope()` for company-scoped access (commercie/finance)
- Zod validation on POST/PUT bodies
- Responses: `NextResponse.json(data)` or `NextResponse.json({ error }, { status })`

---

## Frontend Patterns

### Page Structure
Each portal page follows this pattern:
```
page.tsx         -> Server component, auth check, renders content component in Suspense
*-content.tsx    -> Client component ("use client"), fetches data, renders UI
```

### Data Fetching
```typescript
const { data, loading, error, lastUpdated, refetch } = useFetch<T>(url);
```
- `useFetch` handles loading/error states with AbortController for race condition prevention
- URL is built with `useMemo` to trigger refetch on param changes
- `refetch()` available for manual refresh
- Aborts in-flight requests when URL changes (prevents stale data)

### State Management
- No global state library. URL search params (`?supplierId=`) as source of truth for supplier context.
- `useSearchParams()` for reading supplier selection (requires Suspense boundary).
- Local component state for UI interactions.

### Formatting
All formatting uses `nl-NL` locale:
- `formatCurrency(1234)` -> "EUR 1.234"
- `formatNumber(1234)` -> "1.234"
- `formatPrice(1.234)` -> "EUR 1,234"
- `formatDate(date)` -> "15-03-2026"

### Translations
```typescript
const { t } = useLanguage();
t("nav.dashboard")  // -> "Dashboard" (en) or "Dashboard" (nl)
```
Type-safe: `t()` accepts only keys that exist in the JSON files.

---

## Key Features

### Dashboard
- **Supplier view**: KPI cards (stems today/yesterday/YTD, turnover, avg price, net yield, quality rate), sales chart, top products, recent shipments. Net yield uses SalesSheet.netResult as single source of truth.
- **Aggregate view** (admin/commercie, no supplier selected): Import status, recent transactions/lots/suppliers/growers, data counts, recent salessheet uploads.

### Sales Analytics
- Period filters: today, yesterday, this week, this month, YTD, specific week number, custom date range
- Multi-select filters: product, sales channel, stem length, grower (kweker)
- Year-over-year comparison with matching filters applied to both years
- Charts: price trend per product, stem length breakdown, channel distribution over time

### Sales Types
Fabric sales types (not legacy auction codes):
- **VMP** — Veiling Met Provisie (auction with commission)
- **Aurora** — Direct sales platform
- **Veilen** — Traditional auction
- **Persoonlijk** — Personal/direct sales

### Shipment Forecasts
- Weekly grid: 6 weeks visible, inline number editing per cell
- Year overview chart (Recharts AreaChart): all products as colored areas
- Auto-save per cell with status indicators
- Add products from lot history or custom names
- Copy week data to subsequent weeks
- CSV export
- Past weeks are read-only

### Import Monitoring (Admin)
- Import batch history with status, record counts, duration
- Salessheet PDF import log with search, status filter, pagination
- Recent salessheet uploads on aggregate dashboard
- Fabric relations staging view

### Supplier Management
- Supplier profiles with certificates, feature toggles (sales/quality/forecasts)
- Account activation via email link
- Commercie assignment
- Change request system
- Multi-company branding (Company entity with custom logos, email from-addresses)

---

## Fust Management (Detail)

### Lifecycle
```
Supplier places order -> [auto-approve or manual approve] -> Transporter picks up from auction ->
Transporter delivers to supplier -> Finance matches vouchers -> Finance creates supplier invoice -> Payment
```

**Order statuses:** pending -> approved -> scheduled -> in_transit -> delivered (or rejected/cancelled)

### Key Rules
- Fust must be enabled per supplier by admin (requires a default transporter)
- Auto-approve: if enabled, orders below threshold are approved instantly
- Delivery confirmation captures actual quantities (may differ from ordered)
- Issuance vouchers (uitgiftebonnen) from the auction are PDF-parsed and matched to orders
- Supplier invoices include deposit (statiegeld) and rental (fusthuur) line items per fust type
- Article codes (2907 deposit, 2908 rental) configurable per fust type for Exact Globe

### Two Portals
- `(portal)/fust/` — for supplier/admin/commercie/finance
- `(fust-portal)/fust-portal/` — standalone portal for transporteurs (own FustShell layout, middleware URL rewrite for `fust.*` domains)

### Voucher Email Import
Power Automate sends TrackOnline voucher emails to `POST /api/fust/vouchers/import-email`. The system extracts transaction number from subject, fetches PDF from TrackOnline, parses voucher details, and creates FustIssuanceVoucher records. Logged in FustEmailIngestion.

### Audit Trail
All fust actions logged to FustAuditLog (19 event types). Denormalized `orderId` for fast per-order timeline queries.

---

## Business Domain Rules

### Consignment Model
- Growers ship flowers to Coloriginz in the Netherlands
- Coloriginz sells on behalf of growers at auction or via direct sales
- After sale, Coloriginz creates a **salessheet** — an invoice grouping all lots from a shipment
- Salessheet shows: total turnover, itemized costs (commission, handling, logistics), net result
- The supplier receives the net result minus costs
- **Key metric:** net yield per stem (netto opbrengst/steel)
- Coloriginz also buys outright (FOB/CIF). Those lots are settled at purchase, the turnover is not the supplier's, and they never enter the portal — see the consignment filter in the import pipeline

### Data Hierarchy (Fabric -> Portal)
```
Fabric: Zending -> Levering (parthdr_id) -> Partij (part_id) -> Orderregel (ordreg_id)
Portal: [implicit] -> SalesSheet        -> Lot              -> Transaction
```

### Season Calculation
- Each supplier has a configurable `seasonStartMonth` (default: January)
- "Season to Date" calculations use this month as the season start
- Relevant for Southern hemisphere growers whose season doesn't align with calendar year

### Corrections
- Corrections are separate Lot records with a `correctionReasonId` linking to `CorrectionReasonCode`
- `LotCorrection` tracks individual correction events (volume/colli adjustments)
- `Lot.correctionVolume` is the aggregate sum of all corrections on that lot

### Quality Codes
Standard auction quality codes (110, 120, 130, 154, 160, 170) mapped in `quality-codes.ts`.

---

## Development

### Commands
```bash
# npm run dev fails on Windows: npm shells scripts through cmd.exe, which chokes on
# the POSIX NODE_OPTIONS='...' prefix. Bash does not help. Invoke next directly:
NODE_OPTIONS='--max-old-space-size=2048' npx next dev
npm run check        # Run the check scripts in scripts/checks/ (pure functions, no test framework)
npm run build        # Production build
npx prisma db push   # Push schema changes (NOT migrate dev)
npx prisma generate  # Generate Prisma client (stop dev server first on Windows!)
```

### Environment Variables
```
DATABASE_URL=           # Neon pooler connection string
DIRECT_URL=             # Neon direct connection (for schema push)
NEXTAUTH_SECRET=        # NextAuth JWT secret
NEXTAUTH_URL=           # App URL
APP_URL=                # Public app URL
NEXT_PUBLIC_IS_TEST=    # "true" for test environment banner
NEXT_PUBLIC_APP_ENV=    # "test" | "development" | "production"
IMPORT_API_KEY=         # API key for import endpoints (shared by all import routes)
```

### Demo Accounts (test environment)
```
Admin:        admin@coloriginz.com        / Colori2026!
Commercie:    iris.inkoper@coloriginz.com  / FloraDesk#24
Transporteur: chauffeur@flowertrans.nl     / Transport#2026
Finance:      finance@coloriginz.com       / Finance#2026
```
Supplier accounts are created via admin UI with activation emails.

### Important Notes
- **Windows EPERM**: Stop dev server before running `prisma generate` (DLL lock).
- **Never run `next build` while dev server is running** — breaks CSS output.
- **Never use `vercel deploy`** — use `git push` to deploy (avoids leaking .env).
- **Database changes**: Use `prisma db push`, not `prisma migrate dev`.
- **Emails**: Use CID inline attachments (base64 Buffer), never external image URLs.
- `useSearchParams()` requires Suspense boundary.
- **Zod 4, not 3**: `z.record(keySchema, valueSchema)` requires *every* key to be present. For a partial map like `windowOverrides` use `z.partialRecord()`, or a save with `{}` is rejected.
- **Tailwind variants beat unprefixed utilities**: the base `DialogContent` carries `sm:max-w-sm`, so a plain `max-w-4xl` never applies on desktop no matter the order. Write `sm:max-w-4xl`. Three dialogs in `features/fust` still have this bug.
- **Base UI `SelectValue` renders the raw value, not the item label.** Fine when the value is human-readable; pass a function as children when it is an id.
- **Paginate on a unique sort.** `ORDER BY` on a non-unique key plus `OFFSET` lets Postgres return a row on two pages or on none — measured, not theoretical. Always append `{ id: "asc" }`.
- **Prisma `Json?` fields**: writing `null` does not type-check against the update input — use `Prisma.JsonNull` to store a JSON null, or `undefined` to leave the column alone.

---

## Deployment

- **Platform**: Vercel with two deployment targets
- **Test**: preview deployment of the same project, auto-deploys from `develop`. **Vercel Cron only fires on production deployments, so the sync clock does not tick on test** — drive `/api/sync/tick` by hand there
- **Production**: Deploys from `main` branch
- **Database**: Separate Neon projects for test and production (not Neon branches)
- `vercel.json` holds only the cron definition; `prisma generate` runs from the `build` script in `package.json`
- Never push directly to `main` without approval

---

## Key Design Decisions

| Decision | Chosen | Why |
|----------|--------|-----|
| **ORM** | Prisma 6 (not 7) | Stable driver adapter support for Neon serverless. |
| **Auth** | NextAuth v5 + JWT + Credentials | Simple, no external auth dependency. Suppliers are invited. |
| **Database** | Neon serverless PostgreSQL | No Docker on dev workstation. Two separate projects for test/prod. |
| **Deployment** | Vercel via `git push` only | CLI deploy leaks `.env` files. |
| **Schema migrations** | `prisma db push` | Simpler for small team. No migration history. |
| **Multi-tenancy** | URL param `?supplierId=` + role check | Enforced by `resolveSupplierId` + `buildSupplierScope`. |
| **Multi-company branding** | Company entity + base64 logos | CID email attachments. |
| **Fust portal** | Separate route group + middleware URL rewrite | Standalone portal for transporteurs. Shares API routes. |
| **Email templates** | Inline HTML with VML for Outlook | Per-template translation maps (not i18n JSON). |
| **Fust soft delete** | `deletedAt` + `deletedById` | Audit trail and voucher links must persist. |
| **PDF parsing** | pdfjs-dist v4 legacy build | Works on Vercel serverless with config. |
| **Data import** | API-key endpoints + staging tables | Power Automate sends Fabric data. Staging preserves raw data. |
| **Supplier/Grower split** | Supplier = login entity, Grower = farm sub-entity | Reflects Fabric hierarchy: leverancier vs kweker. |
| **Net yield calculation** | SalesSheet.netResult as single source | Avoids mismatch between Transaction.date and SalesSheet.invoiceDate. |

---

## Security Notes

### Authentication
- Credentials-based auth via NextAuth v5 with JWT strategy
- Passwords hashed with bcryptjs
- Users created by admin, receive activation link — no self-registration
- Activation tokens are single-use, reset tokens expire after 1 hour
- Test mode role/entity switching guarded by `isTest` in JWT callback

### Authorization
- Every API route starts with `requireAuth(allowedRoles?)` or `requireImportAuth()`
- `resolveSupplierId()` ensures suppliers can only access their own data
- `buildSupplierScope()` scopes commercie/finance to their assigned companies
- Import routes use separate API key, not session auth

### Known Security Considerations
- Import API key comparison is constant-time over SHA-256 digests. `IMPORT_API_KEY_PREVIOUS` is accepted alongside `IMPORT_API_KEY` so keys can be rotated without a gap; drop it once the flows are migrated
- Blob uploads use `access: "public"` — financial documents accessible if URL known (fix planned)
- Fust types endpoint lacks `requireAuth()` (fix planned)
- No rate limiting on login attempts

---

## Known Issues and Technical Debt

### Audit Findings (May 2026)
Full audit report in `tasks/audit.md` (11 CRITICAL, 26 HIGH, 35 MEDIUM, 18 LOW).

**Fixed:**
- JWT role escalation in production — `isTest` guard added
- Custom date range excludes end date — `endOfDay()` fix
- Dashboard net yield mismatched date sources — uses SalesSheet.netResult now
- YoY comparison ignores active filters — filters applied to both years
- useFetch race condition — AbortController added

**Remaining critical/high (see `tasks/audit.md`):**
- Blob uploads should be private with signed URLs
- Fust order status transitions not validated
- Fust invoice charges can be created twice
- Admin settings endpoint lacks role check
- Dashboard chart: 24 sequential queries
- Sales route loads all transactions in memory
- No error boundaries (crash = white page)

### Technical Debt
- No automated tests (unit, integration, or E2E)
- 30+ `eslint-disable @typescript-eslint/no-explicit-any`
- Email template HTML boilerplate duplicated 5x
- Several unused npm dependencies

### Workarounds
- **Vercel serverless + public/ folder**: Logos embedded as base64 in code (`company-logos.ts`)
- **pdfjs-dist on Vercel**: Legacy build + `serverExternalPackages` + `outputFileTracingIncludes`
- **Next.js 16 Turbopack on Windows**: Crashes with `0xc0000142`, use `--webpack` fallback

---

## File Naming Conventions
- Page components: `page.tsx` (server) + `*-content.tsx` (client)
- API routes: `route.ts`
- UI components: kebab-case (`multi-select-filter.tsx`)
- Lib files: kebab-case (`api-helpers.ts`)
- Translation keys: dot-notation (`forecasts.copyWeek`)
