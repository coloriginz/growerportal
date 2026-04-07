# Grower Portal - Project Documentation

## Overview

Multi-tenant web portal for **Coloriginz**, a Dutch flower trading company that works on consignment with growers worldwide. Growers (kwekers) use this portal to track sales, lots, quality issues, documents, and shipment forecasts. Internal users (commercie/admin) manage growers and view aggregate insights. Transporteurs manage fust pickups and deliveries. Finance handles fust invoicing and voucher matching.

**Domain:** Cut flower trade (consignment model). Growers ship flowers, Coloriginz sells at Dutch flower auctions (VBA, VPL) and direct sales, then settles via salessheets. Fust (containers/crates) is tracked separately: growers order fust, transporteurs pick up and deliver, finance reconciles via invoices and issuance vouchers.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Database | PostgreSQL via Neon (serverless) |
| ORM | Prisma 6 with `@prisma/adapter-neon` |
| Auth | NextAuth.js v5 beta (JWT strategy, Credentials provider) |
| UI | Tailwind CSS 4 + shadcn/ui (Base UI primitives) |
| Icons | Remix Icons (`@remixicon/react`) |
| Charts | Recharts 3 |
| Toasts | Sonner |
| Validation | Zod |
| i18n | Custom JSON-based system (EN/NL) |
| Email | Nodemailer (Ethereal dev, Resend prod) |
| File Storage | Vercel Blob |
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
│   ├── activate/                     # Account activation flow
│   ├── (portal)/                     # Protected route group (grower/commercie/admin/finance)
│   │   ├── layout.tsx                # AppShell wrapper (auth check)
│   │   ├── dashboard/                # Dashboard (grower + aggregate)
│   │   ├── sales/                    # Sales analytics + trends
│   │   ├── lots/                     # Lot overview + detail
│   │   ├── quality/                  # Quality issues
│   │   ├── documents/                # Document management
│   │   ├── forecasts/                # Shipment forecasts (weekly grid)
│   │   ├── fust/                     # Fust pages (orders, pickups, deliveries, vouchers, invoices, activity)
│   │   ├── profile/                  # Grower profile
│   │   ├── growers/                  # Grower management (admin/commercie)
│   │   └── admin/                    # User management (admin)
│   ├── (fust-portal)/                # Standalone fust portal (transporteur login)
│   │   └── fust-portal/             # FustShell layout + pages (my-orders, pickups, deliveries, etc.)
│   └── api/                          # API routes (see below)
├── components/
│   ├── layout/                       # AppShell, GrowerSelector, TestBanner, etc.
│   ├── charts/                       # Recharts wrappers
│   ├── providers/                    # LanguageProvider, SessionProvider
│   ├── ui/                           # shadcn/ui primitives
│   ├── language-switcher.tsx
│   └── theme-switcher.tsx
├── hooks/
│   └── use-fetch.ts                  # Generic data fetching hook
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
│   ├── api-helpers.ts                # requireAuth(), resolveGrowerId()
│   ├── format.ts                     # Currency, number, date formatting (nl-NL)
│   ├── export-csv.ts                 # CSV export utility
│   ├── email.ts                      # Nodemailer setup
│   ├── email-templates.ts            # HTML email templates (activation, reset, fust approved, fust delivered)
│   ├── fust-notifications.ts        # Fust email triggers (order approved → transporter, delivery confirmed → grower)
│   ├── fust-audit.ts                # Audit trail helper: logFustEvent()
│   ├── company-config.ts            # Multi-company branding config
│   ├── company-logos.ts             # Base64 logos per company
│   ├── company-helpers.ts           # getGrowerEmailBranding()
│   ├── quality-codes.ts             # Quality code mappings
│   ├── chart-colors.ts              # Recharts color palette
│   ├── grower-context.ts            # Server-side grower context
│   ├── env.ts                        # Environment helpers
│   └── utils.ts                      # clsx/cn utility
├── types/
│   ├── index.ts                      # Domain enums (Role, LotStatus, SalesType, etc.)
│   └── next-auth.d.ts               # Session type extensions
└── generated/prisma/                 # Prisma generated client (do not edit)

prisma/
├── schema.prisma                     # Database schema
└── seed.ts                           # Test data seeder
```

---

## Authentication & Authorization

### Roles
- **grower**: Can only see own data. Linked to a single Grower record via `user.growerId`.
- **commercie**: Account manager. Can view any grower's data by passing `?growerId=` in URL. Sees aggregate dashboard when no grower selected.
- **admin**: Full access. Same multi-tenant view as commercie, plus user management.
- **transporteur**: Fust portal only. Manages pickups and deliveries. Linked to a Transporter record via `user.transporterId`.
- **finance**: Fust invoicing and voucher matching. Same nav as commercie in main portal, plus fust finance pages.

### Key Patterns
```typescript
// API route pattern: check auth, resolve grower, query data
const { error, session } = await requireAuth();        // 401 if no session
if (error) return error;
const growerId = resolveGrowerId(session!, requestedGrowerId); // growers get their own ID, others get the requested one
```

### Session Shape
```typescript
session.user = {
  id: string;
  name: string;
  email: string;
  role: "grower" | "commercie" | "admin" | "transporteur" | "finance";
  growerId: string | null;       // only set for grower users
  transporterId: string | null;  // only set for transporteur users
}
```

---

## Database Schema (Key Models)

### Core Entities
- **User** - Authentication. Has role, optional growerId/transporterId link.
- **Grower** - Supplier. Has code (e.g., "PCFUP"), company, address, certificates.
- **Company** - Multi-tenant company entity (e.g., Coloriginz, OZ Import). Growers belong to a company for branding.
- **Transporter** - Logistics partner. Manages fust pickups/deliveries.
- **Lot** - A batch of flowers delivered. Has productName, articleGroup, stemLength, totalStems, status (in_transit/selling/sold).
- **Transaction** - Individual sale from a lot. Has salesType (Direct/VBA/VPL), stems, pricePerStem, amount.
- **SalesSheet** - Invoice grouping lots. Has totalTurnover, totalCosts, netResult.
- **ShipmentForecast** - Weekly forecast per product per grower. Unique on (growerId, productName, year, week).

### Fust Entities
- **FustType** - Container type (emmers, karren, kratten, etc.) with price per unit.
- **FustOrder** - Grower orders fust. Status: pending → approved → scheduled → in_transit → delivered. Soft delete (deletedAt).
- **FustOrderItem** - Line items per order (fustType + quantity + deliveredQuantity).
- **FustPickup** - Transporter picks up fust from multiple orders. Status: planned → picked_up → completed.
- **FustDelivery** - 1:1 with FustOrder. Tracks delivery status and actual quantities.
- **FustInvoice** - Transporter invoice (PDF upload + parsed items). Status: pending → approved/rejected.
- **FustIssuanceVoucher** - Auction voucher matched to orders for reconciliation.
- **FustAuditLog** - Centralized audit trail for all fust events (19 action types). Denormalized orderId for timeline queries.

### Relationships
```
Grower → has many → Lots → has many → Transactions
Grower → has many → SalesSheets → has many → Lots
Grower → has many → ShipmentForecasts
Grower → has many → QualityIssues
Grower → has many → Documents
Grower → has many → Certificates
Grower → belongs to → User (commercie, via commercieId)
Grower → belongs to → Company (via companyId)
Grower → has many → FustOrders → has one → FustDelivery
Transporter → has many → FustPickups → has many → FustDeliveries
FustOrder → has many → FustOrderItems
FustPickup → has many → FustDeliveries
```

### Important Constraints
- `Lot.lotNumber + Lot.growerId` is unique
- `ShipmentForecast.growerId + productName + year + week` is unique
- `SalesSheet.invoiceNumber` is unique
- UUIDs as primary keys throughout

---

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth endpoints |
| `/api/dashboard` | GET | Dashboard data (grower or aggregate) |
| `/api/sales` | GET | Sales data with period/product/channel/length filters |
| `/api/sales/filters` | GET | Available filter options for sales |
| `/api/sales/trends` | GET | Price trends, stem length breakdown, channel distribution |
| `/api/lots` | GET | Lots with pagination and filters |
| `/api/quality` | GET | Quality issues |
| `/api/documents` | GET, POST | Document list and upload |
| `/api/documents/[id]` | GET, DELETE | Download and delete document |
| `/api/forecasts` | GET, POST, DELETE | Forecast CRUD (GET=read range, POST=upsert batch, DELETE=remove product) |
| `/api/forecasts/copy` | POST | Copy week data to subsequent weeks |
| `/api/profile` | GET, PUT | User profile |
| `/api/profile/password` | PUT | Change password |
| `/api/growers` | GET | Growers list (for selector) |
| `/api/growers/[id]` | GET, PUT | Grower detail and update |
| `/api/growers/[id]/activate` | POST | Send activation email |
| `/api/admin/users` | GET, POST | User management |
| `/api/admin/users/[id]` | GET, PUT, DELETE | User CRUD |
| `/api/activate` | POST | Account activation (set password) |
| `/api/change-requests` | GET, POST | Grower change requests |
| `/api/companies` | GET | Company list (for grower brand selector) |
| `/api/admin/commercie` | GET | Commercie/admin users (for account manager selector) |
| `/api/fust/types` | GET | Fust types catalog |
| `/api/fust/settings` | GET, PUT | Fust settings (auto-approve threshold) |
| `/api/fust/dashboard` | GET | Fust dashboard KPIs |
| `/api/fust/orders` | GET, POST | Fust orders (soft-delete filtered) |
| `/api/fust/orders/[id]` | GET, PATCH, DELETE | Order detail, approve/reject/cancel, soft delete |
| `/api/fust/pickups` | GET, POST | Pickup management |
| `/api/fust/pickups/[id]` | GET, PATCH | Pickup status + link orders |
| `/api/fust/deliveries/[id]` | PATCH | Confirm delivery (triggers grower email) |
| `/api/fust/invoices` | GET, POST | Invoice list and PDF upload |
| `/api/fust/invoices/[id]` | PATCH | Invoice status change |
| `/api/fust/invoices/[id]/charges` | POST | Create charges from invoice |
| `/api/fust/vouchers` | GET, POST | Issuance voucher list and PDF upload |
| `/api/fust/vouchers/[id]/match` | POST, DELETE | Match/unmatch voucher to orders |
| `/api/fust/audit` | GET | Audit log (filterable, paginated, role-scoped) |

### API Conventions
- All routes use `requireAuth()` for session check
- `resolveGrowerId()` for multi-tenant data access
- Zod validation on POST/PUT bodies
- Responses: `NextResponse.json(data)` or `NextResponse.json({ error }, { status })`
- Filters passed as query params (multi-value via `getAll`)

---

## Frontend Patterns

### Page Structure
Each portal page follows this pattern:
```
page.tsx         → Server component, auth check, renders content component in Suspense
*-content.tsx    → Client component ("use client"), fetches data, renders UI
```

### Data Fetching
```typescript
const { data, loading, error, lastUpdated, refetch } = useFetch<T>(url);
```
- `useFetch` is a custom hook that handles loading/error states
- URL is built with `useMemo` to trigger refetch on param changes
- `refetch()` available for manual refresh

### State Management
- No global state library. URL search params (`?growerId=`) as source of truth for grower context.
- `useSearchParams()` for reading grower selection (requires Suspense boundary).
- Local component state for UI interactions.

### Formatting
All formatting uses `nl-NL` locale:
- `formatCurrency(1234)` → "€ 1.234"
- `formatNumber(1234)` → "1.234"
- `formatPrice(1.234)` → "€ 1,234"
- `formatDate(date)` → "15-03-2026"

### Translations
```typescript
const { t } = useLanguage();
t("nav.dashboard")  // → "Dashboard" (en) or "Dashboard" (nl)
t("forecasts.title") // → "Shipment Forecasts" or "Aanvoerplanning"
```
Type-safe: `t()` accepts only keys that exist in the JSON files.

---

## Key Features

### Dashboard
- **Grower view**: KPI cards (stems today/yesterday/YTD, turnover, avg price, net yield, quality rate), sales chart, top products, recent lots.
- **Aggregate view** (admin/commercie, no grower selected): Company-wide KPIs, top growers table (clickable), top products, upcoming forecast summary.

### Sales Analytics
- Period filters: today, yesterday, this week, this month, YTD, custom date range
- Multi-select filters: product, sales channel, stem length
- Charts: price trend per product, stem length breakdown, channel distribution over time
- All charts respect active filters

### Shipment Forecasts
- Weekly grid: 6 weeks visible, inline number editing per cell
- Year overview chart (Recharts AreaChart): all products as colored areas, clickable weeks navigate the table
- Auto-save per cell with status indicators (saving/saved/error)
- Add products from lot history or custom names
- Copy week data to subsequent weeks
- CSV export
- Past weeks are read-only

### Grower Management
- Grower profiles with certificates
- Account activation via email link
- Commercie assignment
- Change request system
- Multi-company branding (Company entity with custom logos, email from-addresses)

### Fust Management
- **Webshop**: Growers order fust containers from a catalog (FustType with categories: emmers, karren, kratten, dozen, opzetrekken, overig)
- **Auto-approve**: Orders below a configurable threshold are auto-approved
- **Pickups**: Transporteurs group approved orders into pickups, mark as picked up
- **Deliveries**: 1:1 with orders. Transporteur confirms delivery with actual quantities → triggers email to grower
- **Invoices**: Finance uploads transporter invoices (PDF parsed), approves/rejects, creates charges
- **Vouchers**: Auction issuance vouchers (PDF parsed) matched to orders for reconciliation
- **Audit trail**: All fust actions logged to FustAuditLog (19 event types). Per-order timeline UI + admin activity page
- **Soft delete**: FustOrders use deletedAt/deletedById instead of hard delete
- **Two portals**: `(portal)/fust/` for grower/admin/commercie/finance, `(fust-portal)/fust-portal/` for transporteurs (standalone FustShell layout)

### Email Notifications
- **Account activation**: Credentials email to new users (all roles)
- **Password reset**: Reset link email
- **Fust order approved**: Email to transporter when order is approved (includes items, requested date)
- **Fust delivery confirmed**: Email to grower when transporter confirms delivery (includes ordered vs delivered quantities)

---

## Development

### Commands
```bash
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npx prisma db push   # Push schema changes (NOT migrate dev)
npx prisma generate  # Generate Prisma client (stop dev server first on Windows!)
npx tsx prisma/seed.ts  # Seed test database
```

### Environment Variables
```
DATABASE_URL=        # Neon pooler connection string
DIRECT_URL=          # Neon direct connection (for schema push)
NEXTAUTH_SECRET=     # NextAuth JWT secret
NEXTAUTH_URL=        # App URL
APP_URL=             # Public app URL
NEXT_PUBLIC_IS_TEST= # "true" for test environment banner
```

### Demo Accounts (test environment)
```
Admin:        admin@coloriginz.com        / Colori2026!
Commercie:    iris.inkoper@coloriginz.com  / FloraDesk#24
Grower:       pcfup@example.com            / GreenField99
Transporteur: chauffeur@flowertrans.nl     / Transport#2026
Finance:      finance@coloriginz.com       / Finance#2026
```

### Important Notes
- **Windows EPERM**: Stop dev server before running `prisma generate` (DLL lock).
- **Never run `next build` while dev server is running** - breaks CSS output.
- **Never use `vercel deploy`** - use `git push` to deploy (avoids leaking .env).
- **Database changes**: Use `prisma db push`, not `prisma migrate dev`.
- **Emails**: Use CID inline attachments (base64 Buffer), never external image URLs.
- `useSearchParams()` requires Suspense boundary.

---

## Deployment

- **Platform**: Vercel with two deployment targets
- **Test**: Auto-deploys from `develop` branch
- **Production**: Deploys from `main` branch
- **Database**: Separate Neon projects for test and production (not Neon branches)
- `vercel.json` runs `prisma generate` before build
- Never push directly to `main` without approval

---

## File Naming Conventions
- Page components: `page.tsx` (server) + `*-content.tsx` (client)
- API routes: `route.ts`
- UI components: kebab-case (`multi-select-filter.tsx`)
- Lib files: kebab-case (`api-helpers.ts`)
- Translation keys: dot-notation (`forecasts.copyWeek`)
