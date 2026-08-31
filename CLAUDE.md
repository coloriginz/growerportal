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
- **SalesSheet** — Invoice/shipment grouping (levering). Maps to `parthdr_id` in Fabric. Has totalTurnover, totalCosts, netResult, optional PDF link. `pdfTurnover`, `pdfCosts` and `pdfNetResult` are the same three amounts as printed on that PDF — read from the document, not derived from Fabric — kept alongside the computed totals so the two independent sources can be compared. `pdfParsedAt` carries no amount and is still load-bearing: without it "never read" and "read, nothing found" are both `null`, and a parser regression becomes indistinguishable from a document that simply has no PDF.
- **SalesSheetCost** — Individual cost line on a salessheet. Maps to `shkost_id` in Fabric. Has description, amount, costTypeCode, `costCode` (the stable code behind the name), `salesSheetType` (`IN` = inkoopzijde: freight, handling, distribution, crate rent; `VE` = verkoopzijde: commission, transaction levy, receivables insurance) and `isInclusief` (the delivery runs on an all-in arrangement; every cost line of such a delivery carries it, and it changes no amount). `laatste_ontvangstdatum` and `laatste_aanmelddatum` come in on the cost rows but belong to the delivery: the import takes the latest per salessheet and writes them to `SalesSheet.lastReceiptDate` and `lastRegistrationDate`, which is why you will not find them on the cost model. `amount` is `Decimal(14,6)` and is stored **unrounded**: Fabric delivers five decimals (10.01952, 555.35736) and the sales sheet adds those up before it rounds. Rounding each line on import made the total a cent higher than the printed one — round-then-sum against sum-then-round. `SalesSheet.totalCosts` is `ROUND(SUM(amount), 2)` and the screens round per line, so the extra decimals never surface.
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
- `Transaction.fabricOrdregId + Transaction.lotId` is **not** unique, and must not be made unique. One orderregel is delivered in parts: `marts.fct_orders` returns a row per part — 200 + 1800 stems under one `ordreg_id`, same sales type, same price, same grower. 2.132 pairs on test carry more than one row and they are all genuine. A unique index there would silently drop half of every split line
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
| `/api/import/suppliers` | POST | Load Fabric relations into `FabricRelation` staging. It creates no `Supplier`: which relations become suppliers is a deliberate choice made in Admin -> Fabric relations, because activating the wrong one pulls in purchase lots that do not belong here |
| `/api/import/growers` | POST | Upsert Grower (kweker) records from Fabric. Creates only when the batch belongs to a supplier-scoped `SyncJob` — `dim_kweker` carries no supplier and `Grower.supplierId` is required, so an unscoped round can only update |
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
- **`recordsCreated` means new, not written.** Orders and lot corrections have no stable key, so both are imported by deleting every row inside the window and reinserting it. Counting each insert as "created" made a run over a narrow window look like it found thousands of records the previous run had missed — it had not; it rewrote them. Both routes now report `created = written - deleted` and `updated = deleted`, with `written` kept in `details`. The records dialog cannot make that split per row (every rewritten row carries a fresh `createdAt`), so for an orders run it shows one list under both tabs and says so
- **One job is one query is one POST — now with a brake behind it.** The window-wide cleanup in the orders route is only sound while a `SyncJob`'s payload arrives in a single POST, which is how the portal builds its own questions (see the chunk size in `src/lib/sync/backfill.ts`). But that is an assumption about behaviour on the far side of a webhook, and it was the one place in the system where being wrong costs data rather than time: a second payload on the same `batchId` would delete everything the first had just written. `runImport()` now adds each payload's row count to `ImportBatch.recordsReceived` in one atomic update *before* the handler runs, and hands the handler what was there before it (`ImportContext.priorRows`). Anything above zero means this is not the first payload, and `resolveWithdrawalScope()` falls back to the pair-scoped delete. The column also became more honest along the way: it used to be overwritten with the last payload's length, so a batch that received two payloads reported only the second.
- **An import that can only add is an import that lies.** The orders route deleted only the `(lotId, fabricOrdregId)` pairs the incoming batch named, so an orderregel the warehouse *withdraws* was never seen again and stayed in the portal forever, turnover and all. Measured 29 August 2026: 176 such rows over 105 deliveries at 25 suppliers — 150.735 stems and EUR 49.419 of turnover that does not exist, two deliveries consisting of withdrawn rows for 100%. The lot the grower reported was off by EUR 30, which is what these look like from the front. The fix is a second, wider cleanup in the same route: within the window of a `SyncJob`, everything not in the payload is gone from Fabric and goes. That is only sound because one job is one query is one POST — the chunk size in `src/lib/sync/backfill.ts` is chosen so the answer fits a single post — so outside that guarantee (old DAX flows, repair scripts, all of which post without a `batchId`) it falls back to the old pair-scoped delete. `resolveWithdrawalScope()` in `src/lib/sync/withdrawal.ts` is where that call is made, apart from the SQL so it can be checked without a database; `scripts/checks/withdrawal.ts` covers it. Three refusals are deliberate and each one is a bug that would not announce itself: an empty payload never wipes a window (Fabric returns an empty recordset without an error often enough), a supplier-scoped job whose supplier the portal cannot place never widens to everyone, and a lot whose rows were skipped this round — supplier conflict, unusable date — is left alone, because a row we could not process is not a withdrawal. Only rows imported "live" can go stale, which is why nothing before April 2026 is affected: older data was backfilled after the withdrawal had already happened. `scripts/repair-orphan-orders.ts` is the catch-up for what is already stored (dry-run by default, refuses a quarter that comes back empty or that would lose more than 5% of its rows). `LotCorrection` has the same shape but a smaller leak — it rewrites per `fabricPartId`, so only a partij whose *last* correction lapses keeps a stale row; not yet fixed
- **A dead ordreg_id mostly means renumbered, not withdrawn — so repairing means refetch first, delete second.** Of the 146 partijen holding an orphan row on 29 August 2026, 145 still had orderregels in Fabric under *different* `ordreg_id`s: the warehouse renumbers, and from the portal that is indistinguishable from a withdrawal. Deleting alone traded EUR 49.419 too much for EUR 47.653 too little — the portal had never fetched the new ids because the June 2026 window does not come back. The import route gets this right for free (within one window it deletes what is absent and inserts what is present, in the same run), but a repair script has to do it in that order deliberately; `repair-orphan-orders.ts` refetches every affected supplier-quarter through `/api/import/orders` before it deletes anything. After that round 138 of 146 partijen matched Fabric to the cent. The other eight are not a sync problem: `marts.fct_partijen` had reattributed them from COLXAFRI to relation 29778 (Ole Engai Growers), which is no portal supplier, so the orders guard skips them and the delivery keeps its costs with no turnover. Activating that relation is the whole fix — see the reattribution note under *Querying Fabric*

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
- **The warehouse restates history, so a sliding window alone does not catch everything.** An orderregel enters `marts.fct_orders` with its keys, date and sales type filled but `vor_aantal` and `afrekenprijs_per_steel` still empty; settlement fills those in weeks to months later. A sync that passes by in between writes 0 stems and 0 turnover, and the window never returns to that date. Nothing looks broken — the row is there, every count matches, only the amounts are too low. Measured 25 August 2026: 2.047 orderregels over 48 suppliers, 3,6 million stems, EUR 1,6 million. Production orders are the case a grower notices, because the sales sheet prints them as a separate "Productie" line while the portal shows nothing. `scripts/repair-zero-orders.ts` is the catch-up round: it derives its work list from the zero rows themselves and refetches per supplier per quarter straight from Fabric into `/api/import/orders`, dry-run by default. `windowOverrides: {costs: 28}` is this same insight applied to costs alone — orders need it repeated periodically, not widened. Costs are restated the same way but show it differently: no line is ever missing, the amounts just move, on both sides. `scripts/repair-costs.ts` is their catch-up round, keyed per supplier per quarter on the quarters where the portal holds deliveries.
- **A repair belongs in the import route, not only in the script that ran it.** The plan is to start production from an empty database: backfill everything from Fabric, then link the whole sales sheet archive in one batch. Every fix that lives only in a one-off repair script is a bug that comes back on that first run, and nobody will remember it. So when a repair script fixes something, the route that writes the data has to learn the same lesson in the same session — the script is the catch-up for data already stored, never the fix itself. One known exception, and it is deliberate: nothing in the scheduled sync revisits old windows, so `scripts/repair-zero-orders.ts` and `scripts/repair-costs.ts` stay necessary as a periodic round. After a clean start they are not needed until the warehouse has restated something again.
- **A backfill starts at the supplier's first consignment delivery, not at the global setting.** `resolveBackfillStart()` in `src/lib/sync/backfill-start.ts` asks Fabric for `MIN(leverdatum)` over that relation through the ask flow (~1 s warm) and plans from that quarter. The global `sync.backfillStartDate` stays a floor, never a replacement: COLXGREE has delivered since August 2023, so planning purely on the first delivery would grow its backfill from seven quarters to twelve. A failing ask flow falls back to the global date rather than blocking the activation, and no first delivery at all means there is nothing to queue. In development `resolveSyncEnv()` returns null, so the fallback is what you always get locally.
- **Two Power Automate flows.** `PA_WEBHOOK_ASK_URL` answers small questions synchronously (`MIN(levering_datum)`, row counts); `PA_WEBHOOK_FETCH_URL` moves data and returns 202. Both URLs are secrets and live only in env vars. The `env` field decides which portal PA posts back to and is derived from `NEXT_PUBLIC_APP_ENV`, never from the request.
- **Query builders live in `src/lib/sync/queries/`** as typed functions, not `.sql` files — a Vercel function cannot read arbitrary files off disk.
- **All five import routes share `runImport()` in `src/lib/import-batch.ts`** and accept an optional `batchId`. Without one they open their own batch, so the old DAX flows keep working.

### Querying Fabric

- **The marts change shape without warning, and a fetch-flow failure is silent.** On 21 August 2026 `marts.fct_salesheets_costs` lost `levering_datum` (now `_datum_key_levering`) and its three descriptive cost columns moved to `marts.dim_kost` as `kost_naam` / `kosttype_code` / `kosttype_naam` — note the missing underscore. The costs sync broke that day and nothing said so: `PA_WEBHOOK_FETCH_URL` answers 202 the moment the flow starts, so a SQL error never reaches the portal and the job sits on `dispatched` until the reaper kills it 15 minutes later. When an endpoint goes quiet, check its columns with `SELECT TOP 1 *` through the ask flow before looking anywhere else — a query against a column that no longer exists comes back as a 502 in under a second, which is far too fast to be a timeout.
- **Do not trust a Fabric column because its name fits.** Three were wrong in one day: `leverancier_contact_inkoper` is not the account manager (`leverancier_verantwoordelijke` is), `vor_omzet` is not the settlement turnover (it is `vor_aantal * afrekenprijs_per_steel`), and `inkoopfust_volume` is a trolley fraction, not the stem count (`inkoop_factuur_aantal` is). Check candidate columns against data the portal already holds.
- **System views fail through the SQL connector**: `INFORMATION_SCHEMA.COLUMNS` and `.TABLES` both return 502. Discover columns with `SELECT TOP 1 *` and read the keys.
- **The ask flow is for cheap questions.** A `COUNT(*)` over a full fact table times out at 504; scope every question to a supplier or a period.
- **Fabric owns the supplier a delivery belongs to, and the portal follows it.** `Lot.supplierId`, `Lot.salesSheetId` and `SalesSheet.supplierId` are written on *update* as well as on insert, so a delivery reattributed in `marts.fct_partijen` moves in the portal at the next lots round. Fixing only the `ON CONFLICT` clause does nothing — existing rows take the separate update path, which is why two deliveries sat under the wrong supplier for months. When the new relation is not a portal supplier, **the delivery is removed from the portal** — lots, transactions, costs and the linked sales sheet PDF. That is the same rule the import already applies on the way in (a partij whose relation is not an activated supplier is dropped), and leaving it out on the way out was an oversight, not a design. The old behaviour was to report and leave put, on the reasoning that activating the relation would move it along; that has it backwards. Measured 29 August 2026, one delivery portal-wide: INT000072 sat under COLXAFRI (Africalla Kenya) while Fabric attributes it to relation 29778 (Ole Engai Growers) — two unrelated parties, an entry error later corrected at the source. The linked PDF is named `COLXOLE - … - INT000072 - …`: the settlement is Ole Engai's own, filed under Africalla's `Document.supplierId`, and Africalla's one active account could open it. A third party's turnover, costs and prices are not something a report fixes, and no supplier should have to be onboarded to clean up another's view. Reporting stays: `ImportBatch.details.reattributedAway` (`{relId: {leveringen, van: [codes]}}`) plus `reattributedRemoved` (count) and `reattributedKept` (why not, when the cap held). `planReattributionRemoval()` in `src/lib/sync/reattribution.ts` carries the decision and the cap — above 25 deliveries in one round nothing is removed, because that many reattributions at once points at a broken round rather than a corrected source; `scripts/checks/reattribution.ts` covers it. Two cascades do not happen by themselves and are handled explicitly: `Lot.salesSheetId` is optional so lots would be left detached under the old supplier, and the `Document` is referenced *by* the sales sheet so it survives its own delivery. Activating the relation later is still the real fix — a backfill then brings the delivery back under the right supplier.
- **`scripts/fabric-query.js` queries the warehouse directly** over the mssql driver on a device-code login, with the connection in `scripts/lib/fabric-connection.js` so other scripts can reuse it. It is not bound by the ask flow's timeouts, which makes it the tool for a wide analysis or a repair run. It can return an empty recordset without throwing, and not just once: on 26 August three consecutive queries for the same supplier and quarter came back empty while an unfiltered `COUNT(*)` over the same table answered normally, and minutes later the identical query returned 1.511 rows three times running. The failure hits *filtered* queries, lasts long enough to look like a real answer, and reports no error — so never read an empty result as "no data" when you have reason to expect some, and never let a repair delete on the strength of one. One transport difference to watch when posting its output into an import route: the mssql driver returns `DECIMAL`/`NUMERIC` as strings where Power Automate sends numbers, so `Inkoopfactuur colli`, `Inkoopfactuur volume` and `Inslag aantal correctie` need coercing or the lots route rejects the whole payload on validation.
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
| `/api/admin/shipment-issues` | GET | Settled deliveries that need attention: `missing-pdf` (no sales sheet linked) or `stem-gap` (delivered plus corrections does not add up to sold, beyond a small margin), paginated |
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
| `/api/import/suppliers` | POST | Load Fabric relations into `FabricRelation` staging (creates no `Supplier`) |
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

### Shipment Status
A delivery is **Selling**, **Finalizing** or **Completed**. The status is derived, never stored: `resolveShipmentStatus()` in `src/lib/shipment-status.ts` reads three numbers that all come from the import and keep moving there — delivered stems (`SUM(Lot.invoicedVolume)`, **not** `Lot.totalStems`: the orders import overwrites `totalStems` with the sold quantity, so on test it equals sold in all 66,888 lots that have transactions and delivered in none), sold stems (`SUM(Transaction.stems)`) and the number of `SalesSheetCost` lines. A stored column would have to be rewritten on every round and would age silently when that fails once.

- **Cost lines beat the stem gap.** Cost lines present means the settlement ran, so the delivery is Completed even when sold is below delivered. 139 deliveries are in exactly that state because the warehouse fills `vor_aantal` in weeks later; letting the stem gap win parks them on Selling forever.
- **The PDF does not count.** 3.713 settled deliveries have no linked sales sheet PDF — that is a portal artefact, not a business fact, and requiring it would leave half the archive on Finalizing.
- **`resolveShipmentStatus()` itself skips corrections, deliberately** — see the reasoning in `shipment-status.ts`. But delivered and sold only agree once corrections are added back in: `LotCorrection.correctionVolume` is meaningfully signed, and delivered + corrections lands on sold, not delivered alone. Delivery 2700240 (COLXLNFW) measures it exactly: 55,870 delivered, −33,380 in corrections, 22,490 sold — matching the printed sales sheet to the stem. `/api/admin/shipment-issues` (`stem-gap`) does add corrections back in, because there the comparison has to catch a real gap rather than approximate a phase transition; see `STEM_GAP_MARGIN` in that route for the margin and its measurement.
- Both blind spots the rule creates are visible in **Admin -> Import Status -> Data Quality**, served by `/api/admin/shipment-issues`. Covered by `scripts/checks/shipment-status.ts`.

### Sales Sheet PDF Match
`/api/admin/shipment-issues` carries a third finding type, `pdf-mismatch`, next to `missing-pdf` and `stem-gap`: does the sales sheet PDF the supplier received agree with what the portal computed? The verdict is derived, never stored — `resolveSalesSheetMatch()` in `src/lib/salessheet-match.ts` — so it moves automatically when the import recalculates the totals, which it does every round. Four outcomes, no `null`: `match`, `mismatch`, `unread`, `unlinked`; `unread` means we did look at the document and no amount came out of it, which is our fault, not a fact about the delivery.

- **The comparison is on net result only, and that is the whole trick.** An all-in delivery (`isInclusief`, 241 of 7.878) prints only the net on its sales sheet and carries no cost lines, while the portal holds gross turnover and costs separately from Fabric — comparing turnover to turnover there manufactures thousands of euros of phantom difference. Net means the same thing on both sides, so the comparison needs no all-in flag.
- When the sales sheet does not print a net label — roughly two-thirds of the time — it is derived as turnover minus costs, but **only when both are read**. A missing cost amount is not counted as zero: it means the cost label was not recognized, not that the delivery had no costs, and conflating those two produced a EUR 1.734 phantom difference on one delivery during the build (the Dutch "Totaal kosten" was still missing from the label list). An all-in delivery never reaches this branch anyway, since it prints the net explicitly. `derivePdfNetResult()` in `salessheet-match.ts` is exported so `scripts/backfill-pdf-totals.ts` shares the same rule instead of writing it out a third time; today it fires on none of the 4.024 deliveries and mainly exists for a layout that stops printing the net.
- **A self-check on our own reading.** When `pdfNetResult`, `pdfTurnover` and `pdfCosts` are all three read, turnover minus costs must equal the printed net — that is how a sales sheet adds up, not an assumption about the delivery. Measured: on 3.767 documents where all three were read, the identity holds all 3.767 times. When it breaks, the parser misread something, so the result is `unread`, not `mismatch` — it says something about our extraction, nothing about the delivery.
- **Threshold: EUR 1**, as the exported constant `SALESSHEET_MATCH_TOLERANCE`. Final measurement over 7.878 deliveries: 4.023 assessable, 3.803 match (94,5%), 220 mismatch above EUR 1 (EUR 50.052 combined), 1 unread, 3.854 without a linked PDF.
- **The labels are bilingual in `salessheet-pdf-parser.ts`, and two were missed the first time round** — found only when a delivery appeared to differ by EUR 1.734. The Dutch cost total reads **"Totaal kosten"**, not "Totale kosten", and the net sometimes sits behind **"Subtotaal"** — listed last because it is the more generic term. Covered by fixtures built from real PDF text in `scripts/checks/salessheet-pdf-amounts.ts`.
- **No fallback to the amount before the cost label.** `bedragVoorLabel` reads whatever number sits just before a label, but on the Dutch layout that slot before "Totaal kosten" holds the negative subtotal in parentheses, not the cost total — measured to read -1.734,29 there instead of 1.734,30. The fallback covered zero documents (every delivery without a cost label is all-in or genuinely has no costs), so it was removed rather than fixed.
- The VAT line on Dutch sales sheets ("NETTO RESULTAAT INCL. BTW") is deliberately not read: domestic suppliers get VAT on top of the net and the portal has no concept of VAT, so only the amount before it is comparable.
- `scripts/backfill-pdf-totals.ts` is the catch-up round for links made before this change (dry-run by default, `--blob` pulls files from storage, writes in batches of 200 so a dropped connection costs at most one batch). Without that round the check covers almost nothing on production, where only 4,6% of deliveries carry a linked PDF.
- **Every place that clears `pdfDocumentId` must also clear the four `pdf*` columns.** A stale `pdfNetResult` left behind after a document is unlinked or deleted produces a permanent phantom mismatch — a signal pointing at itself. There are two such places: `scripts/audit-salessheet-links.ts` (which, with `--apply`, also deletes the orphaned `Document` itself) and `verwijderLeveringen()` in the lots import route. A third place, `scripts/fix-salessheet-pdf-links.ts`, fully overlapped `audit-salessheet-links.ts` and was removed.

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
- **Check whether port 5432 is open before assuming it is not.** It differs per network: on some connections outbound TCP to Neon is blocked and `prisma` times out, on others both the pooler and the direct host answer fine. Measure it (`Test-NetConnection <direct host> -Port 5432`, or `npx prisma db execute --url "<DIRECT_URL>" --stdin` with `SELECT 1;`) and then choose: `db push` when it is open, `@neondatabase/serverless` over HTTPS when it is not. Adding columns by hand while push would have worked is how a database drifts from the schema
- **`npx prisma migrate diff --from-url "<DIRECT_URL>" --to-schema-datamodel prisma/schema.prisma --script` prints the drift without applying it.** "This is an empty migration" means the database matches the schema — the cheapest way to check an environment before or after a hand-run `ALTER`
- **Emails**: Use CID inline attachments (base64 Buffer), never external image URLs.
- `useSearchParams()` requires Suspense boundary.
- **Zod 4, not 3**: `z.record(keySchema, valueSchema)` requires *every* key to be present. For a partial map like `windowOverrides` use `z.partialRecord()`, or a save with `{}` is rejected.
- **Tailwind variants beat unprefixed utilities**: the base `DialogContent` carries `sm:max-w-sm`, so a plain `max-w-4xl` never applies on desktop no matter the order. Write `sm:max-w-4xl`. Three dialogs in `features/fust` still have this bug.
- **Base UI `SelectValue` renders the raw value, not the item label.** Fine when the value is human-readable; pass a function as children when it is an id.
- **Paginate on a unique sort.** `ORDER BY` on a non-unique key plus `OFFSET` lets Postgres return a row on two pages or on none — measured, not theoretical. Always append `{ id: "asc" }`.
- **In een API-route: bouw een raw query als `Prisma.Sql`-object en geef dat als argument mee, niet als tagged template.** `prisma.$queryRaw\`... ${fragment} ...\`` met een genest `Prisma.Sql`-fragment erin gaat door de SWC-compilatie van Next stuk: Postgres krijgt een `$1` die er niet staat en antwoordt met `42601 syntax error at or near "$1"`, ook als de query zelf nul parameters heeft. Dezelfde code werkt wél in een `tsx`-script, dus een scriptje dat de query bewijst zegt hier niets — gemeten op `/api/admin/shipment-issues`, waar exact dezelfde SQL faalde als template en slaagde als `prisma.$queryRaw(sqlObject)`. Tagged templates zonder genest fragment (zoals in `/api/admin/fabric-relations`) zijn ongemoeid
- **Prisma `Json?` fields**: writing `null` does not type-check against the update input — use `Prisma.JsonNull` to store a JSON null, or `undefined` to leave the column alone.
- **After changing a column's type, expect `cached plan must not change result type`.** Postgres throws it once per pooled connection that still holds a prepared statement with the old result type, so right after a `db push` that alters a type you get scattered 500s until the connections have re-planned. It clears itself; it is not a failed migration. `prisma db push --skip-generate` avoids the Windows EPERM on the query engine DLL and lets the dev server keep running, and widening a decimal (`Decimal(12,2)` -> `Decimal(14,6)`) still asks for `--accept-data-loss` even though nothing is lost — check `migrate diff` first, then pass it.

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
